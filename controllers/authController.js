const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Session = require('../models/Session');
const LoginAttempt = require('../models/LoginAttempt');
const BlacklistedToken = require('../models/BlacklistedToken');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require('../utils/helpers');
const { validatePassword } = require('../utils/passwordPolicy');
const { generateCaptcha, verifyCaptcha } = require('../utils/captcha');
const { setCsrfToken } = require('../middleware/csrf');
const {
  recordFailedLogin,
  clearFailedLogins,
  getFailedLoginCount,
} = require('../middleware/ipProtection');
const { sendEmail } = require('../config/email');
const { welcomeEmail } = require('../utils/emailTemplates');
const { notify, notifyAdmins } = require('../utils/notify');

const BCRYPT_ROUNDS = 12;
const PASSWORD_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const LOCK_15_MIN = 15 * 60 * 1000;
const LOCK_1_HOUR = 60 * 60 * 1000;
// After this many failed logins from an IP, a CAPTCHA is required on the next try.
const CAPTCHA_AFTER_ATTEMPTS = 3;
// Session policy
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // absolute refresh lifetime
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // invalidate after 30 min of no activity
const MAX_SESSIONS = 3; // concurrent active sessions per user
// A real bcrypt hash of a random value, used to equalize timing for unknown emails
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-real-password', BCRYPT_ROUNDS);

const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/auth',
  signed: true,
  maxAge: REFRESH_TTL_MS,
};

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const clientIp = (req) => req.ip || req.connection?.remoteAddress || '';

const sanitizeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  address: user.address,
  role: user.role,
  verified: user.verified,
  isActive: user.isActive !== false,
  idDocument: user.idDocument,
  passwordExpiresAt: user.passwordExpiresAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

async function logAttempt(req, email, success) {
  try {
    await LoginAttempt.create({
      email: (email || '').toLowerCase(),
      ip: req.ip || req.connection?.remoteAddress || '',
      userAgent: req.headers['user-agent'] || '',
      success,
    });
  } catch {
    /* logging must never break auth */
  }
}

// Create a brand-new session on login/register and issue the token pair.
// Enforces the concurrent-session cap by revoking the oldest active session.
async function startSession(req, res, user) {
  // Concurrent session limiting: keep at most MAX_SESSIONS active sessions.
  const active = await Session.find({ user: user._id, isActive: true }).sort({
    lastActivity: 1,
  });
  const overflow = active.length - (MAX_SESSIONS - 1);
  if (overflow > 0) {
    const toRevoke = active.slice(0, overflow).map((s) => s._id);
    await Session.updateMany({ _id: { $in: toRevoke } }, { isActive: false });
  }

  const now = new Date();
  const session = await Session.create({
    user: user._id,
    tokenHash: 'pending',
    userAgent: req.headers['user-agent'] || '',
    ip: clientIp(req),
    lastActivity: now,
    expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    isActive: true,
  });

  const refreshToken = generateRefreshToken(user._id, {
    sid: session._id.toString(),
    tv: user.tokenVersion || 0,
  });
  session.tokenHash = hashToken(refreshToken);
  await session.save();

  res.cookie('refreshToken', refreshToken, refreshCookieOptions);
  const csrfToken = setCsrfToken(res);
  return { accessToken: generateAccessToken(user._id), csrfToken };
}

// @route GET /api/auth/captcha
// Returns a fresh challenge. Also reports whether login currently needs a CAPTCHA
// for this client (based on recent failed attempts from its IP).
exports.getCaptcha = async (req, res, next) => {
  try {
    const { question, token } = generateCaptcha();
    const ip = req.ip || req.connection?.remoteAddress || '';
    const loginCaptchaRequired = getFailedLoginCount(ip) >= CAPTCHA_AFTER_ATTEMPTS;
    return res.json({ success: true, question, token, loginCaptchaRequired });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/register
exports.register = async (req, res, next) => {
  try {
    const { name, email, password, phone, captchaToken, captchaAnswer } = req.body;

    // Registration always requires a CAPTCHA.
    if (!verifyCaptcha(captchaToken, captchaAnswer)) {
      return res.status(400).json({
        success: false,
        message: 'CAPTCHA verification failed. Please solve the challenge again.',
        captchaRequired: true,
      });
    }

    const policy = validatePassword(password, { name, email });
    if (!policy.valid) {
      return res
        .status(400)
        .json({ success: false, message: policy.errors[0], errors: policy.errors });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res
        .status(400)
        .json({ success: false, message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const now = new Date();

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      phone,
      role: 'customer',
      passwordHistory: [hashedPassword],
      passwordChangedAt: now,
      passwordExpiresAt: new Date(now.getTime() + PASSWORD_TTL_MS),
    });

    const { accessToken, csrfToken } = await startSession(req, res, user);

    sendEmail({ to: user.email, ...welcomeEmail(user) }).catch(() => {});
    notify(user._id, {
      title: 'Welcome to RentGear',
      message: 'Your account is ready. Browse equipment to get started.',
      type: 'success',
      link: '/equipment',
    });
    notifyAdmins({
      title: 'New user registered',
      message: `${user.name} (${user.email}) just signed up.`,
      type: 'user',
      link: '/admin/users',
    });

    return res
      .status(201)
      .json({ success: true, accessToken, csrfToken, user: sanitizeUser(user) });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/login
exports.login = async (req, res, next) => {
  try {
    const { email, password, captchaToken, captchaAnswer } = req.body;
    const ip = req.ip || req.connection?.remoteAddress || '';

    // Once an IP has failed enough times, force a CAPTCHA before we even check
    // the password. Prevents automated password-guessing from this client.
    const captchaRequired = getFailedLoginCount(ip) >= CAPTCHA_AFTER_ATTEMPTS;
    if (captchaRequired && !verifyCaptcha(captchaToken, captchaAnswer)) {
      await logAttempt(req, email, false);
      return res.status(400).json({
        success: false,
        message: 'CAPTCHA verification required. Please solve the challenge.',
        captchaRequired: true,
      });
    }

    const user = await User.findOne({ email: (email || '').toLowerCase() }).select(
      '+password'
    );

    // Locked account?
    if (user && user.lockUntil && user.lockUntil.getTime() > Date.now()) {
      await logAttempt(req, email, false);
      const minutes = Math.ceil((user.lockUntil.getTime() - Date.now()) / 60000);
      return res.status(423).json({
        success: false,
        message: `Account locked. Try again in ${minutes} minute(s).`,
        lockUntil: user.lockUntil,
      });
    }

    // Timing-safe-ish: always run a compare, even for unknown emails
    const hash = user ? user.password : DUMMY_HASH;
    const isMatch = await bcrypt.compare(password || '', hash);

    if (!user || !isMatch) {
      // Track the failure against the IP (feeds auto-block + captcha gating).
      await recordFailedLogin(ip);
      const ipFailures = getFailedLoginCount(ip);

      let attemptsRemaining;
      if (user) {
        user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
        if (user.failedLoginAttempts >= 10) {
          user.lockUntil = new Date(Date.now() + LOCK_1_HOUR);
        } else if (user.failedLoginAttempts >= 5) {
          user.lockUntil = new Date(Date.now() + LOCK_15_MIN);
        }
        attemptsRemaining = Math.max(5 - user.failedLoginAttempts, 0);
        await user.save();
      }
      await logAttempt(req, email, false);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        captchaRequired: ipFailures >= CAPTCHA_AFTER_ATTEMPTS,
        ...(attemptsRemaining !== undefined && { attemptsRemaining }),
      });
    }

    if (user.isActive === false) {
      await logAttempt(req, email, false);
      return res
        .status(403)
        .json({ success: false, message: 'Account has been disabled' });
    }

    // Success: reset counters
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();
    clearFailedLogins(ip);
    await logAttempt(req, email, true);

    const passwordExpired =
      user.passwordExpiresAt && user.passwordExpiresAt.getTime() < Date.now();

    const { accessToken, csrfToken } = await startSession(req, res, user);

    return res.json({
      success: true,
      accessToken,
      csrfToken,
      user: sanitizeUser(user),
      passwordExpired: !!passwordExpired,
    });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/auth/csrf-token
// Issues a CSRF token (cookie + body) so the client can call the cookie-based
// refresh endpoint. Safe to call unauthenticated.
exports.getCsrfToken = async (req, res) => {
  const csrfToken = setCsrfToken(res);
  return res.json({ success: true, csrfToken });
};

// @route POST /api/auth/refresh-token   (CSRF-protected)
// Rotates the refresh token: verifies the current one, then issues a brand-new
// access + refresh token, invalidating the old refresh token. Detects reuse of
// an already-rotated token and nukes every session for that user.
exports.refreshToken = async (req, res, next) => {
  try {
    const token = req.signedCookies?.refreshToken || req.cookies?.refreshToken;
    if (!token) {
      return res.status(401).json({ success: false, message: 'No refresh token' });
    }

    const blacklisted = await BlacklistedToken.findOne({ token });
    if (blacklisted) {
      return res.status(401).json({ success: false, message: 'Token revoked' });
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    const user = await User.findById(decoded.id);
    if (!user || user.isActive === false) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    // tokenVersion check: rejects tokens minted before a "logout everywhere".
    if ((decoded.tv || 0) !== (user.tokenVersion || 0)) {
      return res.status(401).json({ success: false, message: 'Session expired' });
    }

    const session = decoded.sid ? await Session.findById(decoded.sid) : null;
    if (!session || session.user.toString() !== user._id.toString()) {
      return res.status(401).json({ success: false, message: 'Session not found' });
    }

    const presentedHash = hashToken(token);

    // Reuse detection: a valid, non-blacklisted token whose hash no longer
    // matches the session means an already-rotated (old) token is being
    // replayed — treat as compromise and revoke every session for the user.
    if (session.tokenHash !== presentedHash) {
      await Session.updateMany({ user: user._id }, { isActive: false });
      console.warn(
        `[session] refresh token reuse detected for user ${user._id} (sid ${session._id}). ` +
          `All sessions revoked.`
      );
      try {
        notify(user._id, {
          title: 'Suspicious activity detected',
          message:
            'A security issue was detected with your session. Please log in again.',
          type: 'warning',
          link: '/login',
        });
      } catch {
        /* best-effort */
      }
      res.clearCookie('refreshToken', { ...refreshCookieOptions, maxAge: undefined });
      return res.status(401).json({ success: false, message: 'Session revoked' });
    }

    if (!session.isActive) {
      return res.status(401).json({ success: false, message: 'Session revoked' });
    }

    // Idle timeout: no activity for 30 minutes invalidates the session.
    if (Date.now() - new Date(session.lastActivity).getTime() > IDLE_TIMEOUT_MS) {
      session.isActive = false;
      await session.save();
      res.clearCookie('refreshToken', { ...refreshCookieOptions, maxAge: undefined });
      return res
        .status(401)
        .json({ success: false, message: 'Session expired due to inactivity' });
    }

    // Session binding: the browser fingerprint must not change mid-session.
    const currentUa = req.headers['user-agent'] || '';
    if (session.userAgent && session.userAgent !== currentUa) {
      session.isActive = false;
      await session.save();
      console.warn(
        `[session] user-agent mismatch for user ${user._id} (sid ${session._id}); session revoked`
      );
      res.clearCookie('refreshToken', { ...refreshCookieOptions, maxAge: undefined });
      return res
        .status(401)
        .json({ success: false, message: 'Session validation failed' });
    }

    // Rotate: mint a new refresh token, update the stored hash + activity.
    const newRefresh = generateRefreshToken(user._id, {
      sid: session._id.toString(),
      tv: user.tokenVersion || 0,
    });
    session.tokenHash = hashToken(newRefresh);
    session.lastActivity = new Date();
    await session.save();

    res.cookie('refreshToken', newRefresh, refreshCookieOptions);
    const csrfToken = setCsrfToken(res);
    const accessToken = generateAccessToken(user._id);
    return res.json({ success: true, accessToken, csrfToken, user: sanitizeUser(user) });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/auth/me
exports.getMe = async (req, res, next) => {
  try {
    return res.json({ success: true, user: sanitizeUser(req.user) });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/logout
exports.logout = async (req, res, next) => {
  try {
    const token = req.signedCookies?.refreshToken || req.cookies?.refreshToken;
    if (token) {
      try {
        const decoded = jwt.decode(token);
        const expiresAt = decoded?.exp
          ? new Date(decoded.exp * 1000)
          : new Date(Date.now() + REFRESH_TTL_MS);
        await BlacklistedToken.updateOne(
          { token },
          { token, expiresAt },
          { upsert: true }
        );
        // Deactivate the session tied to this token.
        if (decoded?.sid) {
          await Session.updateOne({ _id: decoded.sid }, { isActive: false });
        }
      } catch {
        /* ignore */
      }
    }
    res.clearCookie('refreshToken', { ...refreshCookieOptions, maxAge: undefined });
    return res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/logout-all
// Logs the user out of every device: bumps tokenVersion (invalidating all
// existing refresh tokens on their next use) and deactivates all sessions.
exports.logoutAll = async (req, res, next) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
    await Session.updateMany({ user: req.user._id }, { isActive: false });
    res.clearCookie('refreshToken', { ...refreshCookieOptions, maxAge: undefined });
    return res.json({ success: true, message: 'Logged out from all devices' });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/auth/sessions
// The current session is flagged so the UI can label it "This device".
exports.getSessions = async (req, res, next) => {
  try {
    const token = req.signedCookies?.refreshToken || req.cookies?.refreshToken;
    let currentSid = null;
    try {
      currentSid = token ? jwt.decode(token)?.sid : null;
    } catch {
      /* ignore */
    }

    const sessions = await Session.find({ user: req.user._id, isActive: true })
      .sort({ lastActivity: -1 })
      .lean();

    return res.json({
      success: true,
      sessions: sessions.map((s) => ({
        id: s._id,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
        lastActivity: s.lastActivity,
        current: currentSid ? s._id.toString() === currentSid : false,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// @route DELETE /api/auth/sessions/:id
exports.revokeSession = async (req, res, next) => {
  try {
    const session = await Session.findOne({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    session.isActive = false;
    await session.save();
    return res.json({ success: true, message: 'Session revoked' });
  } catch (error) {
    next(error);
  }
};

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
const { recordAudit } = require('../utils/audit');
const {
  recordFailedLogin,
  clearFailedLogins,
  getFailedLoginCount,
} = require('../middleware/ipProtection');
const { sendEmail } = require('../config/email');
const { welcomeEmail, otpEmail, passwordResetEmail, passwordResetConfirmation } = require('../utils/emailTemplates');
const { generateOtp, hashOtp, verifyOtpHash, OTP_TTL_MS, OTP_MAX_ATTEMPTS } = require('../utils/otp');
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
  // Secure cookies over HTTPS (production or local HTTPS dev).
  secure: process.env.NODE_ENV === 'production' || process.env.USE_HTTPS === 'true',
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
  mfaEnabled: !!user.mfaEnabled,
  passwordExpiresAt: user.passwordExpiresAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

// Generate an OTP, store its hash + expiry on the user, and email the code.
// Resets the wrong-attempt counter. `user` must be a full mongoose document.
// Email delivery must NEVER break the login/MFA flow: if SMTP isn't configured
// or sending fails, the code is logged to the console as a development fallback.
async function issueOtp(user) {
  const code = generateOtp();
  user.mfaCode = await hashOtp(code);
  user.mfaCodeExpires = new Date(Date.now() + OTP_TTL_MS);
  user.mfaFailedAttempts = 0;
  await user.save();

  const smtpConfigured = !!process.env.SMTP_HOST;
  try {
    const result = await sendEmail({ to: user.email, ...otpEmail(code) });
    // No real SMTP, or the send failed → surface the code in the console so
    // developers can complete the flow without a mail server.
    if (!smtpConfigured || !result || result.success === false) {
      console.log(
        `[DEV OTP] Login code for ${user.email}: ${code} (valid 5 minutes)`
      );
    }
  } catch (err) {
    // Defensive: sendEmail is designed not to throw, but if it ever does the
    // login flow must still succeed — log the code and continue.
    console.error(`[MFA] OTP email error for ${user.email}: ${err.message}`);
    console.log(`[DEV OTP] Login code for ${user.email}: ${code} (valid 5 minutes)`);
  }
}

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

    req.setAudit?.('REGISTER', {
      resource: 'user',
      resourceId: user._id,
      details: { email: user.email },
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
      req.setAudit?.('ACCOUNT_LOCKED', {
        resource: 'user',
        resourceId: user._id,
        details: { email, lockUntil: user.lockUntil },
      });
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
      req.setAudit?.('LOGIN_FAILED', { details: { email } });
      // Repeated failures from one IP → flag as suspicious (separate event).
      if (ipFailures >= 10) {
        recordAudit('SUSPICIOUS_ACTIVITY', req, {
          details: { reason: 'repeated failed logins', ipFailures, email },
        });
      }
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

    // Password is correct: reset failed-login counters.
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();
    clearFailedLogins(ip);

    // MFA gate: if enabled, don't issue tokens yet — send an OTP and require
    // the second step (POST /api/auth/verify-otp).
    if (user.mfaEnabled) {
      await issueOtp(user);
      await logAttempt(req, email, true);
      req.setAudit?.('LOGIN_MFA_CHALLENGE', {
        resource: 'user',
        resourceId: user._id,
        details: { email: user.email },
      });
      return res.json({
        success: true,
        mfaRequired: true,
        email: user.email,
        message: 'A verification code has been sent to your email.',
      });
    }

    await logAttempt(req, email, true);
    req.setAudit?.('LOGIN_SUCCESS', {
      resource: 'user',
      resourceId: user._id,
      details: { email: user.email },
    });

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

// Reset the stored OTP state on a user document (does not save).
function clearOtpState(user) {
  user.mfaCode = null;
  user.mfaCodeExpires = null;
  user.mfaFailedAttempts = 0;
}

// Validate a submitted OTP against a user. Mutates attempt counters/clears the
// code as needed; caller persists. Returns { ok } or { ok:false, reason }.
async function checkOtp(user, otp) {
  if (!user || !user.mfaCode || !user.mfaCodeExpires) {
    return { ok: false, reason: 'invalid' };
  }
  if (new Date(user.mfaCodeExpires).getTime() < Date.now()) {
    clearOtpState(user);
    return { ok: false, reason: 'expired' };
  }
  if ((user.mfaFailedAttempts || 0) >= OTP_MAX_ATTEMPTS) {
    clearOtpState(user);
    return { ok: false, reason: 'attempts' };
  }
  const match = await verifyOtpHash(otp, user.mfaCode);
  if (!match) {
    user.mfaFailedAttempts = (user.mfaFailedAttempts || 0) + 1;
    if (user.mfaFailedAttempts >= OTP_MAX_ATTEMPTS) clearOtpState(user);
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true };
}

// @route POST /api/auth/verify-otp   (login step 2)
// Body: { email, otp }. Verifies the login OTP and issues tokens.
exports.verifyOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email: (email || '').toLowerCase() }).select(
      '+mfaCode +mfaCodeExpires +mfaFailedAttempts'
    );

    // Generic failure that doesn't reveal whether the email/MFA state exists.
    const generic = () =>
      res.status(400).json({ success: false, message: 'Invalid or expired code' });

    if (!user || !user.mfaEnabled) return generic();
    if (user.isActive === false) {
      return res.status(403).json({ success: false, message: 'Account has been disabled' });
    }

    const result = await checkOtp(user, otp);
    if (!result.ok) {
      await user.save();
      if (result.reason === 'expired') {
        return res.status(400).json({ success: false, message: 'Code expired. Please request a new one.' });
      }
      if (result.reason === 'attempts') {
        return res.status(429).json({ success: false, message: 'Too many attempts. Please request a new code.' });
      }
      req.setAudit?.('LOGIN_FAILED', { details: { email: user.email, reason: 'bad otp' } });
      return generic();
    }

    // Success: single-use — clear the code, then start a session.
    clearOtpState(user);
    await user.save();
    await logAttempt(req, user.email, true);
    req.setAudit?.('LOGIN_SUCCESS', {
      resource: 'user',
      resourceId: user._id,
      details: { email: user.email, mfa: true },
    });

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

// @route POST /api/auth/mfa/resend   (login step, rate limited)
// Body: { email }. Reissues a login OTP. Always responds generically.
exports.resendOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: (email || '').toLowerCase() });
    if (user && user.mfaEnabled) {
      await issueOtp(user);
    }
    return res.json({
      success: true,
      message: 'If verification is required, a new code has been sent.',
    });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/mfa/enable   (protected)
// Body: { password }. Confirms password, emails an OTP to confirm enabling.
exports.mfaEnable = async (req, res, next) => {
  try {
    const { password } = req.body;
    const user = await User.findById(req.user._id).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.mfaEnabled) {
      return res.status(400).json({ success: false, message: 'Two-factor is already enabled' });
    }
    if (!password || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ success: false, message: 'Password is incorrect' });
    }
    user.mfaPendingAction = 'enable';
    await issueOtp(user); // saves the user
    return res.json({ success: true, otpSent: true, message: 'A confirmation code was sent to your email.' });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/mfa/disable   (protected)
// Body: { password }. Confirms password, emails an OTP to confirm disabling.
exports.mfaDisable = async (req, res, next) => {
  try {
    const { password } = req.body;
    const user = await User.findById(req.user._id).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.mfaEnabled) {
      return res.status(400).json({ success: false, message: 'Two-factor is not enabled' });
    }
    if (!password || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ success: false, message: 'Password is incorrect' });
    }
    user.mfaPendingAction = 'disable';
    await issueOtp(user);
    return res.json({ success: true, otpSent: true, message: 'A confirmation code was sent to your email.' });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/mfa/verify   (protected)
// Body: { otp }. Confirms the pending enable/disable action.
exports.mfaVerifySetup = async (req, res, next) => {
  try {
    const { otp } = req.body;
    const user = await User.findById(req.user._id).select(
      '+mfaCode +mfaCodeExpires +mfaFailedAttempts +mfaPendingAction'
    );
    if (!user || !user.mfaPendingAction) {
      return res.status(400).json({ success: false, message: 'No pending 2FA change' });
    }

    const result = await checkOtp(user, otp);
    if (!result.ok) {
      await user.save();
      if (result.reason === 'expired') {
        return res.status(400).json({ success: false, message: 'Code expired. Please try again.' });
      }
      if (result.reason === 'attempts') {
        return res.status(429).json({ success: false, message: 'Too many attempts. Please try again.' });
      }
      return res.status(400).json({ success: false, message: 'Invalid code' });
    }

    const action = user.mfaPendingAction;
    user.mfaEnabled = action === 'enable';
    user.mfaPendingAction = null;
    clearOtpState(user);
    await user.save();

    req.setAudit?.(action === 'enable' ? 'MFA_ENABLED' : 'MFA_DISABLED', {
      resource: 'user',
      resourceId: user._id,
    });
    notify(user._id, {
      title: action === 'enable' ? 'Two-factor enabled' : 'Two-factor disabled',
      message:
        action === 'enable'
          ? 'Two-factor authentication is now protecting your account.'
          : 'Two-factor authentication has been turned off.',
      type: action === 'enable' ? 'success' : 'warning',
      link: '/profile',
    });

    return res.json({ success: true, mfaEnabled: user.mfaEnabled });
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
      recordAudit('SUSPICIOUS_ACTIVITY', req, {
        resource: 'session',
        resourceId: session._id,
        details: { reason: 'refresh token reuse detected', userId: String(user._id) },
      });
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
    req.setAudit?.('TOKEN_REFRESH', { resource: 'user', resourceId: user._id });
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
    req.setAudit?.('LOGOUT', { resource: 'user', resourceId: req.user?._id });
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

// =============================================================================
// PASSWORD RESET
// =============================================================================

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

// @route POST /api/auth/forgot-password
// Body: { email }. Sends a password-reset link. Never reveals if email exists.
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const normalizedEmail = (email || '').toLowerCase().trim();

    // Always return the same response regardless of whether the user exists.
    const genericResponse = () =>
      res.json({
        success: true,
        message: 'If that email exists, a reset link has been sent.',
      });

    if (!normalizedEmail) return genericResponse();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user || user.isActive === false) {
      // Log the attempt even for unknown emails (security telemetry).
      recordAudit('PASSWORD_RESET_REQUEST', req, {
        details: { email: normalizedEmail, found: false },
      });
      return genericResponse();
    }

    // Generate a secure random token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Store hashed token + expiry on the user
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await user.save();

    // Build the reset URL using the raw (unhashed) token
    const clientUrl = (process.env.CLIENT_URL || 'https://localhost:5173')
      .split(',')[0]
      .trim();
    const resetUrl = `${clientUrl}/reset-password/${rawToken}`;

    // Send the email (never let a failure leak to the client)
    const emailResult = await sendEmail({
      to: user.email,
      ...passwordResetEmail(resetUrl),
    });

    if (!emailResult || emailResult.success === false) {
      console.log(
        `[DEV RESET] Password reset link for ${user.email}: ${resetUrl}`
      );
    }

    recordAudit('PASSWORD_RESET_REQUEST', req, {
      resource: 'user',
      resourceId: user._id,
      details: { email: user.email },
    });

    return genericResponse();
  } catch (error) {
    next(error);
  }
};

// @route GET /api/auth/verify-reset-token/:token
// Checks if a reset token is valid and not expired (lets frontend show form vs error).
exports.verifyResetToken = async (req, res, next) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.json({ success: true, valid: false });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    }).select('+resetPasswordToken +resetPasswordExpires');

    return res.json({ success: true, valid: !!user });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/reset-password/:token
// Body: { newPassword }. Resets the password using a valid token.
exports.resetPassword = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { newPassword } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset link.',
      });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    }).select('+password +passwordHistory +resetPasswordToken +resetPasswordExpires');

    if (!user) {
      recordAudit('PASSWORD_RESET_FAILED', req, {
        details: { reason: 'invalid or expired token' },
      });
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset link.',
      });
    }

    // Validate new password against policy
    const policy = validatePassword(newPassword, { name: user.name, email: user.email });
    if (!policy.valid) {
      return res.status(400).json({
        success: false,
        message: policy.errors[0],
        errors: policy.errors,
      });
    }

    // Check password not in history (last 5)
    const history = user.passwordHistory || [];
    for (const oldHash of history) {
      const reused = await bcrypt.compare(newPassword, oldHash);
      if (reused) {
        return res.status(400).json({
          success: false,
          message: 'Cannot reuse any of your last 5 passwords.',
        });
      }
    }

    // Hash and save the new password
    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const now = new Date();

    // Update password history (keep last 5 including the new one)
    const updatedHistory = [hashedPassword, ...history].slice(0, 5);

    user.password = hashedPassword;
    user.passwordHistory = updatedHistory;
    user.passwordChangedAt = now;
    user.passwordExpiresAt = new Date(now.getTime() + PASSWORD_TTL_MS);

    // Clear the reset token (single-use)
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;

    // Invalidate all existing sessions
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    await Session.updateMany({ user: user._id }, { isActive: false });

    // Send confirmation email
    sendEmail({ to: user.email, ...passwordResetConfirmation() }).catch(() => {});

    // Notify the user in-app
    notify(user._id, {
      title: 'Password changed',
      message: 'Your password was reset successfully. All sessions have been logged out.',
      type: 'success',
      link: '/login',
    });

    recordAudit('PASSWORD_RESET_SUCCESS', req, {
      resource: 'user',
      resourceId: user._id,
      details: { email: user.email },
    });

    return res.json({
      success: true,
      message: 'Password has been reset successfully. Please log in with your new password.',
    });
  } catch (error) {
    next(error);
  }
};

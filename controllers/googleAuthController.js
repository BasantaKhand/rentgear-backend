const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const Session = require('../models/Session');
const { generateAccessToken, generateRefreshToken } = require('../utils/helpers');
const { setCsrfToken } = require('../middleware/csrf');
const { validatePassword } = require('../utils/passwordPolicy');
const { recordAudit } = require('../utils/audit');
const { notify, notifyAdmins } = require('../utils/notify');
const { sendEmail } = require('../config/email');
const { welcomeEmail } = require('../utils/emailTemplates');
const { generateOtp, hashOtp, verifyOtpHash, OTP_TTL_MS, OTP_MAX_ATTEMPTS } = require('../utils/otp');

const BCRYPT_ROUNDS = 12;
const PASSWORD_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 3;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const clientIp = (req) => req.ip || req.connection?.remoteAddress || '';

const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production' || process.env.USE_HTTPS === 'true',
  sameSite: 'strict',
  path: '/api/auth',
  signed: true,
  maxAge: REFRESH_TTL_MS,
};

function getOAuth2Client() {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );
}

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
  mfaMethod: user.mfaMethod || 'none',
  totpEnabled: !!user.totpEnabled,
  authProvider: user.authProvider || 'local',
  hasPassword: !!user.password,
  googleLinked: !!user.googleId,
  passwordExpiresAt: user.passwordExpiresAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

// Create session and issue tokens (same logic as authController.startSession)
async function startSession(req, res, user) {
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

// @route GET /api/auth/google
// Returns the Google OAuth authorization URL for the frontend to redirect to.
exports.getGoogleAuthUrl = async (req, res, next) => {
  try {
    const client = getOAuth2Client();

    // Generate a random state for CSRF protection
    const state = crypto.randomBytes(16).toString('hex');

    // Store state in a short-lived cookie for verification on callback
    res.cookie('oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || process.env.USE_HTTPS === 'true',
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000, // 5 minutes
      signed: true,
    });

    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      scope: ['email', 'profile'],
      state,
      prompt: 'select_account',
    });

    return res.json({ success: true, authUrl });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/auth/google/callback
// Google redirects here. Exchanges code for tokens, finds/creates user, redirects to frontend.
exports.googleCallback = async (req, res, next) => {
  try {
    const { code, state } = req.query;
    const storedState = req.signedCookies?.oauth_state;

    // Clear the state cookie
    res.clearCookie('oauth_state', { path: '/' });

    // Verify state (CSRF protection)
    if (!state || !storedState || state !== storedState) {
      recordAudit('OAUTH_STATE_MISMATCH', req, { details: { reason: 'state mismatch' } });
      const clientUrl = (process.env.CLIENT_URL || 'https://localhost:5173').split(',')[0].trim();
      return res.redirect(`${clientUrl}/login?error=oauth_failed`);
    }

    if (!code) {
      const clientUrl = (process.env.CLIENT_URL || 'https://localhost:5173').split(',')[0].trim();
      return res.redirect(`${clientUrl}/login?error=oauth_failed`);
    }

    const client = getOAuth2Client();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Verify and decode the ID token
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    const { sub: googleId, email, name, picture } = payload;

    if (!email) {
      const clientUrl = (process.env.CLIENT_URL || 'https://localhost:5173').split(',')[0].trim();
      return res.redirect(`${clientUrl}/login?error=no_email`);
    }

    // Find or create user
    let user = await User.findOne({ googleId }).select('+password');

    if (!user) {
      // Check if a local account with the same email exists
      user = await User.findOne({ email: email.toLowerCase() }).select('+password');

      if (user) {
        // Link Google to existing local account
        user.googleId = googleId;
        await user.save();
      } else {
        // Create a new user via Google
        user = await User.create({
          name: name || email.split('@')[0],
          email: email.toLowerCase(),
          googleId,
          authProvider: 'google',
          verified: true, // Google-verified email
        });

        sendEmail({ to: user.email, ...welcomeEmail(user) }).catch(() => {});
        notify(user._id, {
          title: 'Welcome to RentGear',
          message: 'Your account is ready. Browse equipment to get started.',
          type: 'success',
          link: '/equipment',
        });
        notifyAdmins({
          title: 'New user registered (Google)',
          message: `${user.name} (${user.email}) signed up via Google.`,
          type: 'user',
          link: '/admin/users',
        });
      }
    }

    if (user.isActive === false) {
      const clientUrl = (process.env.CLIENT_URL || 'https://localhost:5173').split(',')[0].trim();
      return res.redirect(`${clientUrl}/login?error=account_disabled`);
    }

    // MFA gate: if user has MFA enabled, redirect to frontend MFA page
    if (user.mfaEnabled) {
      const method = user.mfaMethod || 'email';

      // For email MFA, send the OTP now
      if (method === 'email') {
        const fullUser = await User.findById(user._id);
        const { generateOtp: genOtp, hashOtp: hOtp } = require('../utils/otp');
        const otpCode = genOtp();
        fullUser.mfaCode = await hOtp(otpCode);
        fullUser.mfaCodeExpires = new Date(Date.now() + OTP_TTL_MS);
        fullUser.mfaFailedAttempts = 0;
        await fullUser.save();

        // Send OTP email
        const { otpEmail } = require('../utils/emailTemplates');
        sendEmail({ to: fullUser.email, ...otpEmail(otpCode) }).catch((err) => {
          console.log(`[DEV OTP] Google OAuth login code for ${fullUser.email}: ${otpCode}`);
        });
      }

      recordAudit('GOOGLE_LOGIN_MFA_CHALLENGE', req, {
        resource: 'user',
        resourceId: user._id,
        details: { email: user.email, mfaMethod: method },
      });

      const clientUrl = (process.env.CLIENT_URL || 'https://localhost:5173').split(',')[0].trim();
      return res.redirect(
        `${clientUrl}/login?mfa_required=true&mfa_method=${method}&email=${encodeURIComponent(user.email)}`
      );
    }

    // No MFA: issue tokens and redirect to frontend
    const { accessToken, csrfToken } = await startSession(req, res, user);

    recordAudit('GOOGLE_LOGIN_SUCCESS', req, {
      resource: 'user',
      resourceId: user._id,
      details: { email: user.email },
    });

    const clientUrl = (process.env.CLIENT_URL || 'https://localhost:5173').split(',')[0].trim();
    return res.redirect(
      `${clientUrl}/login?google_success=true&access_token=${accessToken}&csrf_token=${csrfToken}`
    );
  } catch (error) {
    console.error('[Google OAuth] Callback error:', error.message);
    const clientUrl = (process.env.CLIENT_URL || 'https://localhost:5173').split(',')[0].trim();
    return res.redirect(`${clientUrl}/login?error=oauth_failed`);
  }
};

// @route POST /api/auth/google/verify
// Frontend sends the Google credential (ID token) for server-side verification.
// This is the preferred flow using Google's popup/one-tap.
exports.verifyGoogleToken = async (req, res, next) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ success: false, message: 'No credential provided' });
    }

    const client = getOAuth2Client();
    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid Google token' });
    }

    const { sub: googleId, email, name } = payload;
    if (!email) {
      return res.status(400).json({ success: false, message: 'No email in Google token' });
    }

    // Find or create user
    let user = await User.findOne({ googleId }).select('+password');

    if (!user) {
      user = await User.findOne({ email: email.toLowerCase() }).select('+password');

      if (user) {
        // Link Google to existing account
        user.googleId = googleId;
        await user.save();
      } else {
        // Create new user
        user = await User.create({
          name: name || email.split('@')[0],
          email: email.toLowerCase(),
          googleId,
          authProvider: 'google',
          verified: true,
        });

        sendEmail({ to: user.email, ...welcomeEmail(user) }).catch(() => {});
        notify(user._id, {
          title: 'Welcome to RentGear',
          message: 'Your account is ready. Browse equipment to get started.',
          type: 'success',
          link: '/equipment',
        });
        notifyAdmins({
          title: 'New user registered (Google)',
          message: `${user.name} (${user.email}) signed up via Google.`,
          type: 'user',
          link: '/admin/users',
        });
      }
    }

    if (user.isActive === false) {
      return res.status(403).json({ success: false, message: 'Account has been disabled' });
    }

    // MFA gate
    if (user.mfaEnabled) {
      const method = user.mfaMethod || 'email';

      if (method === 'email') {
        // Issue OTP
        const fullUser = await User.findById(user._id);
        const otpCode = require('../utils/otp').generateOtp();
        fullUser.mfaCode = await require('../utils/otp').hashOtp(otpCode);
        fullUser.mfaCodeExpires = new Date(Date.now() + OTP_TTL_MS);
        fullUser.mfaFailedAttempts = 0;
        await fullUser.save();

        const { otpEmail } = require('../utils/emailTemplates');
        sendEmail({ to: fullUser.email, ...otpEmail(otpCode) }).catch((err) => {
          console.log(`[DEV OTP] Google login code for ${fullUser.email}: ${otpCode}`);
        });
      }

      recordAudit('GOOGLE_LOGIN_MFA_CHALLENGE', req, {
        resource: 'user',
        resourceId: user._id,
        details: { email: user.email, mfaMethod: method },
      });

      return res.json({
        success: true,
        mfaRequired: true,
        mfaMethod: method,
        email: user.email,
        message: method === 'totp'
          ? 'Enter the code from your authenticator app.'
          : 'A verification code has been sent to your email.',
      });
    }

    // No MFA: issue tokens
    const { accessToken, csrfToken } = await startSession(req, res, user);

    recordAudit('GOOGLE_LOGIN_SUCCESS', req, {
      resource: 'user',
      resourceId: user._id,
      details: { email: user.email },
    });

    return res.json({
      success: true,
      accessToken,
      csrfToken,
      user: sanitizeUser(user),
    });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/google/link
// Links Google account to existing local user. Protected route.
exports.linkGoogle = async (req, res, next) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ success: false, message: 'No credential provided' });
    }

    const client = getOAuth2Client();
    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid Google token' });
    }

    const { sub: googleId } = payload;

    // Check if this Google ID is already linked to another account
    const existingUser = await User.findOne({ googleId });
    if (existingUser && existingUser._id.toString() !== req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'This Google account is already linked to another user.',
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (user.googleId) {
      return res.status(400).json({ success: false, message: 'Google account already linked' });
    }

    user.googleId = googleId;
    await user.save();

    recordAudit('GOOGLE_ACCOUNT_LINKED', req, {
      resource: 'user',
      resourceId: user._id,
    });

    return res.json({
      success: true,
      message: 'Google account linked successfully.',
      user: sanitizeUser(user),
    });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/google/unlink
// Unlinks Google from account. Requires password confirmation (must have local password).
exports.unlinkGoogle = async (req, res, next) => {
  try {
    const { password } = req.body;
    const user = await User.findById(req.user._id).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.googleId) {
      return res.status(400).json({ success: false, message: 'No Google account linked' });
    }

    // Ensure user has a local password (otherwise they'd be locked out)
    if (!user.password) {
      return res.status(400).json({
        success: false,
        message: 'Set a password before unlinking Google. Otherwise you cannot log in.',
      });
    }

    if (!password || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ success: false, message: 'Password is incorrect' });
    }

    user.googleId = null;
    await user.save();

    recordAudit('GOOGLE_ACCOUNT_UNLINKED', req, {
      resource: 'user',
      resourceId: user._id,
    });

    return res.json({
      success: true,
      message: 'Google account unlinked.',
      user: sanitizeUser(user),
    });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/auth/set-password
// For Google-only users to set a local password. Protected route.
exports.setPassword = async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+password +passwordHistory');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (user.password) {
      return res.status(400).json({
        success: false,
        message: 'You already have a password. Use change password instead.',
      });
    }

    // Validate password policy
    const policy = validatePassword(newPassword, { name: user.name, email: user.email });
    if (!policy.valid) {
      return res.status(400).json({
        success: false,
        message: policy.errors[0],
        errors: policy.errors,
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const now = new Date();

    user.password = hashedPassword;
    user.passwordHistory = [hashedPassword];
    user.passwordChangedAt = now;
    user.passwordExpiresAt = new Date(now.getTime() + PASSWORD_TTL_MS);
    await user.save();

    recordAudit('PASSWORD_SET', req, {
      resource: 'user',
      resourceId: user._id,
      details: { email: user.email, reason: 'google user set local password' },
    });

    return res.json({
      success: true,
      message: 'Password set successfully. You can now sign in with email and password.',
      user: sanitizeUser(user),
    });
  } catch (error) {
    next(error);
  }
};

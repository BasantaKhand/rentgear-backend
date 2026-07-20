const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const jwt = require('jsonwebtoken');

// -----------------------------------------------------------------------------
// Tuning
// -----------------------------------------------------------------------------
// Development gets 5x the limits so normal testing (and shared localhost IPs)
// never trip the limiter, while production stays strict.
const isProd = process.env.NODE_ENV === 'production';
const DEV_MULT = isProd ? 1 : 5;
const FIFTEEN_MIN = 15 * 60 * 1000;

// Authenticated users (valid access token) get a higher allowance than
// anonymous callers — we reward logged-in, well-behaved clients.
function hasValidJwt(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  try {
    jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

// A per-request limit that is higher for authenticated users, then scaled by
// the dev multiplier.
const tieredLimit = (anon, authed) => (req) =>
  (hasValidJwt(req) ? authed : anon) * DEV_MULT;

// -----------------------------------------------------------------------------
// Violation logging + friendly 429 handler
// -----------------------------------------------------------------------------
const violationCounts = new Map();
const ALERT_THRESHOLD = 50;

function logViolation(req, limiterName) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const ua = req.headers['user-agent'] || 'unknown';
  const count = (violationCounts.get(ip) || 0) + 1;
  violationCounts.set(ip, count);
  console.warn(
    `[RATE-LIMIT] ${new Date().toISOString()} limiter=${limiterName} ip=${ip} ` +
      `method=${req.method} path=${req.originalUrl} ua="${ua}" totalViolations=${count}`
  );
  if (count === ALERT_THRESHOLD) {
    try {
      const { notifyAdmins } = require('../utils/notify');
      notifyAdmins({
        title: 'Rate limit threshold exceeded',
        message: `IP ${ip} has triggered ${count} rate-limit violations.`,
        type: 'warning',
        link: '/admin',
      });
    } catch {
      /* best-effort */
    }
  }
}

// Build a 429 handler with a clear "try again in X minutes" message. This is
// explicitly a RATE LIMIT message — distinct from account lockout.
function makeHandler(limiterName) {
  return (req, res) => {
    logViolation(req, limiterName);
    const retryAfter = Number(res.getHeader('Retry-After')) || undefined;
    const minutes = retryAfter ? Math.max(1, Math.ceil(retryAfter / 60)) : null;
    const message = minutes
      ? `Too many requests. Please try again in ${minutes} minute(s).`
      : 'Too many requests. Please wait a moment and try again.';
    res.status(429).json({
      success: false,
      message,
      rateLimited: true,
      ...(retryAfter ? { retryAfter } : {}),
    });
  };
}

const commonOptions = {
  windowMs: FIFTEEN_MIN,
  standardHeaders: true,
  legacyHeaders: false,
};

// -----------------------------------------------------------------------------
// General API limiter (relaxed): all /api/* traffic.
// 200 / 15 min for anonymous, 500 / 15 min for authenticated (x5 in dev).
// Comfortably covers normal browsing, booking and admin dashboard usage.
// -----------------------------------------------------------------------------
const apiLimiter = rateLimit({
  ...commonOptions,
  limit: tieredLimit(200, 500),
  handler: makeHandler('api'),
});

// -----------------------------------------------------------------------------
// Auth limiter (strict): ONLY login + register. Brute-force prevention.
// 10 / 15 min per IP (x5 in dev).
// -----------------------------------------------------------------------------
const authLimiter = rateLimit({
  ...commonOptions,
  limit: 10 * DEV_MULT,
  handler: makeHandler('auth'),
});

// -----------------------------------------------------------------------------
// Password reset/change limiter: 5 / hour per IP (x5 in dev).
// -----------------------------------------------------------------------------
const passwordResetLimiter = rateLimit({
  ...commonOptions,
  windowMs: 60 * 60 * 1000,
  limit: 5 * DEV_MULT,
  handler: makeHandler('password-reset'),
});

// -----------------------------------------------------------------------------
// Admin action limiter (moderate): admin write operations.
// 60 / 15 min per IP (x5 in dev) — allows normal admin work, blocks mass ops.
// -----------------------------------------------------------------------------
const adminActionLimiter = rateLimit({
  ...commonOptions,
  limit: 60 * DEV_MULT,
  handler: makeHandler('admin-action'),
});

// -----------------------------------------------------------------------------
// Progressive slowdown for auth endpoints. Relaxed so a user mistyping a
// password a couple of times isn't slowed; effectively off in development.
// -----------------------------------------------------------------------------
const authSlowDown = slowDown({
  windowMs: FIFTEEN_MIN,
  delayAfter: isProd ? 5 : 1000,
  delayMs: (used) => (used - (isProd ? 5 : 1000)) * 500,
  maxDelayMs: 3000,
});

// -----------------------------------------------------------------------------
// OTP verification limiter: 5 attempts / 15 min per IP (x5 in dev).
// -----------------------------------------------------------------------------
const otpVerifyLimiter = rateLimit({
  ...commonOptions,
  limit: 5 * DEV_MULT,
  handler: makeHandler('otp-verify'),
});

// -----------------------------------------------------------------------------
// OTP resend limiter: 1 per minute per IP (x5 in dev).
// -----------------------------------------------------------------------------
const otpResendLimiter = rateLimit({
  ...commonOptions,
  windowMs: 60 * 1000,
  limit: 1 * DEV_MULT,
  handler: makeHandler('otp-resend'),
});

// -----------------------------------------------------------------------------
// Email recovery limiter: 1 per 5 minutes per IP (x5 in dev).
// Used for the TOTP email-fallback recovery flow.
// -----------------------------------------------------------------------------
const emailRecoveryLimiter = rateLimit({
  ...commonOptions,
  windowMs: 5 * 60 * 1000,
  limit: 1 * DEV_MULT,
  handler: makeHandler('email-recovery'),
});

module.exports = {
  apiLimiter,
  authLimiter,
  passwordResetLimiter,
  adminActionLimiter,
  authSlowDown,
  otpVerifyLimiter,
  otpResendLimiter,
  emailRecoveryLimiter,
};

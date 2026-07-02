const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');

// -----------------------------------------------------------------------------
// Violation logging
// -----------------------------------------------------------------------------
// Keep a rolling in-memory count of 429s per IP so we can alert an admin when an
// IP crosses a noisy threshold. This is best-effort telemetry, not security state.
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
    // Lazy require avoids a circular dependency at module load time.
    try {
      const { notifyAdmins } = require('../utils/notify');
      notifyAdmins({
        title: 'Rate limit threshold exceeded',
        message: `IP ${ip} has triggered ${count} rate-limit violations.`,
        type: 'warning',
        link: '/admin',
      });
    } catch {
      /* notifications are best-effort */
    }
  }
}

// Build a 429 handler that logs the violation and returns a generic message.
// We deliberately avoid leaking limiter internals (thresholds, windows) to
// callers beyond the standard Retry-After header.
function makeHandler(limiterName, message) {
  return (req, res /*, next, options */) => {
    logViolation(req, limiterName);
    const retryAfter = Number(res.getHeader('Retry-After')) || undefined;
    res.status(429).json({
      success: false,
      message,
      ...(retryAfter ? { retryAfter } : {}),
    });
  };
}

const commonOptions = {
  standardHeaders: true, // RateLimit-* headers (adds Retry-After on 429)
  legacyHeaders: false, // no X-RateLimit-* headers
};

// -----------------------------------------------------------------------------
// Global limiter: 100 requests / 15 min / IP, applied to everything.
// -----------------------------------------------------------------------------
const globalLimiter = rateLimit({
  ...commonOptions,
  windowMs: 15 * 60 * 1000,
  limit: 100,
  handler: makeHandler('global', 'Too many requests, please try again later'),
});

// -----------------------------------------------------------------------------
// API limiter: 60 requests / minute / IP for general API abuse prevention.
// -----------------------------------------------------------------------------
const apiLimiter = rateLimit({
  ...commonOptions,
  windowMs: 60 * 1000,
  limit: 60,
  handler: makeHandler('api', 'Too many requests, please slow down'),
});

// -----------------------------------------------------------------------------
// Auth limiter (strict): 5 requests / 15 min / IP on login & register.
// Once the limit is hit the window keeps the IP blocked for the remainder.
// -----------------------------------------------------------------------------
const authLimiter = rateLimit({
  ...commonOptions,
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: false,
  handler: makeHandler(
    'auth',
    'Too many attempts. Please wait before trying again.'
  ),
});

// -----------------------------------------------------------------------------
// Password reset/change limiter: 3 requests / hour / IP.
// -----------------------------------------------------------------------------
const passwordResetLimiter = rateLimit({
  ...commonOptions,
  windowMs: 60 * 60 * 1000,
  limit: 3,
  handler: makeHandler(
    'password-reset',
    'Too many password change attempts. Please try again later.'
  ),
});

// -----------------------------------------------------------------------------
// Admin action limiter: 30 write operations / minute / IP.
// Guards against accidental (or malicious) mass approve/reject/delete.
// -----------------------------------------------------------------------------
const adminActionLimiter = rateLimit({
  ...commonOptions,
  windowMs: 60 * 1000,
  limit: 30,
  handler: makeHandler(
    'admin-action',
    'Too many admin actions in a short time. Please slow down.'
  ),
});

// -----------------------------------------------------------------------------
// Progressive slowdown for auth endpoints: after 3 hits in the window, each
// further request is delayed an extra 500ms (capped at 5s). Makes brute-force
// impractical without hard-blocking legitimate users.
// -----------------------------------------------------------------------------
const authSlowDown = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 3,
  delayMs: (used) => (used - 3) * 500,
  maxDelayMs: 5000,
});

module.exports = {
  globalLimiter,
  apiLimiter,
  authLimiter,
  passwordResetLimiter,
  adminActionLimiter,
  authSlowDown,
};

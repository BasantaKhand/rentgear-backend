const AuditLog = require('../models/AuditLog');
const { writeToFiles, SECURITY_ACTIONS } = require('./fileLogger');
const { scrubDetails } = require('./logMask');

// Actions we surface loudly on the console (would page/email in production).
const CRITICAL = new Set(['SUSPICIOUS_ACTIVITY', 'ACCOUNT_LOCKED', 'ACCESS_DENIED', 'RATE_LIMITED']);

function clientIp(req) {
  return req.ip || req.connection?.remoteAddress || '';
}

// Persist an audit entry (DB + file). Fire-and-forget: never blocks or throws
// into the request path. `details` is always scrubbed of secrets.
function recordAudit(action, req, extra = {}) {
  const entry = {
    userId: req.user?._id || null,
    action,
    resource: extra.resource || null,
    resourceId: extra.resourceId != null ? String(extra.resourceId) : null,
    details: scrubDetails(extra.details || {}),
    ip: clientIp(req),
    userAgent: req.headers?.['user-agent'] || '',
    method: req.method,
    endpoint: req.originalUrl,
    statusCode: extra.statusCode || 0,
    timestamp: new Date(),
  };

  // Console alert for critical security events.
  if (CRITICAL.has(action)) {
    console.warn(`[ALERT] ${action} ip=${entry.ip} user=${entry.userId || 'anon'} ${entry.method} ${entry.endpoint}`);
  }

  // File backup (sync-free append).
  try {
    writeToFiles({ ...entry, timestamp: entry.timestamp.toISOString() });
  } catch {
    /* file logging must never break the request */
  }

  // Database (async, swallow errors so logging can't affect responses).
  AuditLog.create(entry).catch((err) => {
    console.error('[audit] DB write failed:', err.message);
  });
}

module.exports = { recordAudit, SECURITY_ACTIONS };

// Centralized logging for access-control violations. Records who, from where,
// what endpoint, and when — so suspicious activity is auditable in one format.
// Kept dependency-free (console) to avoid coupling; a real deployment could
// swap this for a persistent audit store.

function logSecurityEvent(type, req, details = {}) {
  const entry = {
    type, // e.g. 'AUTHZ_DENIED', 'IDOR_ATTEMPT', 'MASS_ASSIGNMENT', 'ROLE_CHANGE'
    timestamp: new Date().toISOString(),
    userId: req.user ? String(req.user._id) : null,
    role: req.user ? req.user.role : null,
    ip: req.ip || req.connection?.remoteAddress || 'unknown',
    method: req.method,
    endpoint: req.originalUrl,
    userAgent: req.headers?.['user-agent'] || 'unknown',
    ...details,
  };
  console.warn(`[SECURITY] ${JSON.stringify(entry)}`);
  return entry;
}

module.exports = { logSecurityEvent };

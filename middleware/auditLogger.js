const { recordAudit } = require('../utils/audit');

// Attaches an audit helper to the request and, once the response is sent,
// writes a single audit entry. Controllers enrich the entry via req.setAudit().
//
// What gets logged automatically:
//  - every POST / PUT / DELETE (state-changing)
//  - every 401 / 403 / 429 (auth, authz, rate limiting) on any method
//  - anything a controller explicitly tagged with req.setAudit()
// Noisy public GETs that succeed are skipped.
function auditLogger(req, res, next) {
  req.audit = { action: null, resource: null, resourceId: null, details: {} };

  // Controllers call this to tag the request with a specific action + context.
  req.setAudit = (action, extra = {}) => {
    req.audit.action = action;
    if (extra.resource !== undefined) req.audit.resource = extra.resource;
    if (extra.resourceId !== undefined) req.audit.resourceId = extra.resourceId;
    if (extra.details) Object.assign(req.audit.details, extra.details);
  };

  res.on('finish', () => {
    const status = res.statusCode;
    const method = req.method;
    let action = req.audit.action;

    if (!action) {
      if (status === 401) action = 'INVALID_TOKEN';
      else if (status === 403) action = 'ACCESS_DENIED';
      else if (status === 429) action = 'RATE_LIMITED';
      else if (['POST', 'PUT', 'DELETE'].includes(method)) action = 'REQUEST';
    }

    // Nothing worth recording (e.g. a successful public GET).
    if (!action) return;

    recordAudit(action, req, {
      resource: req.audit.resource,
      resourceId: req.audit.resourceId,
      details: req.audit.details,
      statusCode: status,
    });
  });

  next();
}

module.exports = auditLogger;

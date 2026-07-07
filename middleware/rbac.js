const { logSecurityEvent } = require('../utils/securityLog');

// Role-based authorization. Usage: authorize('admin') or authorize('admin','customer').
// Must run after the auth middleware (which sets req.user).
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      logSecurityEvent('AUTHZ_NO_USER', req, { requiredRoles: allowedRoles });
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      logSecurityEvent('AUTHZ_DENIED', req, {
        requiredRoles: allowedRoles,
        actualRole: req.user.role,
      });
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions',
      });
    }
    next();
  };
}

module.exports = { authorize };

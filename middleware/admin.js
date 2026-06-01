// Requires that the authenticated user has the admin role.
// Must be used after the auth middleware.
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({ message: 'Access denied: admin only' });
};

module.exports = admin;

// Redirect HTTP to HTTPS in production. Behind a proxy/load balancer the real
// protocol arrives in the X-Forwarded-Proto header (trust proxy is enabled in
// server.js). In development we allow plain HTTP so localhost keeps working.
function httpsRedirect(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();

  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  if (proto === 'https') return next();

  // Only redirect safe, idempotent GET/HEAD requests; reject others so clients
  // don't silently resend a mutation over the wrong scheme.
  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  return res.status(403).json({ success: false, message: 'HTTPS is required' });
}

module.exports = httpsRedirect;

const crypto = require('crypto');

// Double-submit CSRF protection for cookie-authenticated endpoints (the refresh
// endpoint uses the httpOnly refresh cookie, so it needs CSRF defense).
//
// Flow: the server issues a random token, sets it as a readable cookie AND
// returns it in the response body. The client echoes it in the X-CSRF-Token
// header on protected requests. Because a cross-site attacker can neither read
// the cookie value nor set a custom header, forged requests fail the match.

const CSRF_COOKIE = 'csrfToken';
const csrfCookieOptions = {
  httpOnly: false, // must be sent by the browser; value comes from the body client-side
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// Attach a fresh CSRF token to the response (cookie + returns the value).
function setCsrfToken(res) {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, token, csrfCookieOptions);
  return token;
}

// Verify the header matches the cookie using a constant-time comparison.
function verifyCsrf(req, res, next) {
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get('X-CSRF-Token');

  if (!cookieToken || !headerToken) {
    return res.status(403).json({ success: false, message: 'CSRF token missing' });
  }

  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ success: false, message: 'CSRF token invalid' });
  }
  next();
}

module.exports = { setCsrfToken, verifyCsrf, CSRF_COOKIE };

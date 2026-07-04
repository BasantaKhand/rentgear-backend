const express = require('express');
const router = express.Router();

const {
  register,
  login,
  getMe,
  logout,
  logoutAll,
  refreshToken,
  getCaptcha,
  getCsrfToken,
  getSessions,
  revokeSession,
} = require('../controllers/authController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { authLimiter, authSlowDown } = require('../middleware/rateLimiter');
const { verifyCsrf } = require('../middleware/csrf');
const { registerRules, loginRules, isValidObjectId } = require('../middleware/validator');

// @route  GET /api/auth/captcha
router.get('/captcha', getCaptcha);

// @route  GET /api/auth/csrf-token
router.get('/csrf-token', getCsrfToken);

// @route  POST /api/auth/register
router.post('/register', authLimiter, authSlowDown, registerRules, validate, register);

// @route  POST /api/auth/login
router.post('/login', authLimiter, authSlowDown, loginRules, validate, login);

// @route  POST /api/auth/refresh-token  (CSRF double-submit protected)
router.post('/refresh-token', verifyCsrf, refreshToken);

// @route  GET /api/auth/me
router.get('/me', auth, getMe);

// @route  POST /api/auth/logout
router.post('/logout', auth, logout);

// @route  POST /api/auth/logout-all
router.post('/logout-all', auth, logoutAll);

// @route  GET /api/auth/sessions
router.get('/sessions', auth, getSessions);

// @route  DELETE /api/auth/sessions/:id
router.delete('/sessions/:id', auth, isValidObjectId('id'), revokeSession);

module.exports = router;

const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const {
  register,
  login,
  getMe,
  logout,
} = require('../controllers/authController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');

// @route  POST /api/auth/register
router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
    body('phone').trim().notEmpty().withMessage('Phone is required'),
  ],
  validate,
  register
);

// @route  POST /api/auth/login
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  login
);

// @route  GET /api/auth/me
router.get('/me', auth, getMe);

// @route  POST /api/auth/logout
router.post('/logout', auth, logout);

module.exports = router;

const { body, param, query } = require('express-validator');
const mongoose = require('mongoose');
const { validatePassword } = require('../utils/passwordPolicy');

const CATEGORIES = ['cameras', 'tools', 'sports', 'electronics', 'audio', 'lighting'];
const PAYMENT_METHODS = ['card', 'cash'];

// Permissive international phone format: digits, spaces and + - ( ) , 7-20 long.
const PHONE_REGEX = /^[+]?[\d\s()-]{7,20}$/;
// Names: letters, spaces, hyphen, apostrophe, period (covers most real names).
const NAME_REGEX = /^[a-zA-Z0-9\s'.-]{2,50}$/;

// Escape regex metacharacters so user search input can't inject a pattern or
// trigger catastrophic backtracking (ReDoS).
const escapeRegex = (str = '') => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Reusable password-policy validator (needs name/email from the same body).
const passwordMeetsPolicy = (field) =>
  body(field).custom((value, { req }) => {
    const result = validatePassword(value, {
      name: req.body.name,
      email: req.body.email,
    });
    if (!result.valid) {
      throw new Error(result.errors[0]);
    }
    return true;
  });

// --- Auth ---
const registerRules = [
  body('name')
    .trim()
    .matches(NAME_REGEX)
    .withMessage('Name must be 2-50 characters (letters, numbers and spaces)'),
  body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
  passwordMeetsPolicy('password'),
  body('phone').trim().matches(PHONE_REGEX).withMessage('A valid phone number is required'),
];

const loginRules = [
  body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
];

// --- Equipment ---
const equipmentCreateRules = [
  body('name').trim().isLength({ min: 3, max: 100 }).withMessage('Name must be 3-100 characters'),
  body('category').isIn(CATEGORIES).withMessage(`Category must be one of: ${CATEGORIES.join(', ')}`),
  body('description').trim().isLength({ max: 500 }).withMessage('Description must be at most 500 characters'),
  body('dailyRate').isFloat({ min: 0, max: 10000 }).withMessage('Daily rate must be between 0 and 10000'),
  body('quantity').isInt({ min: 0, max: 100 }).withMessage('Quantity must be an integer between 0 and 100'),
];

const equipmentUpdateRules = [
  body('name').optional().trim().isLength({ min: 3, max: 100 }).withMessage('Name must be 3-100 characters'),
  body('category').optional().isIn(CATEGORIES).withMessage(`Category must be one of: ${CATEGORIES.join(', ')}`),
  body('description').optional().trim().isLength({ max: 500 }).withMessage('Description must be at most 500 characters'),
  body('dailyRate').optional().isFloat({ min: 0, max: 10000 }).withMessage('Daily rate must be between 0 and 10000'),
  body('quantity').optional().isInt({ min: 0, max: 100 }).withMessage('Quantity must be an integer between 0 and 100'),
];

// --- Booking ---
const bookingCreateRules = [
  body('equipmentId').isMongoId().withMessage('A valid equipmentId is required'),
  body('startDate')
    .isISO8601()
    .withMessage('A valid startDate is required')
    .custom((value) => {
      const start = new Date(value);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (start < today) throw new Error('startDate cannot be in the past');
      return true;
    }),
  body('endDate')
    .isISO8601()
    .withMessage('A valid endDate is required')
    .custom((value, { req }) => {
      const start = new Date(req.body.startDate);
      const end = new Date(value);
      if (end <= start) throw new Error('endDate must be after startDate');
      const maxMs = 30 * 24 * 60 * 60 * 1000;
      if (end - start > maxMs) throw new Error('Rental period cannot exceed 30 days');
      return true;
    }),
];

// --- Profile ---
const profileUpdateRules = [
  body('name').optional().trim().matches(NAME_REGEX).withMessage('Name must be 2-50 characters'),
  body('phone').optional().trim().matches(PHONE_REGEX).withMessage('A valid phone number is required'),
  body('address').optional().trim().isLength({ max: 200 }).withMessage('Address must be at most 200 characters'),
];

const changePasswordRules = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  passwordMeetsPolicy('newPassword'),
];

// --- Payment ---
const paymentCreateRules = [
  body('bookingId').isMongoId().withMessage('A valid bookingId is required'),
  body('method').isIn(PAYMENT_METHODS).withMessage(`Method must be one of: ${PAYMENT_METHODS.join(', ')}`),
];

// --- Reusable param / query middlewares ---
// Validate a route param is a 24-char hex ObjectId; 400 instead of a 500 cast error.
const isValidObjectId = (paramName = 'id') => (req, res, next) => {
  const value = req.params[paramName];
  if (!mongoose.Types.ObjectId.isValid(value) || String(value).length !== 24) {
    return res
      .status(400)
      .json({ success: false, message: `Invalid ${paramName}` });
  }
  next();
};

// Clamp pagination + sanitize search into safe values on req.query.
const paginationRules = [
  query('page').optional().toInt().isInt({ min: 1, max: 1000 }).withMessage('page must be 1-1000'),
  query('limit').optional().toInt().isInt({ min: 1, max: 100 }).withMessage('limit must be 1-100'),
  query('search').optional().isString().isLength({ max: 100 }).withMessage('search must be at most 100 characters'),
];

module.exports = {
  registerRules,
  loginRules,
  equipmentCreateRules,
  equipmentUpdateRules,
  bookingCreateRules,
  profileUpdateRules,
  changePasswordRules,
  paymentCreateRules,
  isValidObjectId,
  paginationRules,
  escapeRegex,
  CATEGORIES,
  PAYMENT_METHODS,
};

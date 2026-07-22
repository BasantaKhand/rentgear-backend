const express = require('express');
const router = express.Router();

const {
  getProfile,
  updateProfile,
  uploadIdDocument,
  getRentalHistory,
  changePassword,
} = require('../controllers/userController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { uploadId, handleUpload, processUpload } = require('../middleware/upload');
const { passwordResetLimiter } = require('../middleware/rateLimiter');
const { profileUpdateRules, changePasswordRules } = require('../middleware/validator');
const { verifyCsrf } = require('../middleware/csrf');

// @route  GET /api/users/profile
router.get('/profile', auth, getProfile);

// @route  PUT /api/users/profile
// VULN-2 fix: state-changing requests require a valid CSRF token (double-submit).
router.put('/profile', auth, verifyCsrf, profileUpdateRules, validate, updateProfile);

// @route  POST /api/users/upload-id
router.post(
  '/upload-id',
  auth,
  verifyCsrf,
  handleUpload(uploadId.single('idDocument')),
  processUpload('ids'),
  uploadIdDocument
);

// @route  GET /api/users/rental-history
router.get('/rental-history', auth, getRentalHistory);

// @route  PUT /api/users/change-password
router.put(
  '/change-password',
  auth,
  verifyCsrf,
  passwordResetLimiter,
  changePasswordRules,
  validate,
  changePassword
);

module.exports = router;

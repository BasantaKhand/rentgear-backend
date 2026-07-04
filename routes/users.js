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

// @route  GET /api/users/profile
router.get('/profile', auth, getProfile);

// @route  PUT /api/users/profile
router.put('/profile', auth, profileUpdateRules, validate, updateProfile);

// @route  POST /api/users/upload-id
router.post(
  '/upload-id',
  auth,
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
  passwordResetLimiter,
  changePasswordRules,
  validate,
  changePassword
);

module.exports = router;

const express = require('express');
const { body } = require('express-validator');
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
const { uploadId, handleUpload } = require('../middleware/upload');

// @route  GET /api/users/profile
router.get('/profile', auth, getProfile);

// @route  PUT /api/users/profile
router.put(
  '/profile',
  auth,
  [
    body('name')
      .optional()
      .trim()
      .notEmpty()
      .withMessage('Name cannot be empty'),
    body('phone')
      .optional()
      .trim()
      .notEmpty()
      .withMessage('Phone cannot be empty'),
    body('address').optional().trim(),
  ],
  validate,
  updateProfile
);

// @route  POST /api/users/upload-id
router.post(
  '/upload-id',
  auth,
  handleUpload(uploadId.single('idDocument')),
  uploadIdDocument
);

// @route  GET /api/users/rental-history
router.get('/rental-history', auth, getRentalHistory);

// @route  PUT /api/users/change-password
router.put(
  '/change-password',
  auth,
  [
    body('currentPassword')
      .notEmpty()
      .withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 6 })
      .withMessage('New password must be at least 6 characters'),
  ],
  validate,
  changePassword
);

module.exports = router;

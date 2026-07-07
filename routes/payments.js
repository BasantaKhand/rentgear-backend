const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const {
  createPayment,
  getMyPayments,
  getPaymentByBooking,
  updatePaymentStatus,
} = require('../controllers/paymentController');
const auth = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { verifyPaymentBookingOwnership } = require('../middleware/ownership');
const validate = require('../middleware/validate');
const { paymentCreateRules, isValidObjectId } = require('../middleware/validator');

const admin = authorize('admin');

// All payment routes require authentication
router.use(auth);

// @route  POST /api/payments
router.post('/', paymentCreateRules, validate, createPayment);

// @route  GET /api/payments/my  (declared before "/:bookingId")
router.get('/my', getMyPayments);

// @route  PUT /api/payments/:id/status  (admin only)
router.put(
  '/:id/status',
  admin,
  isValidObjectId('id'),
  [body('status').notEmpty().withMessage('Status is required')],
  validate,
  updatePaymentStatus
);

// @route  GET /api/payments/:bookingId  (owner or admin)
router.get(
  '/:bookingId',
  isValidObjectId('bookingId'),
  verifyPaymentBookingOwnership('bookingId'),
  getPaymentByBooking
);

module.exports = router;

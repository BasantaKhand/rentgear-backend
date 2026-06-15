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
const admin = require('../middleware/admin');
const validate = require('../middleware/validate');

// All payment routes require authentication
router.use(auth);

// @route  POST /api/payments
router.post(
  '/',
  [
    body('bookingId').isMongoId().withMessage('Valid bookingId is required'),
    body('method')
      .isIn(['card', 'cash'])
      .withMessage('Method must be card or cash'),
  ],
  validate,
  createPayment
);

// @route  GET /api/payments/my  (declared before "/:bookingId")
router.get('/my', getMyPayments);

// @route  PUT /api/payments/:id/status  (admin only)
router.put(
  '/:id/status',
  admin,
  [body('status').notEmpty().withMessage('Status is required')],
  validate,
  updatePaymentStatus
);

// @route  GET /api/payments/:bookingId
router.get('/:bookingId', getPaymentByBooking);

module.exports = router;

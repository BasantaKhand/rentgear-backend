const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const {
  createBooking,
  checkout,
  getMyBookings,
  getBookingById,
  cancelBooking,
  getReturnInfo,
  extendBooking,
  applyLateFee,
  markReturned,
  getInvoice,
  downloadInvoice,
} = require('../controllers/bookingController');
const auth = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { verifyBookingOwnership } = require('../middleware/ownership');
const validate = require('../middleware/validate');
const { bookingCreateRules, isValidObjectId } = require('../middleware/validator');

const admin = authorize('admin');

// All booking routes require authentication
router.use(auth);

// @route  POST /api/bookings
router.post('/', bookingCreateRules, validate, createBooking);

// @route  POST /api/bookings/checkout
router.post(
  '/checkout',
  [body('items').isArray({ min: 1 }).withMessage('items must be a non-empty array')],
  validate,
  checkout
);

// @route  GET /api/bookings/my
router.get('/my', getMyBookings);

// @route  GET /api/bookings/:id  (owner or admin)
router.get('/:id', isValidObjectId('id'), verifyBookingOwnership('id'), getBookingById);

// @route  PUT /api/bookings/:id/cancel  (owner or admin)
router.put('/:id/cancel', isValidObjectId('id'), verifyBookingOwnership('id'), cancelBooking);

// @route  GET /api/bookings/:id/return-info  (owner or admin)
router.get('/:id/return-info', isValidObjectId('id'), verifyBookingOwnership('id'), getReturnInfo);

// @route  PUT /api/bookings/:id/extend  (owner or admin)
router.put(
  '/:id/extend',
  isValidObjectId('id'),
  verifyBookingOwnership('id'),
  [body('newEndDate').notEmpty().withMessage('newEndDate is required')],
  validate,
  extendBooking
);

// @route  POST /api/bookings/:id/late-fee  (admin)
router.post('/:id/late-fee', admin, isValidObjectId('id'), applyLateFee);

// @route  PUT /api/bookings/:id/return  (admin)
router.put('/:id/return', admin, isValidObjectId('id'), markReturned);

// @route  GET /api/bookings/:id/invoice  (owner or admin)
router.get('/:id/invoice', isValidObjectId('id'), verifyBookingOwnership('id'), getInvoice);

// @route  GET /api/bookings/:id/invoice/download  (owner or admin)
router.get('/:id/invoice/download', isValidObjectId('id'), verifyBookingOwnership('id'), downloadInvoice);

module.exports = router;

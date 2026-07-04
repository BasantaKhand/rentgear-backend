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
const admin = require('../middleware/admin');
const validate = require('../middleware/validate');
const { bookingCreateRules, isValidObjectId } = require('../middleware/validator');

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

// @route  GET /api/bookings/:id
router.get('/:id', isValidObjectId('id'), getBookingById);

// @route  PUT /api/bookings/:id/cancel
router.put('/:id/cancel', isValidObjectId('id'), cancelBooking);

// @route  GET /api/bookings/:id/return-info
router.get('/:id/return-info', isValidObjectId('id'), getReturnInfo);

// @route  PUT /api/bookings/:id/extend
router.put(
  '/:id/extend',
  isValidObjectId('id'),
  [body('newEndDate').notEmpty().withMessage('newEndDate is required')],
  validate,
  extendBooking
);

// @route  POST /api/bookings/:id/late-fee  (admin)
router.post('/:id/late-fee', admin, isValidObjectId('id'), applyLateFee);

// @route  PUT /api/bookings/:id/return  (admin)
router.put('/:id/return', admin, isValidObjectId('id'), markReturned);

// @route  GET /api/bookings/:id/invoice
router.get('/:id/invoice', isValidObjectId('id'), getInvoice);

// @route  GET /api/bookings/:id/invoice/download
router.get('/:id/invoice/download', isValidObjectId('id'), downloadInvoice);

module.exports = router;

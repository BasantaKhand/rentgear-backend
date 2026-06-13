const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const {
  createBooking,
  checkout,
  getMyBookings,
  getBookingById,
  cancelBooking,
} = require('../controllers/bookingController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');

// All booking routes require authentication
router.use(auth);

// @route  POST /api/bookings
router.post(
  '/',
  [
    body('equipmentId').isMongoId().withMessage('Valid equipmentId is required'),
    body('startDate').notEmpty().withMessage('startDate is required'),
    body('endDate').notEmpty().withMessage('endDate is required'),
  ],
  validate,
  createBooking
);

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
router.get('/:id', getBookingById);

// @route  PUT /api/bookings/:id/cancel
router.put('/:id/cancel', cancelBooking);

module.exports = router;

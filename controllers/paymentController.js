const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const { simulatePayment } = require('../utils/helpers');
const { sendEmail } = require('../config/email');
const { paymentReceipt } = require('../utils/emailTemplates');
const { notify } = require('../utils/notify');

// Reusable: create and settle a payment for a booking.
// - card: simulate the gateway; on success mark payment completed and
//   move the booking to "approved".
// - cash: leave payment pending (pay at pickup).
// Exported so the booking checkout flow can reuse it.
async function settleBookingPayment(booking, method, transactionId = null) {
  const amount = booking.totalPrice + booking.deposit;

  const payment = new Payment({
    booking: booking._id,
    amount,
    method,
    status: 'pending',
    transactionId,
  });

  if (method === 'card') {
    const result = simulatePayment();
    if (result.success) {
      payment.status = 'completed';
      payment.transactionId = transactionId || result.transactionId;
      booking.status = 'approved';
      await booking.save();
    } else {
      payment.status = 'failed';
    }
  }

  await payment.save();
  return payment;
}

// @route  POST /api/payments
// @desc   Create a payment for a booking
// @access Private
exports.createPayment = async (req, res, next) => {
  try {
    const { bookingId, method, transactionId } = req.body;

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' });
    }

    if (booking.user.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ success: false, message: 'Not authorized for this booking' });
    }

    if (!['pending', 'approved'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot pay for a booking that is ${booking.status}`,
      });
    }

    // Prevent duplicate successful payments
    const existing = await Payment.findOne({
      booking: bookingId,
      status: { $in: ['pending', 'completed'] },
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A payment already exists for this booking',
      });
    }

    const payment = await settleBookingPayment(booking, method, transactionId);
    await payment.populate('booking');

    // Send a payment receipt (non-blocking) for completed payments
    if (payment.status === 'completed') {
      sendEmail({
        to: req.user.email,
        ...paymentReceipt(payment, booking),
      }).catch(() => {});
      notify(req.user._id, {
        title: 'Payment received',
        message: `We received your payment of $${payment.amount.toFixed(2)}.`,
        type: 'payment',
        link: '/my-bookings',
      });
    }

    return res.status(201).json({ success: true, payment });
  } catch (error) {
    next(error);
  }
};

// @route  GET /api/payments/my
// @desc   Get all payments for the current user's bookings
// @access Private
exports.getMyPayments = async (req, res, next) => {
  try {
    const bookings = await Booking.find({ user: req.user._id }).select('_id');
    const bookingIds = bookings.map((b) => b._id);

    const payments = await Payment.find({ booking: { $in: bookingIds } })
      .populate({ path: 'booking', populate: { path: 'equipment' } })
      .sort({ createdAt: -1 });

    return res.json({ success: true, count: payments.length, payments });
  } catch (error) {
    next(error);
  }
};

// @route  GET /api/payments/:bookingId
// @desc   Get the payment for a booking (owner or admin)
// @access Private
exports.getPaymentByBooking = async (req, res, next) => {
  try {
    const payment = await Payment.findOne({ booking: req.params.bookingId })
      .populate({ path: 'booking', populate: { path: 'equipment' } });

    if (!payment) {
      return res
        .status(404)
        .json({ success: false, message: 'Payment not found' });
    }

    const ownerId = payment.booking.user.toString();
    const isOwner = ownerId === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res
        .status(403)
        .json({ success: false, message: 'Not authorized to view this payment' });
    }

    return res.json({ success: true, payment });
  } catch (error) {
    next(error);
  }
};

// @route  PUT /api/payments/:id/status
// @desc   Update a payment's status (admin)
// @access Private/Admin
exports.updatePaymentStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowed = ['completed', 'failed', 'refunded'];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${allowed.join(', ')}`,
      });
    }

    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res
        .status(404)
        .json({ success: false, message: 'Payment not found' });
    }

    payment.status = status;
    await payment.save();

    // Refund cancels the associated booking
    if (status === 'refunded') {
      await Booking.findByIdAndUpdate(payment.booking, { status: 'cancelled' });
    }

    await payment.populate('booking');
    return res.json({ success: true, payment });
  } catch (error) {
    next(error);
  }
};

exports.settleBookingPayment = settleBookingPayment;

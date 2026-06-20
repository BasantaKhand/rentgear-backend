const Booking = require('../models/Booking');
const Equipment = require('../models/Equipment');
const Payment = require('../models/Payment');
const { settleBookingPayment } = require('./paymentController');
const {
  calculateDays,
  checkAvailability,
  startOfDay,
  calculateOverdue,
  getReturnInstructions,
} = require('../utils/helpers');
const { buildInvoiceData, streamInvoicePDF } = require('../utils/invoiceGenerator');
const { sendEmail } = require('../config/email');
const {
  bookingConfirmation,
  bookingStatusUpdate,
  paymentReceipt,
} = require('../utils/emailTemplates');

// Validate a single booking's dates. Returns an error string or null.
function validateDates(startDate, endDate) {
  const start = startOfDay(startDate);
  const end = startOfDay(endDate);
  const today = startOfDay(new Date());

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return 'Invalid start or end date';
  }
  if (start < today) {
    return 'Start date must be today or in the future';
  }
  if (end <= start) {
    return 'End date must be after the start date';
  }
  return null;
}

// Build a booking for one equipment item after all checks pass.
async function buildBooking(userId, equipmentId, startDate, endDate) {
  const equipment = await Equipment.findById(equipmentId);
  if (!equipment) {
    return { error: 'Equipment not found', status: 404 };
  }
  if (!equipment.available) {
    return { error: `${equipment.name} is not available`, status: 400 };
  }

  const dateError = validateDates(startDate, endDate);
  if (dateError) {
    return { error: dateError, status: 400 };
  }

  const isAvailable = await checkAvailability(equipmentId, startDate, endDate);
  if (!isAvailable) {
    return {
      error: `${equipment.name} is not available for the selected dates`,
      status: 409,
    };
  }

  const days = calculateDays(startDate, endDate);
  const totalPrice = equipment.dailyRate * days;
  const deposit = Math.round(totalPrice * 0.5 * 100) / 100;

  const booking = await Booking.create({
    user: userId,
    equipment: equipmentId,
    startDate,
    endDate,
    totalPrice,
    deposit,
    status: 'pending',
  });

  return { booking };
}

// @route  POST /api/bookings
// @desc   Create a single booking
// @access Private
exports.createBooking = async (req, res, next) => {
  try {
    const { equipmentId, startDate, endDate } = req.body;

    const result = await buildBooking(
      req.user._id,
      equipmentId,
      startDate,
      endDate
    );
    if (result.error) {
      return res
        .status(result.status)
        .json({ success: false, message: result.error });
    }

    const booking = await result.booking.populate('equipment');
    return res.status(201).json({ success: true, booking });
  } catch (error) {
    next(error);
  }
};

// @route  POST /api/bookings/checkout
// @desc   Create bookings for multiple items at once
// @access Private
exports.checkout = async (req, res, next) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: 'Items array is required' });
    }

    // Validate every item first so we don't create partial bookings
    for (const [index, item] of items.entries()) {
      const { equipmentId, startDate, endDate } = item || {};
      if (!equipmentId || !startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: `Item ${index + 1} is missing equipmentId, startDate or endDate`,
        });
      }
      const equipment = await Equipment.findById(equipmentId);
      if (!equipment) {
        return res.status(404).json({
          success: false,
          message: `Item ${index + 1}: equipment not found`,
        });
      }
      const dateError = validateDates(startDate, endDate);
      if (dateError) {
        return res
          .status(400)
          .json({ success: false, message: `Item ${index + 1}: ${dateError}` });
      }
      const available = await checkAvailability(equipmentId, startDate, endDate);
      if (!available) {
        return res.status(409).json({
          success: false,
          message: `Item ${index + 1}: ${equipment.name} is not available for the selected dates`,
        });
      }
    }

    // Payment method for the whole checkout (defaults to card)
    const paymentMethod = ['card', 'cash'].includes(req.body.paymentMethod)
      ? req.body.paymentMethod
      : 'card';

    // All valid: create bookings and a payment record for each
    const createdBookings = [];
    const createdPayments = [];
    for (const item of items) {
      const result = await buildBooking(
        req.user._id,
        item.equipmentId,
        item.startDate,
        item.endDate
      );
      if (result.booking) {
        const payment = await settleBookingPayment(result.booking, paymentMethod);
        createdPayments.push(payment);
        const populated = await result.booking.populate('equipment');
        createdBookings.push(populated);

        // Notify: booking confirmation + payment receipt (non-blocking)
        sendEmail({
          to: req.user.email,
          ...bookingConfirmation(populated),
        }).catch(() => {});
        if (payment.status === 'completed') {
          sendEmail({
            to: req.user.email,
            ...paymentReceipt(payment, populated),
          }).catch(() => {});
        }
      }
    }

    return res.status(201).json({
      success: true,
      count: createdBookings.length,
      bookings: createdBookings,
      payments: createdPayments,
    });
  } catch (error) {
    next(error);
  }
};

// @route  GET /api/bookings/my
// @desc   Get the current user's bookings
// @access Private
exports.getMyBookings = async (req, res, next) => {
  try {
    const bookings = await Booking.find({ user: req.user._id })
      .populate('equipment')
      .sort({ createdAt: -1 });

    return res.json({ success: true, count: bookings.length, bookings });
  } catch (error) {
    next(error);
  }
};

// @route  GET /api/bookings/:id
// @desc   Get a single booking (owner or admin)
// @access Private
exports.getBookingById = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('equipment')
      .populate('user', '-password');

    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' });
    }

    const ownerId = booking.user._id ? booking.user._id.toString() : booking.user.toString();
    const isOwner = ownerId === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res
        .status(403)
        .json({ success: false, message: 'Not authorized to view this booking' });
    }

    return res.json({ success: true, booking });
  } catch (error) {
    next(error);
  }
};

// @route  PUT /api/bookings/:id/cancel
// @desc   Cancel a booking (owner only, if pending/approved)
// @access Private
exports.cancelBooking = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' });
    }

    if (booking.user.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ success: false, message: 'Not authorized to cancel this booking' });
    }

    if (!['pending', 'approved'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a booking that is ${booking.status}`,
      });
    }

    booking.status = 'cancelled';
    await booking.save();

    // If a completed payment exists, mark it refunded
    const payment = await Payment.findOne({ booking: booking._id });
    if (payment && payment.status === 'completed') {
      payment.status = 'refunded';
      await payment.save();
    }

    await booking.populate('equipment');

    // Notify owner of cancellation (non-blocking)
    sendEmail({
      to: req.user.email,
      ...bookingStatusUpdate(booking, 'cancelled'),
    }).catch(() => {});

    return res.json({ success: true, booking });
  } catch (error) {
    next(error);
  }
};

// @route  GET /api/bookings/:id/return-info
// @desc   Return due date, overdue status, late fee and instructions
// @access Private (owner or admin)
exports.getReturnInfo = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id).populate('equipment');
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' });
    }

    const isOwner = booking.user.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res
        .status(403)
        .json({ success: false, message: 'Not authorized for this booking' });
    }

    const { isOverdue, daysOverdue } = calculateOverdue(booking.endDate);
    const dailyRate = booking.equipment ? booking.equipment.dailyRate : 0;
    const lateFee = isOverdue ? dailyRate * daysOverdue : 0;

    return res.json({
      success: true,
      dueDate: booking.endDate,
      isOverdue,
      daysOverdue,
      lateFee,
      returnInstructions: getReturnInstructions(),
    });
  } catch (error) {
    next(error);
  }
};

// @route  PUT /api/bookings/:id/extend
// @desc   Extend an active booking's end date
// @access Private (owner)
exports.extendBooking = async (req, res, next) => {
  try {
    const { newEndDate } = req.body;

    const booking = await Booking.findById(req.params.id).populate('equipment');
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

    if (booking.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Only active bookings can be extended',
      });
    }

    const currentEnd = startOfDay(booking.endDate);
    const requestedEnd = startOfDay(newEndDate);
    if (isNaN(requestedEnd.getTime()) || requestedEnd <= currentEnd) {
      return res.status(400).json({
        success: false,
        message: 'newEndDate must be after the current end date',
      });
    }

    // Ensure the equipment is free for the extended window (excluding this booking)
    const available = await checkAvailability(
      booking.equipment._id,
      booking.endDate,
      newEndDate,
      booking._id
    );
    if (!available) {
      return res.status(409).json({
        success: false,
        message: 'Equipment is not available for the extended period',
      });
    }

    const additionalDays = calculateDays(booking.endDate, newEndDate);
    const additionalPrice = booking.equipment.dailyRate * additionalDays;
    const previousEndDate = booking.endDate;

    booking.endDate = newEndDate;
    booking.totalPrice += additionalPrice;
    booking.extensionHistory.push({
      previousEndDate,
      newEndDate,
      additionalDays,
      additionalPrice,
    });

    await booking.save();

    return res.json({
      success: true,
      booking,
      extension: { additionalDays, additionalPrice, previousEndDate, newEndDate },
    });
  } catch (error) {
    next(error);
  }
};

// @route  POST /api/bookings/:id/late-fee
// @desc   Calculate and apply a late fee (admin)
// @access Private/Admin
exports.applyLateFee = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id).populate('equipment');
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' });
    }

    const { isOverdue, daysOverdue } = calculateOverdue(booking.endDate);
    const dailyRate = booking.equipment ? booking.equipment.dailyRate : 0;
    const lateFee = isOverdue ? dailyRate * daysOverdue : 0;

    booking.lateFee = lateFee;
    await booking.save();

    return res.json({
      success: true,
      booking,
      lateFeeDetails: { isOverdue, daysOverdue, dailyRate, lateFee },
    });
  } catch (error) {
    next(error);
  }
};

// @route  PUT /api/bookings/:id/return
// @desc   Mark a booking as returned/completed (admin), applying late fees
// @access Private/Admin
exports.markReturned = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('equipment')
      .populate('user', 'name email');
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' });
    }

    if (!['approved', 'active'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot mark a ${booking.status} booking as returned`,
      });
    }

    // Auto-apply late fee if overdue
    const { isOverdue, daysOverdue } = calculateOverdue(booking.endDate);
    const dailyRate = booking.equipment ? booking.equipment.dailyRate : 0;
    booking.lateFee = isOverdue ? dailyRate * daysOverdue : 0;
    booking.status = 'completed';

    await booking.save();

    // Notify the booking owner (non-blocking)
    if (booking.user && booking.user.email) {
      sendEmail({
        to: booking.user.email,
        ...bookingStatusUpdate(booking, 'completed'),
      }).catch(() => {});
    }

    return res.json({
      success: true,
      booking,
      lateFeeApplied: booking.lateFee,
    });
  } catch (error) {
    next(error);
  }
};

// Fetch a booking (populated), verify owner/admin access, and build invoice data.
// Returns { invoice } or { error, status }.
async function loadInvoice(bookingId, requestUser) {
  const booking = await Booking.findById(bookingId)
    .populate('equipment')
    .populate('user', '-password');

  if (!booking) {
    return { error: 'Booking not found', status: 404 };
  }

  const ownerId = booking.user._id
    ? booking.user._id.toString()
    : booking.user.toString();
  const isOwner = ownerId === requestUser._id.toString();
  const isAdmin = requestUser.role === 'admin';
  if (!isOwner && !isAdmin) {
    return { error: 'Not authorized for this invoice', status: 403 };
  }

  const payment = await Payment.findOne({ booking: booking._id });
  return { invoice: buildInvoiceData(booking, payment) };
}

// @route  GET /api/bookings/:id/invoice
// @desc   Get invoice data as JSON
// @access Private (owner or admin)
exports.getInvoice = async (req, res, next) => {
  try {
    const result = await loadInvoice(req.params.id, req.user);
    if (result.error) {
      return res
        .status(result.status)
        .json({ success: false, message: result.error });
    }
    return res.json({ success: true, invoice: result.invoice });
  } catch (error) {
    next(error);
  }
};

// @route  GET /api/bookings/:id/invoice/download
// @desc   Download invoice as a PDF
// @access Private (owner or admin)
exports.downloadInvoice = async (req, res, next) => {
  try {
    const result = await loadInvoice(req.params.id, req.user);
    if (result.error) {
      return res
        .status(result.status)
        .json({ success: false, message: result.error });
    }
    streamInvoicePDF(result.invoice, res);
  } catch (error) {
    next(error);
  }
};

const Booking = require('../models/Booking');
const Equipment = require('../models/Equipment');
const {
  calculateDays,
  checkAvailability,
  startOfDay,
} = require('../utils/helpers');

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

    // All valid: create bookings
    const created = [];
    for (const item of items) {
      const result = await buildBooking(
        req.user._id,
        item.equipmentId,
        item.startDate,
        item.endDate
      );
      if (result.booking) {
        created.push(await result.booking.populate('equipment'));
      }
    }

    return res.status(201).json({
      success: true,
      count: created.length,
      bookings: created,
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
    await booking.populate('equipment');

    return res.json({ success: true, booking });
  } catch (error) {
    next(error);
  }
};

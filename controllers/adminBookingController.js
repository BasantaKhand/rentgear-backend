const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Equipment = require('../models/Equipment');
const { sendEmail } = require('../config/email');
const {
  bookingStatusUpdate,
  paymentReceipt,
} = require('../utils/emailTemplates');
const { calculateOverdue, startOfDay } = require('../utils/helpers');
const { notify } = require('../utils/notify');

const shortRef = (id) => `#BK-${id.toString().slice(-4).toUpperCase()}`;

// Notify the booking owner of a status change (email + in-app, non-blocking)
async function notifyStatus(booking) {
  const user = await User.findById(booking.user).select('email');
  if (user && user.email) {
    sendEmail({ to: user.email, ...bookingStatusUpdate(booking, booking.status) }).catch(
      () => {}
    );
  }
  notify(booking.user, {
    title: `Booking ${booking.status}`,
    message: `${shortRef(booking._id)} is now ${booking.status}.`,
    type: 'booking',
    link: '/my-bookings',
  });
}

// @route GET /api/admin/bookings
exports.getAdminBookings = async (req, res, next) => {
  try {
    const { status, startDate, endDate, userId, equipmentId, search, sort } = req.query;

    const match = {};
    if (status) match.status = status;
    if (userId && mongoose.isValidObjectId(userId)) {
      match.user = new mongoose.Types.ObjectId(userId);
    }
    if (equipmentId && mongoose.isValidObjectId(equipmentId)) {
      match.equipment = new mongoose.Types.ObjectId(equipmentId);
    }
    if (startDate) match.startDate = { $gte: new Date(startDate) };
    if (endDate) match.endDate = { $lte: new Date(endDate) };

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const skip = (page - 1) * limit;

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      amount: { totalPrice: -1 },
    };
    const sortStage = sortMap[sort] || sortMap.newest;

    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: User.collection.name,
          localField: 'user',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: Equipment.collection.name,
          localField: 'equipment',
          foreignField: '_id',
          as: 'equipment',
        },
      },
      { $unwind: { path: '$equipment', preserveNullAndEmptyArrays: true } },
      { $addFields: { idStr: { $toString: '$_id' } } },
    ];

    if (search) {
      const rx = new RegExp(search, 'i');
      pipeline.push({
        $match: {
          $or: [
            { 'user.name': rx },
            { 'user.email': rx },
            { 'equipment.name': rx },
            { idStr: rx },
          ],
        },
      });
    }

    // Never leak password hashes through aggregation
    pipeline.push({
      $project: {
        startDate: 1,
        endDate: 1,
        totalPrice: 1,
        deposit: 1,
        lateFee: 1,
        status: 1,
        pickedUpAt: 1,
        returnedAt: 1,
        createdAt: 1,
        'user._id': 1,
        'user.name': 1,
        'user.email': 1,
        'equipment._id': 1,
        'equipment.name': 1,
        'equipment.image': 1,
        'equipment.category': 1,
      },
    });

    pipeline.push({
      $facet: {
        data: [{ $sort: sortStage }, { $skip: skip }, { $limit: limit }],
        meta: [{ $count: 'total' }],
      },
    });

    const [result] = await Booking.aggregate(pipeline);
    const bookings = result.data;
    const total = result.meta[0] ? result.meta[0].total : 0;

    return res.json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      count: bookings.length,
      bookings,
    });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/admin/bookings/:id/approve
exports.approveBooking = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Only pending bookings can be approved (current: ${booking.status})`,
      });
    }
    booking.status = 'approved';
    await booking.save();
    await notifyStatus(booking);
    await booking.populate('equipment');
    return res.json({ success: true, booking });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/admin/bookings/:id/reject
exports.rejectBooking = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    if (!['pending', 'approved'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot reject a ${booking.status} booking`,
      });
    }

    booking.status = 'cancelled';
    await booking.save();

    // Refund a completed payment if present
    const payment = await Payment.findOne({ booking: booking._id });
    if (payment && payment.status === 'completed') {
      payment.status = 'refunded';
      await payment.save();
    }

    // Rejection email (include reason if provided)
    const user = await User.findById(booking.user).select('email');
    if (user && user.email) {
      const base = bookingStatusUpdate(booking, 'cancelled');
      const withReason = reason
        ? {
            subject: base.subject,
            text: `${base.text} Reason: ${reason}`,
            html: base.html.replace(
              '</h2>',
              `</h2><p style="color:#dc2626;">Reason: ${reason}</p>`
            ),
          }
        : base;
      sendEmail({ to: user.email, ...withReason }).catch(() => {});
    }
    notify(booking.user, {
      title: 'Booking rejected',
      message: `${shortRef(booking._id)} was rejected${reason ? `: ${reason}` : ''}.`,
      type: 'warning',
      link: '/my-bookings',
    });

    await booking.populate('equipment');
    return res.json({ success: true, booking, reason: reason || null });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/admin/bookings/:id/pickup
exports.markPickup = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    if (booking.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: `Only approved bookings can be picked up (current: ${booking.status})`,
      });
    }
    booking.status = 'active';
    booking.pickedUpAt = new Date();
    await booking.save();
    await notifyStatus(booking);
    await booking.populate('equipment');
    return res.json({ success: true, booking });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/admin/bookings/:id/return
exports.returnBooking = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id).populate('equipment');
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    if (booking.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: `Only active bookings can be returned (current: ${booking.status})`,
      });
    }

    const { isOverdue, daysOverdue } = calculateOverdue(booking.endDate);
    const dailyRate = booking.equipment ? booking.equipment.dailyRate : 0;
    booking.lateFee = isOverdue ? dailyRate * daysOverdue : 0;
    booking.status = 'completed';
    booking.returnedAt = new Date();
    await booking.save();

    // Completion email + receipt
    const user = await User.findById(booking.user).select('email');
    if (user && user.email) {
      sendEmail({ to: user.email, ...bookingStatusUpdate(booking, 'completed') }).catch(
        () => {}
      );
      const payment = await Payment.findOne({ booking: booking._id });
      if (payment) {
        sendEmail({ to: user.email, ...paymentReceipt(payment, booking) }).catch(() => {});
      }
    }
    notify(booking.user, {
      title: 'Rental completed',
      message: `${shortRef(booking._id)} returned${booking.lateFee > 0 ? ` with a $${booking.lateFee.toFixed(2)} late fee` : ''}.`,
      type: 'booking',
      link: '/my-bookings',
    });

    return res.json({ success: true, booking, lateFeeApplied: booking.lateFee });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/admin/bookings/:id/late-fee
exports.applyLateFee = async (req, res, next) => {
  try {
    const { amount } = req.body;
    const fee = Number(amount);
    if (Number.isNaN(fee) || fee < 0) {
      return res
        .status(400)
        .json({ success: false, message: 'A valid non-negative amount is required' });
    }
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { lateFee: fee },
      { new: true }
    ).populate('equipment');
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    return res.json({ success: true, booking });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/admin/bookings/pending-count
exports.getPendingCount = async (req, res, next) => {
  try {
    const count = await Booking.countDocuments({ status: 'pending' });
    return res.json({ success: true, count });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/admin/bookings/overdue
exports.getOverdueBookings = async (req, res, next) => {
  try {
    const bookings = await Booking.find({
      status: 'active',
      endDate: { $lt: startOfDay(new Date()) },
    })
      .populate('user', 'name email')
      .populate('equipment', 'name image category dailyRate')
      .sort({ endDate: 1 });

    const data = bookings.map((b) => {
      const { daysOverdue } = calculateOverdue(b.endDate);
      const dailyRate = b.equipment ? b.equipment.dailyRate : 0;
      return {
        booking: b,
        daysOverdue,
        lateFee: dailyRate * daysOverdue,
      };
    });

    return res.json({ success: true, count: data.length, overdue: data });
  } catch (error) {
    next(error);
  }
};

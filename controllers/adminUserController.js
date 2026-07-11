const path = require('path');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const { sendEmail } = require('../config/email');
const { idVerified } = require('../utils/emailTemplates');
const { notify } = require('../utils/notify');
const { logSecurityEvent } = require('../utils/securityLog');

// Sum of completed payments across a set of booking ids
async function totalSpent(bookingIds) {
  if (!bookingIds.length) return 0;
  const r = await Payment.aggregate([
    { $match: { status: 'completed', booking: { $in: bookingIds } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return r.length ? r[0].total : 0;
}

// @route GET /api/admin/users
exports.getUsers = async (req, res, next) => {
  try {
    const { role, verified, search } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (verified !== undefined) filter.verified = verified === 'true';
    if (search) {
      const rx = new RegExp(search, 'i');
      filter.$or = [{ name: rx }, { email: rx }];
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 12, 1);
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      count: users.length,
      users,
    });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/admin/users/unverified
// Users who uploaded an ID but are not yet verified
exports.getUnverifiedUsers = async (req, res, next) => {
  try {
    const users = await User.find({
      verified: false,
      idDocument: { $ne: null },
    }).sort({ createdAt: -1 });
    return res.json({ success: true, count: users.length, users });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/admin/users/:id
exports.getUserById = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const bookings = await Booking.find({ user: user._id }).select('_id');
    const bookingIds = bookings.map((b) => b._id);
    const spent = await totalSpent(bookingIds);

    return res.json({
      success: true,
      user,
      stats: {
        totalBookings: bookingIds.length,
        totalSpent: spent,
        registeredAt: user.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/admin/users/:id/verify
exports.verifyUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (!user.idDocument) {
      return res.status(400).json({
        success: false,
        message: 'User has not uploaded an ID document',
      });
    }

    user.verified = true;
    await user.save();

    req.setAudit?.('ADMIN_VERIFY_USER', {
      resource: 'user',
      resourceId: user._id,
      details: { email: user.email },
    });

    sendEmail({ to: user.email, ...idVerified(user) }).catch(() => {});
    notify(user._id, {
      title: 'Account verified',
      message: 'Your ID has been verified. You can now rent equipment.',
      type: 'success',
      link: '/profile',
    });

    return res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/admin/users/:id/disable
// Toggle active status; when disabling, cancel the user's pending bookings
exports.toggleDisableUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user._id.toString() === req.user._id.toString()) {
      return res
        .status(400)
        .json({ success: false, message: 'You cannot disable your own account' });
    }

    const currentlyActive = user.isActive !== false;
    user.isActive = !currentlyActive;
    await user.save();

    let cancelledBookings = 0;
    if (user.isActive === false) {
      const result = await Booking.updateMany(
        { user: user._id, status: 'pending' },
        { status: 'cancelled' }
      );
      cancelledBookings = result.modifiedCount;
    }

    req.setAudit?.('ADMIN_DISABLE_USER', {
      resource: 'user',
      resourceId: user._id,
      details: { isActive: user.isActive, cancelledBookings },
    });

    return res.json({
      success: true,
      user,
      isActive: user.isActive,
      cancelledBookings,
    });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/admin/users/:id/role
exports.changeRole = async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!['customer', 'admin'].includes(role)) {
      return res
        .status(400)
        .json({ success: false, message: 'Role must be customer or admin' });
    }

    if (req.params.id === req.user._id.toString()) {
      return res
        .status(400)
        .json({ success: false, message: 'You cannot change your own role' });
    }

    const target = await User.findById(req.params.id);
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const previousRole = target.role;
    target.role = role;
    await target.save();

    // Audit every role change (privilege escalation is a high-value event).
    logSecurityEvent('ROLE_CHANGE', req, {
      targetUserId: String(target._id),
      previousRole,
      newRole: role,
    });
    req.setAudit?.('ADMIN_ROLE_CHANGE', {
      resource: 'user',
      resourceId: target._id,
      details: { previousRole, newRole: role },
    });

    return res.json({ success: true, user: target });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/admin/users/:id/bookings
exports.getUserBookings = async (req, res, next) => {
  try {
    const bookings = await Booking.find({ user: req.params.id })
      .populate('equipment', 'name image category')
      .sort({ createdAt: -1 });
    return res.json({ success: true, count: bookings.length, bookings });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/admin/users/:id/id-document
exports.getIdDocument = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select('idDocument name');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (!user.idDocument) {
      return res
        .status(404)
        .json({ success: false, message: 'No ID document uploaded' });
    }

    // If ?download=1, stream the file; otherwise return the path/url
    if (req.query.download === '1') {
      const filePath = path.join(
        __dirname,
        '..',
        user.idDocument.replace(/^[/\\]+/, '')
      );
      return res.sendFile(filePath, (err) => {
        if (err && !res.headersSent) {
          res.status(404).json({ success: false, message: 'File not found' });
        }
      });
    }

    return res.json({ success: true, idDocument: user.idDocument });
  } catch (error) {
    next(error);
  }
};

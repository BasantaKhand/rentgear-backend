const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Booking = require('../models/Booking');
const { validatePassword } = require('../utils/passwordPolicy');

const BCRYPT_ROUNDS = 12;
const PASSWORD_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_HISTORY = 5;

// Build a safe user object without the password field
const sanitizeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  address: user.address,
  role: user.role,
  verified: user.verified,
  idDocument: user.idDocument,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

// @route  GET /api/users/profile
// @desc   Get current user's full profile
// @access Private
exports.getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.json({ success: true, user: sanitizeUser(user) });
  } catch (error) {
    next(error);
  }
};

// @route  PUT /api/users/profile
// @desc   Update name, phone, and/or address
// @access Private
exports.updateProfile = async (req, res, next) => {
  try {
    const { name, phone, address } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Update only the fields that were provided
    if (name !== undefined) user.name = name;
    if (phone !== undefined) user.phone = phone;
    if (address !== undefined) user.address = address;

    await user.save();

    return res.json({ success: true, user: sanitizeUser(user) });
  } catch (error) {
    next(error);
  }
};

// @route  POST /api/users/upload-id
// @desc   Upload an ID document (single file field "idDocument")
// @access Private
exports.uploadIdDocument = async (req, res, next) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: 'No file uploaded' });
    }

    // Public path relative to the static /uploads mount
    const filePath = `/uploads/ids/${req.file.filename}`;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    user.idDocument = filePath;
    await user.save();

    return res.json({
      success: true,
      message: 'ID document uploaded successfully',
      idDocument: filePath,
    });
  } catch (error) {
    next(error);
  }
};

// @route  GET /api/users/rental-history
// @desc   Get all bookings for the current user
// @access Private
exports.getRentalHistory = async (req, res, next) => {
  try {
    const bookings = await Booking.find({ user: req.user._id })
      .populate('equipment')
      .sort({ createdAt: -1 });

    return res.json({ success: true, count: bookings.length, bookings });
  } catch (error) {
    next(error);
  }
};

// @route  PUT /api/users/change-password
// @desc   Change the current user's password
// @access Private
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Need password + history which are excluded by default
    const user = await User.findById(req.user._id).select(
      '+password +passwordHistory'
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res
        .status(400)
        .json({ success: false, message: 'Current password is incorrect' });
    }

    // Enforce the strength policy
    const policy = validatePassword(newPassword, {
      name: user.name,
      email: user.email,
    });
    if (!policy.valid) {
      return res
        .status(400)
        .json({ success: false, message: policy.errors[0], errors: policy.errors });
    }

    // Reuse prevention: reject if it matches the current or any of the last 5
    const history = user.passwordHistory && user.passwordHistory.length
      ? user.passwordHistory
      : [user.password];
    for (const oldHash of history) {
      // eslint-disable-next-line no-await-in-loop
      if (await bcrypt.compare(newPassword, oldHash)) {
        return res.status(400).json({
          success: false,
          message: 'You cannot reuse a recent password',
        });
      }
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    user.password = newHash;
    user.passwordChangedAt = new Date();
    user.passwordExpiresAt = new Date(Date.now() + PASSWORD_TTL_MS);
    // Keep the most recent MAX_HISTORY hashes (newest first)
    user.passwordHistory = [newHash, ...history].slice(0, MAX_HISTORY);
    await user.save();

    return res.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    next(error);
  }
};

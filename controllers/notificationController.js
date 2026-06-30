const Notification = require('../models/Notification');

// @route GET /api/notifications?unread=true&limit=20
exports.getNotifications = async (req, res, next) => {
  try {
    const filter = { user: req.user._id };
    if (req.query.unread === 'true') filter.read = false;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.json({ success: true, count: notifications.length, notifications });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/notifications/unread-count
exports.getUnreadCount = async (req, res, next) => {
  try {
    const count = await Notification.countDocuments({
      user: req.user._id,
      read: false,
    });
    return res.json({ success: true, count });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/notifications/:id/read
exports.markRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { read: true },
      { new: true }
    );
    if (!notification) {
      return res
        .status(404)
        .json({ success: false, message: 'Notification not found' });
    }
    return res.json({ success: true, notification });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/notifications/read-all
exports.markAllRead = async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { user: req.user._id, read: false },
      { read: true }
    );
    return res.json({ success: true, modified: result.modifiedCount });
  } catch (error) {
    next(error);
  }
};

// @route DELETE /api/notifications/:id
exports.deleteNotification = async (req, res, next) => {
  try {
    const result = await Notification.deleteOne({
      _id: req.params.id,
      user: req.user._id,
    });
    if (result.deletedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: 'Notification not found' });
    }
    return res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    next(error);
  }
};

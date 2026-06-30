const Notification = require('../models/Notification');
const User = require('../models/User');

// Create a single in-app notification for a user. Resilient: never throws.
async function notify(userId, data) {
  try {
    if (!userId) return null;
    return await Notification.create({ user: userId, ...data });
  } catch (err) {
    console.error(`notify failed: ${err.message}`);
    return null;
  }
}

// Create the same notification for every admin (e.g. new pending booking).
async function notifyAdmins(data) {
  try {
    const admins = await User.find({ role: 'admin' }).select('_id');
    if (!admins.length) return;
    await Notification.insertMany(
      admins.map((a) => ({ user: a._id, ...data }))
    );
  } catch (err) {
    console.error(`notifyAdmins failed: ${err.message}`);
  }
}

module.exports = { notify, notifyAdmins };

const mongoose = require('mongoose');

const loginAttemptSchema = new mongoose.Schema({
  email: { type: String, index: true },
  ip: { type: String },
  userAgent: { type: String },
  success: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('LoginAttempt', loginAttemptSchema);

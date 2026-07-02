const mongoose = require('mongoose');

// Tracks IP addresses that are blocked from accessing the API, either
// automatically (after repeated failed logins) or manually by an admin.
const blockedIpSchema = new mongoose.Schema(
  {
    ip: { type: String, required: true, unique: true, index: true },
    reason: { type: String, default: 'Suspicious activity' },
    auto: { type: Boolean, default: false }, // true if auto-blocked by the system
    blockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Optional expiry: when set, ipProtection treats the block as lifted after this time.
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BlockedIp', blockedIpSchema);

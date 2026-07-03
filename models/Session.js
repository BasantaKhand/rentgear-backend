const mongoose = require('mongoose');

// One document per active login session. The refresh token carries this
// document's id (sid); the token itself is never stored, only a hash of the
// currently-valid token so we can detect reuse of a rotated (old) token.
const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true }, // sha256 of the current refresh token
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
    lastActivity: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true }, // absolute 7-day expiry
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// TTL index: Mongo drops the doc once the absolute expiry passes.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Session', sessionSchema);

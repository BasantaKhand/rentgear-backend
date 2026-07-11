const mongoose = require('mongoose');

const ACTIONS = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'REGISTER',
  'LOGOUT',
  'TOKEN_REFRESH',
  'PASSWORD_CHANGE',
  'PROFILE_UPDATE',
  'BOOKING_CREATED',
  'BOOKING_CANCELLED',
  'BOOKING_EXTENDED',
  'PAYMENT_MADE',
  'ADMIN_APPROVE',
  'ADMIN_REJECT',
  'ADMIN_VERIFY_USER',
  'ADMIN_DISABLE_USER',
  'ADMIN_ROLE_CHANGE',
  'EQUIPMENT_CREATED',
  'EQUIPMENT_UPDATED',
  'EQUIPMENT_DELETED',
  'FILE_UPLOAD',
  'ACCESS_DENIED',
  'ACCOUNT_LOCKED',
  'INVALID_TOKEN',
  'RATE_LIMITED',
  'SUSPICIOUS_ACTIVITY',
  'REQUEST', // generic state-changing request
];

const auditLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  action: { type: String, index: true }, // not strictly enumerated to stay resilient
  resource: { type: String, default: null },
  resourceId: { type: String, default: null },
  details: { type: Object, default: {} },
  ip: { type: String, default: '', index: true },
  userAgent: { type: String, default: '' },
  method: { type: String, default: '' },
  endpoint: { type: String, default: '' },
  statusCode: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now, index: true },
});

// Common query pattern: recent events, optionally filtered by action/user/ip.
auditLogSchema.index({ timestamp: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
module.exports.ACTIONS = ACTIONS;

const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/encryption');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      minlength: 6,
      select: false,
    },
    // --- OAuth ---
    googleId: {
      type: String,
      unique: true,
      sparse: true, // allows multiple null values
    },
    authProvider: {
      type: String,
      enum: ['local', 'google'],
      default: 'local',
    },
    // Sensitive fields are encrypted at rest via AES-256-GCM getters/setters.
    phone: {
      type: String,
      trim: true,
      set: encrypt,
      get: decrypt,
    },
    address: {
      type: String,
      trim: true,
      set: encrypt,
      get: decrypt,
    },
    idDocument: {
      type: String, // file path for uploaded ID (encrypted at rest)
      default: null,
      set: encrypt,
      get: decrypt,
    },
    role: {
      type: String,
      enum: ['customer', 'admin'],
      default: 'customer',
    },
    verified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // --- Security fields ---
    passwordHistory: {
      type: [String], // last 5 password hashes (most recent first)
      default: [],
      select: false,
    },
    passwordChangedAt: {
      type: Date,
      default: Date.now,
    },
    passwordExpiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
      default: null,
    },
    // Bumped on "logout from all devices"; embedded in refresh tokens so any
    // token minted before the bump is rejected on the next refresh.
    tokenVersion: {
      type: Number,
      default: 0,
    },
    // --- Email OTP two-factor authentication ---
    mfaEnabled: {
      type: Boolean,
      default: false,
    },
    // Which MFA method is active: 'none' | 'totp' | 'email'
    mfaMethod: {
      type: String,
      enum: ['none', 'totp', 'email'],
      default: 'none',
    },
    mfaCode: {
      type: String, // hashed OTP (never stored in plaintext)
      default: null,
      select: false,
    },
    mfaCodeExpires: {
      type: Date,
      default: null,
      select: false,
    },
    mfaFailedAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    // Pending MFA setup action awaiting OTP confirmation: 'enable' | 'disable'.
    mfaPendingAction: {
      type: String,
      default: null,
      select: false,
    },
    // --- TOTP (Authenticator App) ---
    totpSecret: {
      type: String, // encrypted at rest
      default: null,
      select: false,
      set: encrypt,
      get: decrypt,
    },
    totpEnabled: {
      type: Boolean,
      default: false,
    },
    totpBackupCodes: {
      type: [String], // hashed backup codes
      default: [],
      select: false,
    },
    // --- Password reset ---
    resetPasswordToken: {
      type: String,
      default: null,
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true, // adds createdAt and updatedAt
  }
);

// Defense-in-depth: even if a query accidentally selects sensitive fields, never
// serialize them in a response. `getters: true` ensures encrypted fields are
// decrypted in JSON output.
const transform = (doc, ret) => {
  delete ret.password;
  delete ret.passwordHistory;
  delete ret.tokenVersion;
  delete ret.failedLoginAttempts;
  delete ret.lockUntil;
  delete ret.mfaCode;
  delete ret.mfaCodeExpires;
  delete ret.mfaFailedAttempts;
  delete ret.mfaPendingAction;
  delete ret.totpSecret;
  delete ret.totpBackupCodes;
  delete ret.resetPasswordToken;
  delete ret.resetPasswordExpires;
  delete ret.googleId;
  delete ret.__v;
  return ret;
};
userSchema.set('toJSON', { getters: true, transform });
userSchema.set('toObject', { getters: true, transform });

module.exports = mongoose.model('User', userSchema);

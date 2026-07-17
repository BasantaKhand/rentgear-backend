const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Email OTP for two-factor auth. Codes are 6 digits, hashed at rest, single-use,
// and expire after 5 minutes.
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5; // wrong-code attempts before the code is invalidated
const BCRYPT_ROUNDS = 10;

// Cryptographically-secure 6-digit code (100000-999999).
function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

async function hashOtp(otp) {
  return bcrypt.hash(otp, BCRYPT_ROUNDS);
}

async function verifyOtpHash(otp, hash) {
  if (!otp || !hash) return false;
  return bcrypt.compare(String(otp), hash);
}

module.exports = { generateOtp, hashOtp, verifyOtpHash, OTP_TTL_MS, OTP_MAX_ATTEMPTS };

const express = require('express');
const router = express.Router();

const {
  register,
  login,
  getMe,
  logout,
  logoutAll,
  refreshToken,
  getCaptcha,
  getCsrfToken,
  getSessions,
  revokeSession,
  verifyOtp,
  resendOtp,
  mfaEnable,
  mfaDisable,
  mfaVerifySetup,
  forgotPassword,
  verifyResetToken,
  resetPassword,
  totpSetup,
  totpVerifySetup,
  totpDisable,
  verifyTotp,
  useBackupCode,
  sendEmailRecovery,
  verifyEmailRecovery,
} = require('../controllers/authController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
  authLimiter,
  authSlowDown,
  otpVerifyLimiter,
  otpResendLimiter,
  passwordResetLimiter,
  emailRecoveryLimiter,
} = require('../middleware/rateLimiter');
const { verifyCsrf } = require('../middleware/csrf');
const { registerRules, loginRules, isValidObjectId } = require('../middleware/validator');
const {
  getGoogleAuthUrl,
  googleCallback,
  verifyGoogleToken,
  linkGoogle,
  unlinkGoogle,
  setPassword,
} = require('../controllers/googleAuthController');

// @route  GET /api/auth/captcha
router.get('/captcha', getCaptcha);

// @route  GET /api/auth/csrf-token
router.get('/csrf-token', getCsrfToken);

// @route  POST /api/auth/register
router.post('/register', authLimiter, authSlowDown, registerRules, validate, register);

// @route  POST /api/auth/login
router.post('/login', authLimiter, authSlowDown, loginRules, validate, login);

// @route  POST /api/auth/verify-otp   (login step 2)
router.post('/verify-otp', otpVerifyLimiter, verifyOtp);

// @route  POST /api/auth/mfa/resend   (login step, rate limited 1/min)
router.post('/mfa/resend', otpResendLimiter, resendOtp);

// @route  POST /api/auth/mfa/enable   (protected)
router.post('/mfa/enable', auth, passwordResetLimiter, mfaEnable);

// @route  POST /api/auth/mfa/disable  (protected)
router.post('/mfa/disable', auth, passwordResetLimiter, mfaDisable);

// @route  POST /api/auth/mfa/verify   (protected, confirm enable/disable)
router.post('/mfa/verify', auth, otpVerifyLimiter, mfaVerifySetup);

// --- TOTP (Authenticator App) ---
// @route  POST /api/auth/mfa/totp/setup   (protected)
router.post('/mfa/totp/setup', auth, passwordResetLimiter, totpSetup);

// @route  POST /api/auth/mfa/totp/verify-setup   (protected)
router.post('/mfa/totp/verify-setup', auth, otpVerifyLimiter, totpVerifySetup);

// @route  POST /api/auth/mfa/totp/disable   (protected)
router.post('/mfa/totp/disable', auth, passwordResetLimiter, totpDisable);

// @route  POST /api/auth/verify-totp   (login step 2 for TOTP)
router.post('/verify-totp', otpVerifyLimiter, verifyTotp);

// @route  POST /api/auth/mfa/use-backup-code   (login recovery)
router.post('/mfa/use-backup-code', otpVerifyLimiter, useBackupCode);

// @route  POST /api/auth/mfa/send-email-recovery   (TOTP lost device)
router.post('/mfa/send-email-recovery', emailRecoveryLimiter, sendEmailRecovery);

// @route  POST /api/auth/verify-email-recovery   (email fallback for TOTP)
router.post('/verify-email-recovery', otpVerifyLimiter, verifyEmailRecovery);

// @route  POST /api/auth/forgot-password
router.post('/forgot-password', passwordResetLimiter, forgotPassword);

// @route  GET /api/auth/verify-reset-token/:token
router.get('/verify-reset-token/:token', verifyResetToken);

// @route  POST /api/auth/reset-password/:token
router.post('/reset-password/:token', passwordResetLimiter, resetPassword);

// @route  POST /api/auth/refresh-token  (CSRF double-submit protected)
router.post('/refresh-token', verifyCsrf, refreshToken);

// @route  GET /api/auth/me
router.get('/me', auth, getMe);

// @route  POST /api/auth/logout
router.post('/logout', auth, logout);

// @route  POST /api/auth/logout-all
router.post('/logout-all', auth, logoutAll);

// @route  GET /api/auth/sessions
router.get('/sessions', auth, getSessions);

// @route  DELETE /api/auth/sessions/:id
router.delete('/sessions/:id', auth, isValidObjectId('id'), revokeSession);

// --- Google OAuth ---
// @route  GET /api/auth/google
router.get('/google', getGoogleAuthUrl);

// @route  GET /api/auth/google/callback
router.get('/google/callback', googleCallback);

// @route  POST /api/auth/google/verify   (frontend sends credential from popup)
router.post('/google/verify', authLimiter, verifyGoogleToken);

// @route  POST /api/auth/google/link   (protected, link Google to existing account)
router.post('/google/link', auth, linkGoogle);

// @route  POST /api/auth/google/unlink   (protected, unlink Google)
router.post('/google/unlink', auth, unlinkGoogle);

// @route  POST /api/auth/set-password   (protected, for Google-only users)
router.post('/set-password', auth, passwordResetLimiter, setPassword);

module.exports = router;

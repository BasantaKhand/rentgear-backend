const express = require('express');
const router = express.Router();
const { sendTestEmail } = require('../controllers/testController');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

// @route  POST /api/test/email  (admin only)
router.post('/email', auth, admin, sendTestEmail);

module.exports = router;

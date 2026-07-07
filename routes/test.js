const express = require('express');
const router = express.Router();
const { sendTestEmail } = require('../controllers/testController');
const auth = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

// @route  POST /api/test/email  (admin only)
router.post('/email', auth, authorize('admin'), sendTestEmail);

module.exports = router;

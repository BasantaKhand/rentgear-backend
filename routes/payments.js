const express = require('express');
const router = express.Router();
const { paymentsStatus } = require('../controllers/paymentController');

// Placeholder route
router.get('/', paymentsStatus);

module.exports = router;

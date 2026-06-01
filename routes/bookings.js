const express = require('express');
const router = express.Router();
const { bookingsStatus } = require('../controllers/bookingController');

// Placeholder route
router.get('/', bookingsStatus);

module.exports = router;

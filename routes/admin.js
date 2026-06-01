const express = require('express');
const router = express.Router();
const { adminStatus } = require('../controllers/adminController');

// Placeholder route
router.get('/', adminStatus);

module.exports = router;

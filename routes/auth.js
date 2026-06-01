const express = require('express');
const router = express.Router();
const { authStatus } = require('../controllers/authController');

// Placeholder route
router.get('/', authStatus);

module.exports = router;

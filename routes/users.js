const express = require('express');
const router = express.Router();
const { usersStatus } = require('../controllers/userController');

// Placeholder route
router.get('/', usersStatus);

module.exports = router;

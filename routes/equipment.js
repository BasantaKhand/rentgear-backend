const express = require('express');
const router = express.Router();
const { equipmentStatus } = require('../controllers/equipmentController');

// Placeholder route
router.get('/', equipmentStatus);

module.exports = router;

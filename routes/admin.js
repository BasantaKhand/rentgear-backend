const express = require('express');
const router = express.Router();
const {
  getStats,
  getRecentBookings,
  getRevenueChart,
  getCategoryStats,
  getOverview,
} = require('../controllers/adminController');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

// All admin routes require an authenticated admin
router.use(auth, admin);

router.get('/stats', getStats);
router.get('/recent-bookings', getRecentBookings);
router.get('/revenue-chart', getRevenueChart);
router.get('/category-stats', getCategoryStats);
router.get('/overview', getOverview);

module.exports = router;

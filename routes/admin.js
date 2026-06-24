const express = require('express');
const router = express.Router();
const {
  getStats,
  getRecentBookings,
  getRevenueChart,
  getCategoryStats,
  getOverview,
  getAdminEquipment,
  getLowStockEquipment,
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

// Equipment management (low-stock before the generic list is fine; distinct paths)
router.get('/equipment/low-stock', getLowStockEquipment);
router.get('/equipment', getAdminEquipment);

module.exports = router;

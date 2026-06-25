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
const {
  getAdminBookings,
  approveBooking,
  rejectBooking,
  markPickup,
  returnBooking,
  applyLateFee,
  getPendingCount,
  getOverdueBookings,
} = require('../controllers/adminBookingController');
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

// Booking management (literal paths before ":id/*" routes)
router.get('/bookings/pending-count', getPendingCount);
router.get('/bookings/overdue', getOverdueBookings);
router.get('/bookings', getAdminBookings);
router.put('/bookings/:id/approve', approveBooking);
router.put('/bookings/:id/reject', rejectBooking);
router.put('/bookings/:id/pickup', markPickup);
router.put('/bookings/:id/return', returnBooking);
router.put('/bookings/:id/late-fee', applyLateFee);

module.exports = router;

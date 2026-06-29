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
const {
  getUsers,
  getUnverifiedUsers,
  getUserById,
  verifyUser,
  toggleDisableUser,
  changeRole,
  getUserBookings,
  getIdDocument,
} = require('../controllers/adminUserController');
const {
  bookingsReport,
  revenueReport,
  equipmentReport,
  usersReport,
  summaryReport,
} = require('../controllers/reportsController');
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

// User management (literal paths before ":id" routes)
router.get('/users/unverified', getUnverifiedUsers);
router.get('/users', getUsers);
router.get('/users/:id', getUserById);
router.get('/users/:id/bookings', getUserBookings);
router.get('/users/:id/id-document', getIdDocument);
router.put('/users/:id/verify', verifyUser);
router.put('/users/:id/disable', toggleDisableUser);
router.put('/users/:id/role', changeRole);

// Reports
router.get('/reports/bookings', bookingsReport);
router.get('/reports/revenue', revenueReport);
router.get('/reports/equipment', equipmentReport);
router.get('/reports/users', usersReport);
router.get('/reports/summary', summaryReport);

module.exports = router;

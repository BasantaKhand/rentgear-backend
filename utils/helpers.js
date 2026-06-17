const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const Booking = require('../models/Booking');
const Equipment = require('../models/Equipment');

// Normalize a date to the start of its day (strips time for date-only compares)
const startOfDay = (value) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

// Check whether an equipment item is available for the given date range.
// Counts non-cancelled bookings that overlap the range and compares against
// the equipment's quantity. Optionally excludes a booking (for updates).
const checkAvailability = async (
  equipmentId,
  startDate,
  endDate,
  excludeBookingId = null
) => {
  const equipment = await Equipment.findById(equipmentId);
  if (!equipment || !equipment.available || equipment.quantity < 1) {
    return false;
  }

  const start = startOfDay(startDate);
  const end = startOfDay(endDate);

  const query = {
    equipment: equipmentId,
    status: { $ne: 'cancelled' },
    startDate: { $lte: end },
    endDate: { $gte: start },
  };
  if (excludeBookingId) {
    query._id = { $ne: excludeBookingId };
  }

  const overlapping = await Booking.countDocuments(query);
  return overlapping < equipment.quantity;
};

// Delete an uploaded file given its public path (e.g. "/uploads/equipment/x.jpg").
// Resolves against the project root and fails gracefully if the file is missing.
const deleteUploadedFile = (publicPath) => {
  if (!publicPath) return;
  // Strip a leading slash so path.join resolves correctly
  const relative = publicPath.replace(/^[/\\]+/, '');
  const absolute = path.join(__dirname, '..', relative);
  fs.unlink(absolute, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.error(`Failed to delete file ${absolute}: ${err.message}`);
    }
  });
};

// Generate a signed JWT for a user id
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  });
};

// Calculate the number of rental days between two dates (inclusive of start day)
const calculateDays = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diff = end.getTime() - start.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return days > 0 ? days : 1;
};

// Calculate total rental price
const calculateTotalPrice = (dailyRate, startDate, endDate) => {
  return dailyRate * calculateDays(startDate, endDate);
};

// Generate a simple transaction id for payments
const generateTransactionId = () => {
  return `TXN-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
};

// Simulate a payment gateway call. Always succeeds for now; a future version
// could randomly fail to exercise error handling.
const simulatePayment = () => {
  return { success: true, transactionId: generateTransactionId() };
};

// Determine overdue status for a booking end date relative to "now".
// Uses date-only comparison (time ignored).
const calculateOverdue = (endDate, asOf = new Date()) => {
  const due = startOfDay(endDate);
  const today = startOfDay(asOf);
  const diffDays = Math.floor((today - due) / (1000 * 60 * 60 * 24));
  const daysOverdue = diffDays > 0 ? diffDays : 0;
  return { isOverdue: daysOverdue > 0, daysOverdue };
};

// Standard return instructions shown to customers.
const getReturnInstructions = () => ({
  location: 'RentGear Depot, 123 Rental Ave, Kathmandu',
  hours: 'Mon-Sat, 9:00 AM - 6:00 PM',
  conditionRequirements: [
    'Return the equipment clean and in the same condition it was received',
    'Include all accessories, cables and original packaging',
    'Report any damage or malfunction to staff at drop-off',
  ],
  checklist: [
    'Bring your booking reference or ID',
    'Ensure batteries are charged / fuel tanks as received',
    'Remove personal storage cards or data',
    'Get a return confirmation receipt from staff',
  ],
});

module.exports = {
  generateToken,
  calculateDays,
  calculateTotalPrice,
  generateTransactionId,
  deleteUploadedFile,
  startOfDay,
  checkAvailability,
  simulatePayment,
  calculateOverdue,
  getReturnInstructions,
};

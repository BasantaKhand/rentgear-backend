const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

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

module.exports = {
  generateToken,
  calculateDays,
  calculateTotalPrice,
  generateTransactionId,
  deleteUploadedFile,
};

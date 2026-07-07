const Booking = require('../models/Booking');
const { logSecurityEvent } = require('../utils/securityLog');

// Verify the authenticated user owns the booking referenced by a route param
// (admins bypass). Attaches the loaded booking to req.booking for reuse.
// `paramName` is the route param holding the booking id (default 'id').
function verifyBookingOwnership(paramName = 'id') {
  return async (req, res, next) => {
    try {
      const booking = await Booking.findById(req.params[paramName]);
      if (!booking) {
        return res.status(404).json({ success: false, message: 'Booking not found' });
      }

      const isAdmin = req.user.role === 'admin';
      const isOwner = booking.user.toString() === req.user._id.toString();
      if (!isAdmin && !isOwner) {
        logSecurityEvent('IDOR_ATTEMPT', req, {
          resource: 'booking',
          resourceId: String(booking._id),
          ownerId: String(booking.user),
        });
        return res
          .status(403)
          .json({ success: false, message: 'Access denied. You do not own this resource' });
      }

      req.booking = booking;
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Verify ownership of the booking tied to a payment lookup (owner or admin).
// Used by GET /api/payments/:bookingId.
function verifyPaymentBookingOwnership(paramName = 'bookingId') {
  return async (req, res, next) => {
    try {
      const booking = await Booking.findById(req.params[paramName]).select('user');
      // Absent booking is handled by the controller (404 for payment); only
      // enforce ownership when it exists.
      if (booking) {
        const isAdmin = req.user.role === 'admin';
        const isOwner = booking.user.toString() === req.user._id.toString();
        if (!isAdmin && !isOwner) {
          logSecurityEvent('IDOR_ATTEMPT', req, {
            resource: 'payment',
            bookingId: String(booking._id),
            ownerId: String(booking.user),
          });
          return res
            .status(403)
            .json({ success: false, message: 'Access denied. You do not own this resource' });
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { verifyBookingOwnership, verifyPaymentBookingOwnership };

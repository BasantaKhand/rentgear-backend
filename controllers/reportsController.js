const Booking = require('../models/Booking');
const Equipment = require('../models/Equipment');
const Payment = require('../models/Payment');
const User = require('../models/User');
const { generateCsv, sendCsv } = require('../utils/csvGenerator');
const { calculateDays, calculatePercentageChange } = require('../utils/helpers');

const MS_DAY = 24 * 60 * 60 * 1000;
const MS_YEAR = 365 * MS_DAY;
const shortId = (id) => `#BK-${(id || '').toString().slice(-4).toUpperCase()}`;
const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

// Resolve/validate a date range. Defaults to the last 30 days.
function resolveRange(q) {
  const now = new Date();
  const end = q.endDate ? new Date(q.endDate) : now;
  const start = q.startDate ? new Date(q.startDate) : new Date(end.getTime() - 30 * MS_DAY);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: 'Invalid startDate or endDate' };
  }
  if (start > end) return { error: 'startDate must be before endDate' };
  if (end - start > MS_YEAR) return { error: 'Maximum range is 1 year' };

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

async function sumCompleted(match) {
  const r = await Payment.aggregate([
    { $match: { status: 'completed', ...match } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return r.length ? r[0].total : 0;
}

// @route GET /api/admin/reports/bookings?startDate&endDate&status&format
exports.bookingsReport = async (req, res, next) => {
  try {
    const range = resolveRange(req.query);
    if (range.error) return res.status(400).json({ success: false, message: range.error });

    const filter = { createdAt: { $gte: range.start, $lte: range.end } };
    if (req.query.status) filter.status = req.query.status;

    const bookings = await Booking.find(filter)
      .populate('user', 'name email')
      .populate('equipment', 'name')
      .sort({ createdAt: -1 });

    const payments = await Payment.find({
      booking: { $in: bookings.map((b) => b._id) },
    });
    const pmap = {};
    payments.forEach((p) => {
      pmap[p.booking.toString()] = p;
    });

    const rows = bookings.map((b) => {
      const p = pmap[b._id.toString()];
      return {
        bookingId: shortId(b._id),
        customerName: b.user?.name || '',
        email: b.user?.email || '',
        equipment: b.equipment?.name || '',
        startDate: fmt(b.startDate),
        endDate: fmt(b.endDate),
        days: calculateDays(b.startDate, b.endDate),
        amount: b.totalPrice,
        status: b.status,
        paymentMethod: p ? p.method : '',
        paymentStatus: p ? p.status : 'unpaid',
      };
    });

    if (req.query.format === 'csv') {
      const columns = [
        { key: 'bookingId', label: 'Booking ID' },
        { key: 'customerName', label: 'Customer Name' },
        { key: 'email', label: 'Email' },
        { key: 'equipment', label: 'Equipment' },
        { key: 'startDate', label: 'Start Date' },
        { key: 'endDate', label: 'End Date' },
        { key: 'days', label: 'Days' },
        { key: 'amount', label: 'Amount' },
        { key: 'status', label: 'Status' },
        { key: 'paymentMethod', label: 'Payment Method' },
        { key: 'paymentStatus', label: 'Payment Status' },
      ];
      return sendCsv(res, `bookings-report-${fmt(range.start)}.csv`, generateCsv(rows, columns));
    }

    return res.json({
      success: true,
      range: { start: range.start, end: range.end },
      count: rows.length,
      bookings: rows,
    });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/admin/reports/revenue?startDate&endDate&groupBy
exports.revenueReport = async (req, res, next) => {
  try {
    const range = resolveRange(req.query);
    if (range.error) return res.status(400).json({ success: false, message: range.error });

    const groupBy = ['day', 'week', 'month'].includes(req.query.groupBy)
      ? req.query.groupBy
      : 'day';

    let dateExpr;
    if (groupBy === 'month') {
      dateExpr = { $dateToString: { format: '%Y-%m', date: '$createdAt' } };
    } else if (groupBy === 'week') {
      dateExpr = {
        $concat: [
          { $toString: { $isoWeekYear: '$createdAt' } },
          '-W',
          { $toString: { $isoWeek: '$createdAt' } },
        ],
      };
    } else {
      dateExpr = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
    }

    const agg = await Payment.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: range.start, $lte: range.end } } },
      { $group: { _id: dateExpr, totalRevenue: { $sum: '$amount' }, bookingsCount: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    const data = agg.map((a) => ({
      period: a._id,
      totalRevenue: a.totalRevenue,
      bookingsCount: a.bookingsCount,
      avgBookingValue: a.bookingsCount ? Math.round((a.totalRevenue / a.bookingsCount) * 100) / 100 : 0,
    }));

    const totalRevenue = data.reduce((s, d) => s + d.totalRevenue, 0);
    const totalBookings = data.reduce((s, d) => s + d.bookingsCount, 0);

    return res.json({
      success: true,
      groupBy,
      data,
      total: {
        totalRevenue,
        bookingsCount: totalBookings,
        avgBookingValue: totalBookings ? Math.round((totalRevenue / totalBookings) * 100) / 100 : 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/admin/reports/equipment?startDate&endDate
exports.equipmentReport = async (req, res, next) => {
  try {
    const range = resolveRange(req.query);
    if (range.error) return res.status(400).json({ success: false, message: range.error });

    const inRange = { createdAt: { $gte: range.start, $lte: range.end } };
    const bookingColl = Booking.collection.name;

    const bookingAgg = await Booking.aggregate([
      { $match: inRange },
      {
        $group: {
          _id: '$equipment',
          timesRented: { $sum: 1 },
          avgDurationMs: { $avg: { $subtract: ['$endDate', '$startDate'] } },
        },
      },
    ]);

    const revenueAgg = await Payment.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: range.start, $lte: range.end } } },
      { $lookup: { from: bookingColl, localField: 'booking', foreignField: '_id', as: 'bk' } },
      { $unwind: '$bk' },
      { $group: { _id: '$bk.equipment', revenue: { $sum: '$amount' } } },
    ]);

    const bMap = {};
    bookingAgg.forEach((b) => {
      bMap[b._id.toString()] = b;
    });
    const rMap = {};
    revenueAgg.forEach((r) => {
      rMap[r._id.toString()] = r.revenue;
    });

    const equipment = await Equipment.find().lean();
    const data = equipment
      .map((e) => {
        const b = bMap[e._id.toString()];
        return {
          equipment: e.name,
          category: e.category,
          timesRented: b ? b.timesRented : 0,
          revenue: rMap[e._id.toString()] || 0,
          avgRentalDuration: b && b.avgDurationMs ? Math.round(b.avgDurationMs / MS_DAY) : 0,
          status: e.available ? 'available' : 'unavailable',
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    return res.json({ success: true, count: data.length, equipment: data });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/admin/reports/users?startDate&endDate
exports.usersReport = async (req, res, next) => {
  try {
    const range = resolveRange(req.query);
    if (range.error) return res.status(400).json({ success: false, message: range.error });

    const inRange = { createdAt: { $gte: range.start, $lte: range.end } };
    const bookingColl = Booking.collection.name;
    const userColl = User.collection.name;

    const [totalRegistrations, activeUserIds, totalUsers, verifiedUsers] = await Promise.all([
      User.countDocuments(inRange),
      Booking.distinct('user', inRange),
      User.countDocuments(),
      User.countDocuments({ verified: true }),
    ]);

    const topCustomers = await Payment.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: range.start, $lte: range.end } } },
      { $lookup: { from: bookingColl, localField: 'booking', foreignField: '_id', as: 'bk' } },
      { $unwind: '$bk' },
      { $group: { _id: '$bk.user', totalSpent: { $sum: '$amount' }, bookings: { $sum: 1 } } },
      { $sort: { totalSpent: -1 } },
      { $limit: 5 },
      { $lookup: { from: userColl, localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      {
        $project: {
          _id: 0,
          name: '$user.name',
          email: '$user.email',
          bookings: 1,
          totalSpent: 1,
        },
      },
    ]);

    return res.json({
      success: true,
      totalRegistrations,
      activeUsers: activeUserIds.length,
      topCustomers,
      verificationRate: totalUsers ? Math.round((verifiedUsers / totalUsers) * 100) : 0,
    });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/admin/reports/summary?period=week|month|year
exports.summaryReport = async (req, res, next) => {
  try {
    const period = ['week', 'month', 'year'].includes(req.query.period)
      ? req.query.period
      : 'month';
    const days = period === 'week' ? 7 : period === 'year' ? 365 : 30;

    const now = new Date();
    const start = new Date(now.getTime() - days * MS_DAY);
    const prevEnd = start;
    const prevStart = new Date(start.getTime() - days * MS_DAY);

    const bookingColl = Booking.collection.name;

    const [
      totalRevenue,
      prevRevenue,
      totalBookings,
      prevBookings,
      newUsers,
      prevNewUsers,
    ] = await Promise.all([
      sumCompleted({ createdAt: { $gte: start, $lte: now } }),
      sumCompleted({ createdAt: { $gte: prevStart, $lte: prevEnd } }),
      Booking.countDocuments({ createdAt: { $gte: start, $lte: now } }),
      Booking.countDocuments({ createdAt: { $gte: prevStart, $lte: prevEnd } }),
      User.countDocuments({ createdAt: { $gte: start, $lte: now } }),
      User.countDocuments({ createdAt: { $gte: prevStart, $lte: prevEnd } }),
    ]);

    // Most popular category + equipment within the period
    const popular = await Booking.aggregate([
      { $match: { createdAt: { $gte: start, $lte: now } } },
      { $lookup: { from: Equipment.collection.name, localField: 'equipment', foreignField: '_id', as: 'eq' } },
      { $unwind: '$eq' },
      {
        $facet: {
          byCategory: [
            { $group: { _id: '$eq.category', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 1 },
          ],
          byEquipment: [
            { $group: { _id: '$eq.name', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 1 },
          ],
        },
      },
    ]);

    const mostPopularCategory = popular[0]?.byCategory[0]?._id || null;
    const mostPopularEquipment = popular[0]?.byEquipment[0]?._id || null;

    return res.json({
      success: true,
      period,
      summary: {
        totalRevenue,
        totalBookings,
        newUsers,
        avgBookingValue: totalBookings ? Math.round((totalRevenue / totalBookings) * 100) / 100 : 0,
        mostPopularCategory,
        mostPopularEquipment,
      },
      changes: {
        revenue: calculatePercentageChange(totalRevenue, prevRevenue),
        bookings: calculatePercentageChange(totalBookings, prevBookings),
        newUsers: calculatePercentageChange(newUsers, prevNewUsers),
      },
    });
  } catch (error) {
    next(error);
  }
};

const Booking = require('../models/Booking');
const Equipment = require('../models/Equipment');
const Payment = require('../models/Payment');
const User = require('../models/User');
const {
  getDateRange,
  calculatePercentageChange,
  startOfDay,
} = require('../utils/helpers');

// Sum of completed payment amounts within a date range
async function sumCompletedRevenue(start, end) {
  const match = { status: 'completed' };
  if (start || end) {
    match.createdAt = {};
    if (start) match.createdAt.$gte = start;
    if (end) match.createdAt.$lte = end;
  }
  const result = await Payment.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return result.length ? result[0].total : 0;
}

// ---- Pure data computations (reused by individual + overview endpoints) ----

async function computeStats() {
  const now = new Date();
  const today = getDateRange('today');
  const week = getDateRange('week');
  const month = getDateRange('month');

  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  const [
    bookingsToday,
    bookingsThisWeek,
    revenueThisMonth,
    revenuePreviousMonth,
    equipmentRented,
    totalEquipment,
    overdueReturns,
    totalUsers,
    newUsersThisMonth,
  ] = await Promise.all([
    Booking.countDocuments({ createdAt: { $gte: today.start, $lte: today.end } }),
    Booking.countDocuments({ createdAt: { $gte: week.start, $lte: week.end } }),
    sumCompletedRevenue(month.start, month.end),
    sumCompletedRevenue(prevMonthStart, prevMonthEnd),
    Booking.countDocuments({ status: 'active' }),
    Equipment.countDocuments(),
    Booking.countDocuments({ status: 'active', endDate: { $lt: startOfDay(now) } }),
    User.countDocuments(),
    User.countDocuments({ createdAt: { $gte: month.start, $lte: month.end } }),
  ]);

  return {
    bookingsToday,
    bookingsThisWeek,
    revenueThisMonth,
    revenuePreviousMonth,
    revenueChangePercent: calculatePercentageChange(revenueThisMonth, revenuePreviousMonth),
    equipmentRented,
    totalEquipment,
    overdueReturns,
    totalUsers,
    newUsersThisMonth,
  };
}

async function computeRecentBookings() {
  return Booking.find()
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('user', 'name email')
    .populate('equipment', 'name image category');
}

async function computeRevenueChart(periodInput) {
  const period = ['week', 'month', 'year'].includes(periodInput) ? periodInput : 'week';
  const now = new Date();
  const buckets = [];
  const keyForDay = (d) => d.toISOString().slice(0, 10);

  if (period === 'year') {
    for (let m = 0; m < 12; m += 1) {
      const d = new Date(now.getFullYear(), m, 1);
      buckets.push({
        key: `${d.getFullYear()}-${String(m + 1).padStart(2, '0')}`,
        date: d.toLocaleString('en-US', { month: 'short' }),
        revenue: 0,
      });
    }
  } else {
    const days = period === 'week' ? 7 : 30;
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      buckets.push({ key: keyForDay(d), date: keyForDay(d), revenue: 0 });
    }
  }

  const first = buckets[0].key;
  const rangeStart = new Date(first.length === 7 ? `${first}-01` : first);
  rangeStart.setHours(0, 0, 0, 0);

  const payments = await Payment.find({
    status: 'completed',
    createdAt: { $gte: rangeStart },
  }).select('amount createdAt');

  const index = {};
  buckets.forEach((b) => {
    index[b.key] = b;
  });

  payments.forEach((p) => {
    const d = new Date(p.createdAt);
    const key =
      period === 'year'
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        : keyForDay(d);
    if (index[key]) index[key].revenue += p.amount;
  });

  return { period, data: buckets.map((b) => ({ date: b.date, revenue: b.revenue })) };
}

async function computeCategoryStats() {
  const equipmentColl = Equipment.collection.name;
  const bookingColl = Booking.collection.name;

  const equipmentCounts = await Equipment.aggregate([
    { $group: { _id: '$category', equipmentCount: { $sum: 1 } } },
  ]);

  const bookingCounts = await Booking.aggregate([
    {
      $lookup: {
        from: equipmentColl,
        localField: 'equipment',
        foreignField: '_id',
        as: 'eq',
      },
    },
    { $unwind: '$eq' },
    { $group: { _id: '$eq.category', bookingCount: { $sum: 1 } } },
  ]);

  const revenue = await Payment.aggregate([
    { $match: { status: 'completed' } },
    {
      $lookup: {
        from: bookingColl,
        localField: 'booking',
        foreignField: '_id',
        as: 'bk',
      },
    },
    { $unwind: '$bk' },
    {
      $lookup: {
        from: equipmentColl,
        localField: 'bk.equipment',
        foreignField: '_id',
        as: 'eq',
      },
    },
    { $unwind: '$eq' },
    { $group: { _id: '$eq.category', revenue: { $sum: '$amount' } } },
  ]);

  const CATEGORIES = ['cameras', 'tools', 'sports', 'electronics', 'audio', 'lighting'];
  const byCat = (arr, field) =>
    arr.reduce((acc, cur) => {
      acc[cur._id] = cur[field];
      return acc;
    }, {});

  const eqMap = byCat(equipmentCounts, 'equipmentCount');
  const bkMap = byCat(bookingCounts, 'bookingCount');
  const revMap = byCat(revenue, 'revenue');

  return CATEGORIES.map((category) => ({
    category,
    equipmentCount: eqMap[category] || 0,
    bookingCount: bkMap[category] || 0,
    revenue: revMap[category] || 0,
  }));
}

// Build a map of per-equipment stats: bookingCount, revenue, avgDurationDays
async function computeEquipmentStatsMap() {
  const bookingColl = Booking.collection.name;

  const bookingAgg = await Booking.aggregate([
    {
      $group: {
        _id: '$equipment',
        bookingCount: { $sum: 1 },
        avgDurationMs: { $avg: { $subtract: ['$endDate', '$startDate'] } },
      },
    },
  ]);

  const revenueAgg = await Payment.aggregate([
    { $match: { status: 'completed' } },
    {
      $lookup: {
        from: bookingColl,
        localField: 'booking',
        foreignField: '_id',
        as: 'bk',
      },
    },
    { $unwind: '$bk' },
    { $group: { _id: '$bk.equipment', revenue: { $sum: '$amount' } } },
  ]);

  const map = {};
  bookingAgg.forEach((b) => {
    map[b._id.toString()] = {
      bookingCount: b.bookingCount,
      revenue: 0,
      avgRentalDuration: b.avgDurationMs
        ? Math.round(b.avgDurationMs / (1000 * 60 * 60 * 24))
        : 0,
    };
  });
  revenueAgg.forEach((r) => {
    const key = r._id.toString();
    if (!map[key]) map[key] = { bookingCount: 0, avgRentalDuration: 0, revenue: 0 };
    map[key].revenue = r.revenue;
  });
  return map;
}

// @route GET /api/admin/equipment
// @desc  All equipment with booking count + revenue, paginated (admin)
exports.getAdminEquipment = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 12, 1);
    const skip = (page - 1) * limit;

    const [items, total, statsMap] = await Promise.all([
      Equipment.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Equipment.countDocuments(),
      computeEquipmentStatsMap(),
    ]);

    const equipment = items.map((e) => {
      const s = statsMap[e._id.toString()] || {
        bookingCount: 0,
        revenue: 0,
        avgRentalDuration: 0,
      };
      return { ...e, ...s };
    });

    // Most popular across the whole catalogue
    let mostPopular = null;
    Object.entries(statsMap).forEach(([id, s]) => {
      if (!mostPopular || s.bookingCount > mostPopular.bookingCount) {
        mostPopular = { id, bookingCount: s.bookingCount, revenue: s.revenue };
      }
    });

    return res.json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      count: equipment.length,
      mostPopular,
      equipment,
    });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/admin/equipment/low-stock
// @desc  Equipment where quantity - active bookings <= 1 (admin)
exports.getLowStockEquipment = async (req, res, next) => {
  try {
    const activeAgg = await Booking.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$equipment', active: { $sum: 1 } } },
    ]);
    const activeMap = activeAgg.reduce((acc, cur) => {
      acc[cur._id.toString()] = cur.active;
      return acc;
    }, {});

    const items = await Equipment.find().lean();
    const lowStock = items
      .map((e) => {
        const active = activeMap[e._id.toString()] || 0;
        return { ...e, activeBookings: active, remaining: e.quantity - active };
      })
      .filter((e) => e.remaining <= 1);

    return res.json({ success: true, count: lowStock.length, equipment: lowStock });
  } catch (error) {
    next(error);
  }
};

// ---- Route handlers ----

// @route GET /api/admin/stats
exports.getStats = async (req, res, next) => {
  try {
    return res.json({ success: true, stats: await computeStats() });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/admin/recent-bookings
exports.getRecentBookings = async (req, res, next) => {
  try {
    return res.json({ success: true, bookings: await computeRecentBookings() });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/admin/revenue-chart?period=week|month|year
exports.getRevenueChart = async (req, res, next) => {
  try {
    const result = await computeRevenueChart(req.query.period);
    return res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/admin/category-stats
exports.getCategoryStats = async (req, res, next) => {
  try {
    return res.json({ success: true, categories: await computeCategoryStats() });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/admin/overview
exports.getOverview = async (req, res, next) => {
  try {
    const [stats, recentBookings, revenueChart, categoryStats] = await Promise.all([
      computeStats(),
      computeRecentBookings(),
      computeRevenueChart(req.query.period),
      computeCategoryStats(),
    ]);

    return res.json({
      success: true,
      stats,
      recentBookings,
      revenueChart: revenueChart.data,
      categoryStats,
    });
  } catch (error) {
    next(error);
  }
};

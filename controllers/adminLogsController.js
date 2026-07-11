const AuditLog = require('../models/AuditLog');

const SECURITY_ACTIONS = ['LOGIN_FAILED', 'ACCESS_DENIED', 'RATE_LIMITED', 'SUSPICIOUS_ACTIVITY'];

// @route GET /api/admin/logs
// Filters: action, userId, ip, startDate, endDate + pagination.
exports.getLogs = async (req, res, next) => {
  try {
    const { action, userId, ip, startDate, endDate } = req.query;
    const filter = {};
    if (action) filter.action = action;
    if (userId) filter.userId = userId;
    if (ip) filter.ip = ip;
    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = new Date(startDate);
      if (endDate) filter.timestamp.$lte = new Date(endDate);
    }

    const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 1000);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      count: logs.length,
      logs,
    });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/admin/logs/security
// Security-relevant events, last 24 hours by default.
exports.getSecurityLogs = async (req, res, next) => {
  try {
    const since = req.query.startDate
      ? new Date(req.query.startDate)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);

    const logs = await AuditLog.find({
      action: { $in: SECURITY_ACTIONS },
      timestamp: { $gte: since },
    })
      .sort({ timestamp: -1 })
      .limit(500)
      .lean();

    return res.json({ success: true, since, count: logs.length, logs });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/admin/logs/stats
// Today's totals: all events, failed logins, access denied, unique IPs.
exports.getLogStats = async (req, res, next) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const base = { timestamp: { $gte: startOfToday } };
    const [totalEvents, failedLogins, accessDenied, rateLimited, uniqueIps] =
      await Promise.all([
        AuditLog.countDocuments(base),
        AuditLog.countDocuments({ ...base, action: 'LOGIN_FAILED' }),
        AuditLog.countDocuments({ ...base, action: 'ACCESS_DENIED' }),
        AuditLog.countDocuments({ ...base, action: 'RATE_LIMITED' }),
        AuditLog.distinct('ip', base),
      ]);

    return res.json({
      success: true,
      stats: {
        totalEventsToday: totalEvents,
        failedLoginsToday: failedLogins,
        accessDeniedToday: accessDenied,
        rateLimitedToday: rateLimited,
        uniqueIpsToday: uniqueIps.filter(Boolean).length,
      },
    });
  } catch (error) {
    next(error);
  }
};

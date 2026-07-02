const {
  blockIp,
  unblockIp,
  listBlockedIps,
} = require('../middleware/ipProtection');

// Basic IPv4/IPv6 sanity check to avoid storing junk.
const IP_REGEX =
  /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$|^::1$|^::ffff:(\d{1,3}\.){3}\d{1,3}$/;

// @route GET /api/admin/security/blocked-ips
exports.getBlockedIps = async (req, res, next) => {
  try {
    const ips = await listBlockedIps();
    return res.json({ success: true, count: ips.length, blockedIps: ips });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/admin/security/block-ip   body: { ip, reason?, expiresAt? }
exports.blockIpAddress = async (req, res, next) => {
  try {
    const { ip, reason, expiresAt } = req.body;
    if (!ip || !IP_REGEX.test(String(ip).trim())) {
      return res
        .status(400)
        .json({ success: false, message: 'A valid IP address is required' });
    }

    await blockIp(String(ip).trim(), {
      reason: reason || 'Manually blocked by admin',
      auto: false,
      blockedBy: req.user._id,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });

    return res.json({ success: true, message: `IP ${ip} has been blocked` });
  } catch (error) {
    next(error);
  }
};

// @route DELETE /api/admin/security/unblock-ip   body: { ip }
exports.unblockIpAddress = async (req, res, next) => {
  try {
    const ip = req.body?.ip || req.query?.ip;
    if (!ip) {
      return res.status(400).json({ success: false, message: 'IP address is required' });
    }
    await unblockIp(String(ip).trim());
    return res.json({ success: true, message: `IP ${ip} has been unblocked` });
  } catch (error) {
    next(error);
  }
};

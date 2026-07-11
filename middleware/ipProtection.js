const BlockedIp = require('../models/BlockedIp');

// -----------------------------------------------------------------------------
// In-memory state
// -----------------------------------------------------------------------------
// Cache of currently-blocked IPs, refreshed from the DB periodically and updated
// live whenever we block/unblock. Value = expiresAt (Date|null for permanent).
const blockedCache = new Map();

// Rolling window of failed logins per IP: ip -> array of timestamps (ms).
const failedLogins = new Map();

// Request fingerprints: ip -> { agents:Set, first:ts, count:number }.
const fingerprints = new Map();

const FAILED_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const AUTO_BLOCK_THRESHOLD = 20; // failed logins within the window
const FINGERPRINT_WINDOW_MS = 60 * 1000; // 1 minute
const SUSPICIOUS_AGENT_COUNT = 6; // distinct UAs from one IP within window

function clientIp(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

// Refresh the in-memory blocklist from the database.
async function loadBlockedIps() {
  try {
    const docs = await BlockedIp.find().select('ip expiresAt').lean();
    blockedCache.clear();
    for (const d of docs) blockedCache.set(d.ip, d.expiresAt || null);
  } catch (err) {
    console.error('[ipProtection] failed to load blocklist:', err.message);
  }
}

// Is this IP currently blocked? Honors per-entry expiry.
function isBlocked(ip) {
  if (!blockedCache.has(ip)) return false;
  const expiresAt = blockedCache.get(ip);
  if (expiresAt && expiresAt.getTime() < Date.now()) {
    // Expired: drop from cache and clean up the DB lazily.
    blockedCache.delete(ip);
    BlockedIp.deleteOne({ ip }).catch(() => {});
    return false;
  }
  return true;
}

// Add/refresh a block entry (used by auto-block and the admin controller).
async function blockIp(ip, { reason, auto = false, blockedBy = null, expiresAt = null } = {}) {
  await BlockedIp.updateOne(
    { ip },
    { ip, reason: reason || 'Suspicious activity', auto, blockedBy, expiresAt },
    { upsert: true }
  );
  blockedCache.set(ip, expiresAt);
}

async function unblockIp(ip) {
  await BlockedIp.deleteOne({ ip });
  blockedCache.delete(ip);
  failedLogins.delete(ip);
}

async function listBlockedIps() {
  return BlockedIp.find().sort({ createdAt: -1 }).lean();
}

// Record a failed login for an IP and auto-block once the threshold is crossed.
async function recordFailedLogin(ip) {
  if (!ip || ip === 'unknown') return;
  const now = Date.now();
  const hits = (failedLogins.get(ip) || []).filter((t) => now - t < FAILED_WINDOW_MS);
  hits.push(now);
  failedLogins.set(ip, hits);

  if (hits.length >= AUTO_BLOCK_THRESHOLD && !isBlocked(ip)) {
    await blockIp(ip, {
      reason: `Auto-blocked: ${hits.length} failed logins within 1 hour`,
      auto: true,
    });
    console.warn(`[ipProtection] auto-blocked ${ip} after ${hits.length} failed logins`);
    try {
      const { notifyAdmins } = require('../utils/notify');
      notifyAdmins({
        title: 'IP auto-blocked',
        message: `IP ${ip} was blocked after ${hits.length} failed logins in one hour.`,
        type: 'warning',
        link: '/admin',
      });
    } catch {
      /* best-effort */
    }
  }
}

// Clear failed-login tracking for an IP (e.g. after a successful login).
function clearFailedLogins(ip) {
  failedLogins.delete(ip);
}

// Number of failed logins from an IP within the current window.
function getFailedLoginCount(ip) {
  if (!ip) return 0;
  const now = Date.now();
  const hits = (failedLogins.get(ip) || []).filter((t) => now - t < FAILED_WINDOW_MS);
  return hits.length;
}

// Request fingerprinting: flag an IP cycling through many user agents quickly.
function trackFingerprint(req) {
  const ip = clientIp(req);
  const ua = req.headers['user-agent'] || 'unknown';
  const now = Date.now();

  let fp = fingerprints.get(ip);
  if (!fp || now - fp.first > FINGERPRINT_WINDOW_MS) {
    fp = { agents: new Set(), first: now, count: 0, alerted: false };
    fingerprints.set(ip, fp);
  }
  fp.agents.add(ua);
  fp.count += 1;

  if (fp.agents.size >= SUSPICIOUS_AGENT_COUNT && !fp.alerted) {
    fp.alerted = true;
    console.warn(
      `[ipProtection] suspicious fingerprint: ip=${ip} distinctUserAgents=${fp.agents.size} ` +
        `requests=${fp.count} within ${FINGERPRINT_WINDOW_MS / 1000}s`
    );
  }
}

// -----------------------------------------------------------------------------
// Middleware: reject blocked IPs up front, track fingerprints for the rest.
// -----------------------------------------------------------------------------
function ipProtection(req, res, next) {
  const ip = clientIp(req);
  if (isBlocked(ip)) {
    req.setAudit?.('SUSPICIOUS_ACTIVITY', {
      details: { reason: 'request from blocked IP' },
    });
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  trackFingerprint(req);
  next();
}

// Load the blocklist on startup and refresh every 5 minutes to pick up changes
// (e.g. expired entries, or blocks made by another instance).
loadBlockedIps();
setInterval(loadBlockedIps, 5 * 60 * 1000).unref();

module.exports = {
  ipProtection,
  isBlocked,
  blockIp,
  unblockIp,
  listBlockedIps,
  recordFailedLogin,
  clearFailedLogins,
  getFailedLoginCount,
  loadBlockedIps,
};

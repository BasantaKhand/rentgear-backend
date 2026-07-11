const fs = require('fs');
const path = require('path');

// Simple append-only file logging as a backup to the DB audit trail.
// Three streams: access (all audited requests), security (auth/authz/abuse),
// and error (5xx). Sensitive data is expected to be masked before it arrives.

const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const SECURITY_ACTIONS = new Set([
  'LOGIN_FAILED',
  'ACCESS_DENIED',
  'RATE_LIMITED',
  'SUSPICIOUS_ACTIVITY',
  'ACCOUNT_LOCKED',
  'INVALID_TOKEN',
]);

function line(entry) {
  const level = entry.statusCode >= 500 ? 'ERROR' : SECURITY_ACTIONS.has(entry.action) ? 'SECURITY' : 'INFO';
  const user = entry.userId || 'anon';
  const details = entry.details ? ` ${JSON.stringify(entry.details)}` : '';
  return `[${entry.timestamp}] [${level}] [${entry.action}] [user:${user}] [ip:${entry.ip}] [${entry.method} ${entry.endpoint} ${entry.statusCode}]${details}\n`;
}

function append(file, text) {
  fs.appendFile(path.join(logsDir, file), text, (err) => {
    if (err) console.error('[fileLogger] write failed:', err.message);
  });
}

// Fire-and-forget: route an entry to the appropriate log file(s).
function writeToFiles(entry) {
  const text = line(entry);
  append('access.log', text);
  if (SECURITY_ACTIONS.has(entry.action)) append('security.log', text);
  if (entry.statusCode >= 500) append('error.log', text);
}

module.exports = { writeToFiles, SECURITY_ACTIONS };

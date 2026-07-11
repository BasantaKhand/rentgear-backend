// Helpers to mask sensitive values before they ever reach a log sink.

// j***@example.com  (keeps first char + domain)
function maskEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  const first = local.slice(0, 1) || '';
  return `${first}***@${domain}`;
}

// ***-***-4567  (keeps last 4 digits only)
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return phone;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***-***-${digits.slice(-4)}`;
}

// Only the last 8 characters of a token are ever recorded.
function maskToken(token) {
  if (!token || typeof token !== 'string') return token;
  return `...${token.slice(-8)}`;
}

// Only expose the filename, never the full stored path of an ID document.
function maskPath(p) {
  if (!p || typeof p !== 'string') return p;
  const parts = p.split(/[/\\]/);
  return `.../${parts[parts.length - 1]}`;
}

// Defensive scrub of an arbitrary details object: drop secrets outright and
// mask anything that looks sensitive by key name.
const DROP_KEYS = ['password', 'newpassword', 'currentpassword', 'passwordhistory', 'encryptionkey'];
function scrubDetails(details) {
  if (!details || typeof details !== 'object') return details;
  const out = Array.isArray(details) ? [] : {};
  for (const [key, value] of Object.entries(details)) {
    const k = key.toLowerCase();
    if (DROP_KEYS.includes(k)) continue; // never log passwords/keys
    if (k === 'email') out[key] = maskEmail(value);
    else if (k === 'phone') out[key] = maskPhone(value);
    else if (k === 'token' || k === 'refreshtoken' || k === 'accesstoken') out[key] = maskToken(value);
    else if (k === 'iddocument' || k === 'path') out[key] = maskPath(value);
    else if (value && typeof value === 'object') out[key] = scrubDetails(value);
    else out[key] = value;
  }
  return out;
}

module.exports = { maskEmail, maskPhone, maskToken, maskPath, scrubDetails };

// Lightweight in-memory heuristics for suspicious activity. These feed
// SUSPICIOUS_ACTIVITY audit entries; they are best-effort and reset on restart.

const passwordChanges = new Map(); // userId -> [timestamps]
const bookingAccess = new Map(); // userId -> { ids:Set, first:ts }

const PW_WINDOW_MS = 10 * 60 * 1000;
const PW_THRESHOLD = 3; // >3 password changes in 10 min
const BOOKING_WINDOW_MS = 60 * 60 * 1000;
const BOOKING_THRESHOLD = 50; // 50+ distinct booking ids in 1 hour

// Returns true if the user has changed passwords suspiciously often.
function notePasswordChange(userId) {
  if (!userId) return false;
  const key = String(userId);
  const now = Date.now();
  const hits = (passwordChanges.get(key) || []).filter((t) => now - t < PW_WINDOW_MS);
  hits.push(now);
  passwordChanges.set(key, hits);
  return hits.length > PW_THRESHOLD;
}

// Returns true if the user is enumerating many distinct booking ids.
function noteBookingAccess(userId, bookingId) {
  if (!userId || !bookingId) return false;
  const key = String(userId);
  const now = Date.now();
  let rec = bookingAccess.get(key);
  if (!rec || now - rec.first > BOOKING_WINDOW_MS) {
    rec = { ids: new Set(), first: now };
    bookingAccess.set(key, rec);
  }
  rec.ids.add(String(bookingId));
  return rec.ids.size >= BOOKING_THRESHOLD;
}

module.exports = { notePasswordChange, noteBookingAccess };

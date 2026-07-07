// Whitelist-based body filtering to prevent mass assignment. Returns a new
// object containing only the allowed fields, and reports which extra fields
// were stripped (so the caller can log an attempt).
function filterBody(body, ...allowedFields) {
  const filtered = {};
  const stripped = [];
  if (body && typeof body === 'object') {
    for (const key of Object.keys(body)) {
      if (allowedFields.includes(key)) {
        filtered[key] = body[key];
      } else {
        stripped.push(key);
      }
    }
  }
  return { filtered, stripped };
}

module.exports = { filterBody };

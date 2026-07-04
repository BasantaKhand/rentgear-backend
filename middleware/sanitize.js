const sanitizeHtml = require('sanitize-html');

// Maximum length we allow for any single string field at the middleware level
// (individual routes may enforce tighter limits via validators).
const MAX_STRING_LEN = 10000;

// Express 5 exposes req.query as a getter-only property, which breaks
// middlewares that reassign it (express-mongo-sanitize, hpp). Redefining it as
// a writable data property (a plain copy) restores Express-4-style behavior.
function makeQueryWritable(req, res, next) {
  try {
    const current = req.query;
    Object.defineProperty(req, 'query', {
      value: { ...current },
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } catch {
    /* if it's already writable, leave it */
  }
  next();
}

// Clean a single string: strip null bytes + control chars, remove ALL HTML
// (no tags/attributes allowed), decode entities safely, trim, and cap length.
function cleanString(value) {
  let s = String(value);
  // Remove null bytes and control characters (except normal whitespace).
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  // Strip every HTML tag and disallow all attributes → neutralizes XSS payloads.
  s = sanitizeHtml(s, { allowedTags: [], allowedAttributes: {}, disallowedTagsMode: 'discard' });
  s = s.trim();
  if (s.length > MAX_STRING_LEN) s = s.slice(0, MAX_STRING_LEN);
  return s;
}

// Recursively sanitize all string values in an object/array in place.
function sanitizeValue(value, depth = 0) {
  if (depth > 10) return value; // guard against pathological nesting
  if (typeof value === 'string') return cleanString(value);
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeValue(v, depth + 1));
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      value[key] = sanitizeValue(value[key], depth + 1);
    }
    return value;
  }
  return value;
}

// XSS / control-char cleaning for body, params and query. Runs after the
// mongo-sanitize + hpp middlewares. Mutates each container in place so it
// stays compatible with Express 5's query property.
function xssClean(req, res, next) {
  if (req.body && typeof req.body === 'object') sanitizeValue(req.body);
  if (req.params && typeof req.params === 'object') sanitizeValue(req.params);
  if (req.query && typeof req.query === 'object') sanitizeValue(req.query);
  next();
}

module.exports = { makeQueryWritable, xssClean, cleanString, MAX_STRING_LEN };

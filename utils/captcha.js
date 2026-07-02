const crypto = require('crypto');

// Self-contained CAPTCHA: a simple arithmetic challenge whose answer is carried
// in a signed, expiring token. No server-side session or external service is
// needed — the token is stateless and tamper-evident via HMAC.

const TTL_MS = 5 * 60 * 1000; // challenge valid for 5 minutes
const secret = () =>
  process.env.CAPTCHA_SECRET || process.env.JWT_SECRET || 'rentgear-captcha-secret';

function sign(payloadB64) {
  return crypto.createHmac('sha256', secret()).update(payloadB64).digest('hex');
}

// Generate a challenge. Returns { question, token }.
function generateCaptcha() {
  const a = Math.floor(Math.random() * 9) + 1;
  const b = Math.floor(Math.random() * 9) + 1;
  const ops = [
    { sym: '+', fn: (x, y) => x + y },
    { sym: '\u00d7', fn: (x, y) => x * y }, // ×
  ];
  const op = ops[Math.floor(Math.random() * ops.length)];
  // For addition allow either order; multiplication with single digits is fine.
  const answer = op.fn(a, b);

  const payload = { answer, exp: Date.now() + TTL_MS, n: crypto.randomBytes(6).toString('hex') };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = `${payloadB64}.${sign(payloadB64)}`;

  return { question: `What is ${a} ${op.sym} ${b}?`, token };
}

// Verify a submitted answer against its token. Returns true/false.
function verifyCaptcha(token, submittedAnswer) {
  if (!token || submittedAnswer === undefined || submittedAnswer === null) return false;
  const [payloadB64, sig] = String(token).split('.');
  if (!payloadB64 || !sig) return false;

  // Constant-time signature check.
  const expected = sign(payloadB64);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return false;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return false;
  }

  if (!payload || typeof payload.answer !== 'number') return false;
  if (payload.exp < Date.now()) return false;

  return Number(submittedAnswer) === payload.answer;
}

module.exports = { generateCaptcha, verifyCaptcha, CAPTCHA_TTL_MS: TTL_MS };

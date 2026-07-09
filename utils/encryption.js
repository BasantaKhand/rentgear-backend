const crypto = require('crypto');

// AES-256-GCM encryption for sensitive fields at rest. Values are stored in the
// format:  enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
// The "enc:" prefix lets us detect (and skip) already-encrypted or legacy
// plaintext values, so encrypt/decrypt are safe to apply repeatedly and won't
// corrupt data written before encryption was introduced.

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

// Derive a stable 32-byte key from ENCRYPTION_KEY (any length string works).
function getKey() {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'rentgear-dev-encryption-key';
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

// Encrypt a string. No-op for empty values or values already encrypted.
function encrypt(text) {
  if (text === null || text === undefined || text === '') return text;
  const str = String(text);
  if (isEncrypted(str)) return str;

  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(str, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

// Decrypt a value. Returns non-encrypted input unchanged (legacy plaintext),
// and falls back to the raw value if decryption fails (never throws).
function decrypt(value) {
  if (!isEncrypted(value)) return value;
  try {
    const [, , ivHex, tagHex, dataHex] = value.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return value;
  }
}

module.exports = { encrypt, decrypt, isEncrypted };

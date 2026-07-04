const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const baseDir = path.join(__dirname, '..', 'uploads');
const MAX_DIM = 5000; // max image width/height in px

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

// Allowed types keyed by upload area. Equipment takes images only; ID docs also
// accept PDF. Each entry maps a canonical type to its safe extension.
const ALLOWED = {
  equipment: { 'image/jpeg': 'jpg', 'image/png': 'png' },
  ids: { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' },
};

const EXT_BY_TYPE = { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'application/pdf': ['pdf'] };

// Detect the real content type from magic bytes (never trust the extension or
// the client-supplied mimetype).
function detectType(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return 'application/pdf'; // %PDF
  }
  return null;
}

// Read image dimensions for PNG/JPEG from the buffer. Returns {width,height} or null.
function imageDimensions(buf, type) {
  try {
    if (type === 'image/png') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (type === 'image/jpeg') {
      let offset = 2;
      while (offset < buf.length) {
        if (buf[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buf[offset + 1];
        // SOF markers carry the frame dimensions (skip DHT/DQT/etc.)
        if (
          marker >= 0xc0 && marker <= 0xcf &&
          marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
        ) {
          return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
        }
        const segLen = buf.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      }
    }
  } catch {
    return null;
  }
  return null;
}

// Filename safety: reject path traversal and double extensions before we ever
// touch the disk. (We generate our own name anyway, but this rejects abuse early.)
function filenameIsSafe(name) {
  if (!name) return false;
  if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return false;
  }
  // Only a single extension allowed (blocks ".php.jpg", "shell.jpg.exe", etc.)
  const dots = name.split('.').length - 1;
  if (dots > 1) return false;
  return true;
}

const memoryUpload = (area) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
      if (!filenameIsSafe(file.originalname)) {
        return cb(new Error('Invalid file name'));
      }
      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
      const validExts = Object.keys(ALLOWED[area]).flatMap((t) => EXT_BY_TYPE[t]);
      if (!validExts.includes(ext)) {
        return cb(new Error(`Invalid file type. Allowed: ${validExts.join(', ')}`));
      }
      cb(null, true);
    },
  });

const uploadId = memoryUpload('ids');
const uploadEquipment = memoryUpload('equipment');

// Post-multer middleware: verifies magic bytes + dimensions, then writes the
// buffer to disk under a random, safe filename. Skips cleanly when no file was
// sent (e.g. equipment update without a new image).
const processUpload = (area) => (req, res, next) => {
  if (!req.file || !req.file.buffer) return next();

  const detected = detectType(req.file.buffer);
  const allowedTypes = ALLOWED[area];
  if (!detected || !allowedTypes[detected]) {
    return res.status(400).json({
      success: false,
      message: 'File content does not match an allowed type (JPEG, PNG'
        + (area === 'ids' ? ' or PDF).' : ').'),
    });
  }

  // Image dimension guard.
  if (detected === 'image/jpeg' || detected === 'image/png') {
    const dims = imageDimensions(req.file.buffer, detected);
    if (dims && (dims.width > MAX_DIM || dims.height > MAX_DIM)) {
      return res.status(400).json({
        success: false,
        message: `Image too large (max ${MAX_DIM}x${MAX_DIM}px)`,
      });
    }
  }

  const dir = path.join(baseDir, area);
  ensureDir(dir);

  const ext = allowedTypes[detected];
  const userId = req.user ? req.user._id : 'anon';
  const random = crypto.randomBytes(8).toString('hex');
  const filename = `${userId}_${Date.now()}_${random}.${ext}`;

  try {
    fs.writeFileSync(path.join(dir, filename), req.file.buffer);
  } catch (err) {
    return next(err);
  }

  // Expose the same shape downstream controllers already expect.
  req.file.filename = filename;
  req.file.path = path.join(dir, filename);
  next();
};

// Wrap a multer middleware so multer/file-filter errors return a clean 400/413.
const handleUpload = (multerMiddleware) => (req, res, next) => {
  multerMiddleware(req, res, (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ success: false, message: err.message });
    }
    next();
  });
};

module.exports = { uploadId, uploadEquipment, processUpload, handleUpload };

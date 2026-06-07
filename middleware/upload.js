const multer = require('multer');
const path = require('path');
const fs = require('fs');

const baseDir = path.join(__dirname, '..', 'uploads');

// Ensure a directory exists (created recursively)
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// File filter factory for a given set of allowed extensions/mimetypes
const makeFileFilter = (allowedRegex, label) => (req, file, cb) => {
  const extOk = allowedRegex.test(path.extname(file.originalname).toLowerCase());
  const mimeOk = allowedRegex.test(file.mimetype);
  if (extOk && mimeOk) {
    return cb(null, true);
  }
  cb(new Error(`Invalid file type. Allowed types: ${label}`));
};

// Build a multer uploader that saves to uploads/<subfolder> with the
// filename pattern: <userId>_<timestamp>.<ext>
const makeUploader = (subfolder, fileFilter) => {
  const dir = path.join(baseDir, subfolder);
  ensureDir(dir);

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const userId = req.user ? req.user._id : 'anon';
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${userId}_${Date.now()}${ext}`);
    },
  });

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  });
};

// ID documents: images + PDF, saved to uploads/ids/
const uploadId = makeUploader(
  'ids',
  makeFileFilter(/jpeg|jpg|png|pdf/, 'jpg, jpeg, png, pdf')
);

// Equipment images: images only, saved to uploads/equipment/
const uploadEquipment = makeUploader(
  'equipment',
  makeFileFilter(/jpeg|jpg|png|webp|gif/, 'jpg, jpeg, png, webp, gif')
);

// Wrap a multer middleware so multer/file-filter errors return a clean 400
// instead of bubbling up as a generic 500.
const handleUpload = (multerMiddleware) => (req, res, next) => {
  multerMiddleware(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
};

module.exports = { uploadId, uploadEquipment, handleUpload };

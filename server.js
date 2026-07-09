require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');

const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');
const { ipProtection } = require('./middleware/ipProtection');
const { globalLimiter, apiLimiter } = require('./middleware/rateLimiter');
const { makeQueryWritable, xssClean } = require('./middleware/sanitize');
const httpsRedirect = require('./middleware/httpsRedirect');

// Route imports
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const equipmentRoutes = require('./routes/equipment');
const bookingRoutes = require('./routes/bookings');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const testRoutes = require('./routes/test');
const notificationRoutes = require('./routes/notifications');

const app = express();

// Don't advertise the framework in responses.
app.disable('x-powered-by');
// We sit behind a single proxy in most deployments; trust it so req.ip is real.
app.set('trust proxy', 1);

// Connect to MongoDB
connectDB();

// Force HTTPS in production (no-op in development).
app.use(httpsRedirect);

// --- Security headers (Helmet) ---
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // inline styles used by the UI
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
        connectSrc: ["'self'", 'http://localhost:5000'],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
    // Allow the frontend (different origin in dev) to load uploaded images.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    xFrameOptions: { action: 'deny' },
    xContentTypeOptions: true,
  })
);
// X-XSS-Protection: 0 (explicitly disable the legacy, buggy auditor)
app.use((req, res, next) => {
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Build the list of allowed origins. CLIENT_URL may be a comma-separated list.
// Vite falls back to 5174/5175 when 5173 is taken, so allow those in dev too.
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'].forEach(
  (o) => {
    if (!allowedOrigins.includes(o)) allowedOrigins.push(o);
  }
);

// --- Strict CORS ---
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, Postman) and whitelisted origins
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    credentials: true,
    maxAge: 86400,
  })
);
// Cap request body size to limit abuse (file uploads use multer, not these).
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser(process.env.COOKIE_SECRET || process.env.JWT_SECRET));

// --- Input sanitization (must run before routes) ---
// Make req.query writable so the Express-4-era sanitizers work on Express 5.
app.use(makeQueryWritable);
// Strip Mongo operators ($, .) from body/params/query to block NoSQL injection.
app.use(mongoSanitize());
// Prevent HTTP parameter pollution; allow a few filters to repeat legitimately.
app.use(hpp({ whitelist: ['category', 'status', 'ids'] }));
// Strip HTML/control chars from all string inputs (XSS defense).
app.use(xssClean);

// Reject requests from blocked IPs before doing any real work.
app.use(ipProtection);

// Global rate limit across every route.
app.use(globalLimiter);

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'RentGear API is running' });
});

// Moderate per-minute limit for all API traffic.
app.use('/api', apiLimiter);

// Mount routes under /api
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/test', testRoutes);
app.use('/api/notifications', notificationRoutes);

// Global error handler (must be last)
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;

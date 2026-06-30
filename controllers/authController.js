const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { generateToken } = require('../utils/helpers');
const { sendEmail } = require('../config/email');
const { welcomeEmail } = require('../utils/emailTemplates');
const { notify, notifyAdmins } = require('../utils/notify');

// Build a safe user object without the password field
const sanitizeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  address: user.address,
  role: user.role,
  verified: user.verified,
  isActive: user.isActive !== false,
  idDocument: user.idDocument,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

// @route  POST /api/auth/register
// @desc   Register a new customer
// @access Public
exports.register = async (req, res, next) => {
  try {
    const { name, email, password, phone } = req.body;

    // Check if email already exists
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res
        .status(400)
        .json({ success: false, message: 'Email already registered' });
    }

    // Hash password with 10 salt rounds
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user with default role "customer"
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      phone,
      role: 'customer',
    });

    const token = generateToken(user._id);

    // Send welcome email (non-blocking, must not fail registration)
    sendEmail({ to: user.email, ...welcomeEmail(user) }).catch(() => {});

    // In-app notifications: welcome the user, alert admins
    notify(user._id, {
      title: 'Welcome to RentGear',
      message: 'Your account is ready. Browse equipment to get started.',
      type: 'success',
      link: '/equipment',
    });
    notifyAdmins({
      title: 'New user registered',
      message: `${user.name} (${user.email}) just signed up.`,
      type: 'user',
      link: '/admin/users',
    });

    return res.status(201).json({
      success: true,
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    next(error);
  }
};

// @route  POST /api/auth/login
// @desc   Authenticate user and return token
// @access Public
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Need to explicitly select password since it's excluded by default
    const user = await User.findOne({ email: email.toLowerCase() }).select(
      '+password'
    );
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: 'Invalid credentials' });
    }

    // Deny login for disabled accounts
    if (user.isActive === false) {
      return res
        .status(403)
        .json({ success: false, message: 'Account has been disabled' });
    }

    const token = generateToken(user._id);

    return res.json({
      success: true,
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    next(error);
  }
};

// @route  GET /api/auth/me
// @desc   Get current authenticated user
// @access Private
exports.getMe = async (req, res, next) => {
  try {
    // req.user is set by the auth middleware (already without password)
    return res.json({ success: true, user: sanitizeUser(req.user) });
  } catch (error) {
    next(error);
  }
};

// @route  POST /api/auth/logout
// @desc   Logout user (client discards token)
// @access Private
exports.logout = async (req, res) => {
  return res.json({ success: true, message: 'Logged out successfully' });
};

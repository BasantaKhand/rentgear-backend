require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

// Usage:
//   node utils/createAdmin.js [email] [password] [name]
// Defaults come from ADMIN_EMAIL / ADMIN_PASSWORD env vars or sensible fallbacks.
(async () => {
  const email = process.argv[2] || process.env.ADMIN_EMAIL || 'admin@rentgear.com';
  const password = process.argv[3] || process.env.ADMIN_PASSWORD || 'admin123';
  const name = process.argv[4] || 'Admin';

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const hash = await bcrypt.hash(password, 10);
    const user = await User.findOneAndUpdate(
      { email: email.toLowerCase() },
      {
        name,
        email: email.toLowerCase(),
        password: hash,
        role: 'admin',
        verified: true,
        isActive: true,
        phone: '+10000000000',
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    console.log(`Admin ready: ${user.email} / ${password}`);
  } catch (err) {
    console.error(`Failed to create admin: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();

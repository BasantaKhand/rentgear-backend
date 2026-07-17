// Email template builders. Each returns { subject, html, text }.

const CLIENT_URL = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',')[0].trim()
  : 'http://localhost:5173';

const shortId = (id) => `#BK-${(id || '').toString().slice(-4).toUpperCase()}`;

const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

// Wrap body content in a simple branded layout
const layout = (title, body) => `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;">
    <div style="background:#6366f1;color:#fff;padding:20px;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;font-size:20px;">RentGear</h1>
    </div>
    <div style="border:1px solid #e2e8f0;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
      <h2 style="font-size:18px;margin-top:0;">${title}</h2>
      ${body}
    </div>
    <p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:16px;">
      RentGear · 123 Rental Ave, Kathmandu · support@rentgear.com
    </p>
  </div>
`;

// 1. Welcome email
exports.welcomeEmail = (user) => ({
  subject: 'Welcome to RentGear',
  text: `Hi ${user.name}, welcome to RentGear! Browse equipment at ${CLIENT_URL}/equipment`,
  html: layout(
    `Welcome, ${user.name}!`,
    `<p>Thanks for joining <strong>RentGear</strong> — your marketplace for professional equipment rentals.</p>
     <p>From cameras to power tools, find everything you need for your next project.</p>
     <p><a href="${CLIENT_URL}/equipment" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">Browse Equipment</a></p>`
  ),
});

// 1b. Login OTP (two-factor)
exports.otpEmail = (code) => ({
  subject: 'RentGear - Your Login Code',
  text: `Your verification code is: ${code}. This code expires in 5 minutes. If you didn't request this, please ignore this email.`,
  html: layout(
    'Your Login Code',
    `<p>Use the verification code below to finish signing in:</p>
     <p style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;background:#f1f5f9;padding:16px;border-radius:8px;margin:16px 0;">${code}</p>
     <p>This code expires in <strong>5 minutes</strong>.</p>
     <p style="color:#94a3b8;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>`
  ),
});

// 1c. Password reset request
exports.passwordResetEmail = (resetUrl) => ({
  subject: 'RentGear - Reset Your Password',
  text: `You requested a password reset. Visit this link to reset your password: ${resetUrl} — This link expires in 15 minutes. If you didn't request this, ignore this email.`,
  html: layout(
    'Reset Your Password',
    `<p>You requested a password reset. Click the button below to choose a new password.</p>
     <p style="text-align:center;margin:24px 0;">
       <a href="${resetUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Reset Password</a>
     </p>
     <p>This link expires in <strong>15 minutes</strong>.</p>
     <p style="color:#94a3b8;font-size:13px;">If you didn't request this, you can safely ignore this email. Your password will remain unchanged.</p>`
  ),
});

// 1d. Password reset confirmation
exports.passwordResetConfirmation = () => ({
  subject: 'RentGear - Password Changed',
  text: `Your password has been successfully changed. If you didn't do this, contact support immediately at support@rentgear.com.`,
  html: layout(
    'Password Changed',
    `<p>Your password has been successfully changed.</p>
     <p>If you did not make this change, please contact support immediately at <a href="mailto:support@rentgear.com" style="color:#6366f1;">support@rentgear.com</a>.</p>`
  ),
});

// 2. Booking confirmation
exports.bookingConfirmation = (booking) => {
  const equipment = booking.equipment || {};
  return {
    subject: `Booking Confirmed - ${shortId(booking._id)}`,
    text: `Your booking ${shortId(booking._id)} for ${equipment.name} is confirmed for ${fmtDate(
      booking.startDate
    )} - ${fmtDate(booking.endDate)}. Total: ${money(booking.totalPrice)}.`,
    html: layout(
      'Booking Confirmed',
      `<p>Your booking <strong>${shortId(booking._id)}</strong> is confirmed.</p>
       <table style="width:100%;font-size:14px;border-collapse:collapse;">
         <tr><td style="padding:6px 0;">Equipment</td><td style="text-align:right;">${equipment.name || 'Equipment'}</td></tr>
         <tr><td style="padding:6px 0;">Dates</td><td style="text-align:right;">${fmtDate(booking.startDate)} - ${fmtDate(booking.endDate)}</td></tr>
         <tr><td style="padding:6px 0;">Rental total</td><td style="text-align:right;">${money(booking.totalPrice)}</td></tr>
         <tr><td style="padding:6px 0;">Deposit (refundable)</td><td style="text-align:right;">${money(booking.deposit)}</td></tr>
       </table>
       <p style="margin-top:16px;"><strong>Pickup instructions:</strong> Collect from RentGear Depot, 123 Rental Ave, Kathmandu (Mon-Sat, 9:00 AM - 6:00 PM). Bring a valid ID and your booking reference.</p>`
    ),
  };
};

// 3. Booking status update
exports.bookingStatusUpdate = (booking, status) => {
  const nextSteps = {
    approved: 'Your booking is approved. Please arrive during pickup hours with your ID.',
    active: 'Your rental is now active. Enjoy — and remember the return date.',
    completed: 'Your rental is complete. Thank you for choosing RentGear!',
    cancelled: 'Your booking has been cancelled. Any completed payment will be refunded.',
  };
  return {
    subject: `Booking Update - ${shortId(booking._id)}`,
    text: `Your booking ${shortId(booking._id)} is now "${status}". ${nextSteps[status] || ''}`,
    html: layout(
      'Booking Update',
      `<p>Your booking <strong>${shortId(booking._id)}</strong> status is now
       <strong style="text-transform:capitalize;">${status}</strong>.</p>
       <p>${nextSteps[status] || ''}</p>`
    ),
  };
};

// 4. Return reminder (1 day before due)
exports.returnReminder = (booking) => {
  const equipment = booking.equipment || {};
  return {
    subject: 'Return Reminder - Due Tomorrow',
    text: `Reminder: ${equipment.name} (booking ${shortId(booking._id)}) is due back on ${fmtDate(
      booking.endDate
    )}. Late returns incur a fee of the daily rate per extra day.`,
    html: layout(
      'Return Reminder - Due Tomorrow',
      `<p>This is a friendly reminder that your rental is due back tomorrow.</p>
       <table style="width:100%;font-size:14px;">
         <tr><td style="padding:6px 0;">Equipment</td><td style="text-align:right;">${equipment.name || 'Equipment'}</td></tr>
         <tr><td style="padding:6px 0;">Return by</td><td style="text-align:right;">${fmtDate(booking.endDate)}</td></tr>
         <tr><td style="padding:6px 0;">Location</td><td style="text-align:right;">RentGear Depot, 123 Rental Ave</td></tr>
       </table>
       <p style="color:#dc2626;margin-top:12px;"><strong>Note:</strong> Late returns are charged the daily rate for each additional day.</p>`
    ),
  };
};

// 6. ID verification confirmation
exports.idVerified = (user) => ({
  subject: 'Your RentGear account is verified',
  text: `Hi ${user.name}, your ID has been verified. You're all set to rent equipment.`,
  html: layout(
    'Account Verified',
    `<p>Hi ${user.name},</p>
     <p>Your uploaded ID has been reviewed and your account is now <strong>verified</strong>.</p>
     <p>You're all set to rent equipment on RentGear.</p>`
  ),
});

// 5. Payment receipt
exports.paymentReceipt = (payment, booking) => ({
  subject: `Payment Receipt - ${(payment._id || '').toString().slice(-6).toUpperCase()}`,
  text: `Payment of ${money(payment.amount)} via ${payment.method} received for booking ${shortId(
    booking?._id
  )}. Status: ${payment.status}.`,
  html: layout(
    'Payment Receipt',
    `<table style="width:100%;font-size:14px;">
       <tr><td style="padding:6px 0;">Payment ID</td><td style="text-align:right;">${payment._id}</td></tr>
       <tr><td style="padding:6px 0;">Booking</td><td style="text-align:right;">${shortId(booking?._id)}</td></tr>
       <tr><td style="padding:6px 0;">Amount paid</td><td style="text-align:right;">${money(payment.amount)}</td></tr>
       <tr><td style="padding:6px 0;">Method</td><td style="text-align:right;text-transform:capitalize;">${payment.method}</td></tr>
       <tr><td style="padding:6px 0;">Status</td><td style="text-align:right;text-transform:capitalize;">${payment.status}</td></tr>
     </table>`
  ),
});

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

const nodemailer = require('nodemailer');

let transporterPromise = null;

// Lazily build (and cache) a nodemailer transporter.
// - If SMTP_HOST is configured, use real SMTP (Mailtrap/Gmail/etc.).
// - Otherwise fall back to a JSON transport that "sends" to the console,
//   so development works offline without external credentials.
function getTransporter() {
  if (transporterPromise) return transporterPromise;

  transporterPromise = (async () => {
    if (process.env.SMTP_HOST) {
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
    }

    console.warn(
      'No SMTP_HOST configured - using JSON transport (emails logged, not delivered).'
    );
    return nodemailer.createTransport({ jsonTransport: true });
  })();

  return transporterPromise;
}

// Send an email. Resilient by design: never throws, so a failure here
// cannot break the main operation. Returns a result object instead.
async function sendEmail({ to, subject, html, text }) {
  try {
    const transporter = await getTransporter();
    const from = `"${process.env.FROM_NAME || 'RentGear'}" <${
      process.env.FROM_EMAIL || 'noreply@rentgear.com'
    }>`;

    const info = await transporter.sendMail({ from, to, subject, html, text });

    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) {
      console.log(`Email sent to ${to} - preview: ${preview}`);
    } else {
      console.log(`Email dispatched to ${to} (subject: "${subject}")`);
    }

    return { success: true, messageId: info.messageId, previewUrl: preview };
  } catch (err) {
    console.error(`Email send failed to ${to}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = { sendEmail, getTransporter };

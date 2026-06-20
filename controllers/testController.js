const { sendEmail } = require('../config/email');
const { welcomeEmail } = require('../utils/emailTemplates');

// @route  POST /api/test/email
// @desc   Send a test email to verify SMTP configuration (admin only)
// @access Private/Admin
exports.sendTestEmail = async (req, res, next) => {
  try {
    const to = req.body.to || req.user.email;

    const result = await sendEmail({
      to,
      ...welcomeEmail({ name: req.user.name || 'Admin' }),
    });

    if (!result.success) {
      return res.status(502).json({
        success: false,
        message: 'Email send failed',
        error: result.error,
      });
    }

    return res.json({
      success: true,
      message: `Test email sent to ${to}`,
      previewUrl: result.previewUrl || null,
    });
  } catch (error) {
    next(error);
  }
};

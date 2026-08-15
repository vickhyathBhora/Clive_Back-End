const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Send OTP via Email
 */
async function sendOtpEmail(toEmail, otp) {
  const mailOptions = {
    from: `"CLive Support" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Your CLive Verification Code',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
        <h2>Verify Your Email</h2>
        <p>Your One-Time Password (OTP) for registering on CLive is:</p>
        <h1 style="color: #1976d2; letter-spacing: 4px;">${otp}</h1>
        <p>This code expires in <strong>5 minutes</strong>.</p>
        <p>If you did not request this, please ignore this email.</p>
      </div>
    `,
  };

  return await transporter.sendMail(mailOptions);
}

module.exports = { sendOtpEmail };
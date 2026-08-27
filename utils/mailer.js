const nodemailer = require('nodemailer');
require('dotenv').config();

// Safely clean any whitespace from the app password
const cleanEmailPass = (process.env.EMAIL_PASS || '').replace(/\s+/g, '');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // true for port 465 (SSL)
  auth: {
    user: process.env.EMAIL_USER,
    pass: cleanEmailPass,
  },
  connectionTimeout: 10000, // 10 seconds timeout limit
  greetingTimeout: 5000,
  socketTimeout: 10000,
});

module.exports = { transporter };
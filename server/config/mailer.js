// server/config/mailer.js
require('./env');
const nodemailer = require('nodemailer');

if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
  console.warn('[MAILER WARNING] EMAIL_USER and EMAIL_PASS must be configured to send verification codes.');
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  ...(process.env.EMAIL_USER && process.env.EMAIL_PASS
    ? { auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } }
    : {})
});

// Verify SMTP connection on startup
transporter.verify((error) => {
  if (error) {
    console.error('[MAILER ERROR] Transporter connection failed:', error.message);
  } else {
    console.log('[MAILER SUCCESS] Nodemailer is ready to send emails.');
  }
});

module.exports = transporter;

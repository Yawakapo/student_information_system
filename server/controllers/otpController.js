const crypto = require('crypto');
const transporter = require('../config/mailer');
const db = require('../config/db');
const { hashPassword } = require('../utils/password');

const text = (value) => String(value ?? '').trim();
const lower = (value) => text(value).toLowerCase();
const attempts = new Map();
const allowAttempt = (req, identifier, limit = 5, windowMs = 15 * 60 * 1000) => {
  const key = `${req.ip}:${lower(identifier)}`;
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    attempts.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
};


const findAccount = async (identifier) => {
  const value = lower(identifier);
  if (!value) return null;
  const [rows] = await db.execute(`
    SELECT u.id, u.user_id, u.email, u.role, u.reset_otp, u.reset_otp_expires,
      t.teacher_id
    FROM users u
    LEFT JOIN teachers t ON t.user_account_id = u.id
    WHERE LOWER(TRIM(u.email)) = ?
       OR LOWER(TRIM(u.user_id)) = ?
       OR LOWER(TRIM(COALESCE(u.admin_id, ''))) = ?
       OR LOWER(TRIM(COALESCE(t.teacher_id, ''))) = ?
       OR LOWER(TRIM(CAST(u.id AS CHAR))) = ?
    LIMIT 1
  `, [value, value, value, value, value]);
  return rows[0] || null;
};

const saveOtp = async (account, code, expiresAt) => {
  const [result] = await db.execute(`
    UPDATE users
    SET reset_otp = ?, reset_otp_expires = ?
    WHERE id = ?
  `, [code, expiresAt, account.id]);
  if (!result.affectedRows) throw new Error('Unable to save password-reset code.');

  // Keep the teacher record in sync for legacy consumers. Passwords remain in users.
  await db.execute(`
    UPDATE teachers
    SET reset_otp = ?, reset_otp_expires = ?
    WHERE user_account_id = ?
  `, [code, expiresAt, account.id]).catch(() => {});
};


const sendMail = (options) => new Promise((resolve, reject) => {
  transporter.sendMail(options, (error, info) => {
    if (error) return reject(error);
    resolve(info);
  });
});

/* Sending the code by email is the normal path. When the machine has no
   connection the message cannot leave it, so rather than fail the whole reset
   and lock the account out, the code is handed straight back to the page and
   written to the server console.

   NOTE FOR THE DEFENCE: this is right for a system that runs on one machine
   with no internet, which is how this one is used. On a system reachable over
   a network it would be wrong, because anyone who asked for a reset could read
   another account's code out of the reply. A deployed system would show a
   "mail is unavailable" page instead and an administrator would issue the code
   by hand. */
const deliverCode = async (mailOptions, code) => {
  try {
    await sendMail(mailOptions);
    return { emailed: true };
  } catch (error) {
    console.warn('[MAILER] Could not send the code, no connection. Code shown on screen instead:', code);
    console.warn('[MAILER] Reason given:', error && error.message ? error.message : error);
    return { emailed: false };
  }
};

const generateAndSendOtp = async (req, res, successMessage) => {
  const identifier = text(req.body.email || req.body.user_id || req.body.userId);
  if (!identifier) {
    return res.status(400).json({
      status: 'error',
      success: false,
      message: 'Email or user ID is required to send a verification code.'
    });
  }
  if (!allowAttempt(req, identifier)) {
    return res.status(429).json({ status: 'error', success: false, message: 'Too many attempts. Please try again later.' });
  }

  try {
    const account = await findAccount(identifier);
    if (!account || !account.email) {
      return res.status(404).json({
        status: 'error',
        success: false,
        message: 'No account matching that email or user ID was found.'
      });
    }

    const otpCode = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await saveOtp(account, otpCode, expiresAt);

    const delivery = await deliverCode({
      from: process.env.EMAIL_USER,
      to: account.email,
      subject: 'Password Reset Verification Code',
      text: `Your 6-digit verification code is: ${otpCode}\n\nThis code expires in 10 minutes.`
    }, otpCode);

    if (delivery.emailed) {
      return res.status(200).json({
        status: 'success',
        success: true,
        message: successMessage || `OTP sent successfully to ${account.email}.`
      });
    }

    // No connection, so the code is shown on the page instead of emailed.
    console.log(`[OTP] Password reset code for ${account.email}: ${otpCode}`);
    return res.status(200).json({
      status: 'success',
      success: true,
      offline: true,
      code: otpCode,
      message: `This machine is offline, so the code was not emailed. Your code is: ${otpCode}`
    });
  } catch (error) {
    console.error('[OTP ERROR] Send OTP Failed:', error);
    return res.status(502).json({
      status: 'error',
      success: false,
      message: 'Unable to send the verification code. Please try again later.'
    });
  }
};

exports.sendOtp = (req, res) => generateAndSendOtp(req, res, 'Verification code sent to your email.');
exports.sendOTP = exports.sendOtp;
exports.resendOtp = (req, res) => generateAndSendOtp(req, res, 'A new verification code has been sent to your email.');

exports.verifyOtp = async (req, res) => {
  const identifier = text(req.body.email || req.body.user_id || req.body.userId);
  const inputCode = text(req.body.code || req.body.otp || req.body.verificationCode);

  if (!identifier || !inputCode) {
    return res.status(400).json({ status: 'error', success: false, message: 'Email/user ID and verification code are required.' });
  }
  if (!allowAttempt(req, identifier)) {
    return res.status(429).json({ status: 'error', success: false, message: 'Too many attempts. Please try again later.' });
  }

  try {
    const account = await findAccount(identifier);
    if (!account) return res.status(404).json({ status: 'error', success: false, message: 'Account not found.' });
    if (!account.reset_otp || String(account.reset_otp) !== inputCode) {
      return res.status(400).json({ status: 'error', success: false, message: 'Invalid verification code.' });
    }
    if (account.reset_otp_expires && new Date(account.reset_otp_expires).getTime() < Date.now()) {
      return res.status(400).json({ status: 'error', success: false, message: 'Verification code has expired.' });
    }
    return res.status(200).json({ status: 'success', success: true, message: 'OTP verified successfully!' });
  } catch (error) {
    console.error('[OTP VERIFY ERROR]:', error);
    return res.status(500).json({ status: 'error', success: false, message: 'Failed to verify code.' });
  }
};
exports.verifyOTP = exports.verifyOtp;

exports.resetPassword = async (req, res) => {
  const identifier = text(req.body.email || req.body.user_id || req.body.userId);
  const inputCode = text(req.body.code || req.body.otp || req.body.verificationCode);
  const newPassword = text(req.body.newPassword || req.body.password || req.body.new_password);

  if (!identifier || !inputCode || !newPassword) {
    return res.status(400).json({
      status: 'error',
      success: false,
      message: 'Account identifier, verification code, and new password are required.'
    });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ status: 'error', success: false, message: 'Password must be at least 8 characters long.' });
  }
  if (!allowAttempt(req, identifier)) {
    return res.status(429).json({ status: 'error', success: false, message: 'Too many attempts. Please try again later.' });
  }

  try {
    const account = await findAccount(identifier);
    if (!account) return res.status(404).json({ status: 'error', success: false, message: 'Account not found.' });
    if (!account.reset_otp || String(account.reset_otp) !== inputCode) {
      return res.status(400).json({ status: 'error', success: false, message: 'Invalid verification code.' });
    }
    if (account.reset_otp_expires && new Date(account.reset_otp_expires).getTime() < Date.now()) {
      return res.status(400).json({ status: 'error', success: false, message: 'Verification code has expired.' });
    }

    const passwordHash = await hashPassword(newPassword);
    const [result] = await db.execute(`
      UPDATE users
      SET password = ?, reset_otp = NULL, reset_otp_expires = NULL, is_default_password = 0
      WHERE id = ? AND reset_otp = ? AND reset_otp_expires > NOW()
    `, [passwordHash, account.id, inputCode]);

    if (!result.affectedRows) {
      return res.status(400).json({ status: 'error', success: false, message: 'Verification code is invalid or has expired.' });
    }

    await db.execute(`
      UPDATE teachers
      SET reset_otp = NULL, reset_otp_expires = NULL
      WHERE user_account_id = ?
    `, [account.id]).catch(() => {});

    return res.status(200).json({ status: 'success', success: true, message: 'Password updated successfully!' });
  } catch (error) {
    console.error('[PASSWORD RESET ERROR]:', error);
    return res.status(500).json({ status: 'error', success: false, message: 'Database error updating password.' });
  }
};

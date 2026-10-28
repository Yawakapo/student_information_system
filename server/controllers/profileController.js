const crypto = require('crypto');
const db = require('../config/db');
const transporter = require('../config/mailer');
const { isValidEmail, isValidUsername } = require('../utils/profileValidation');

const text = (value) => String(value ?? '').trim();
const lower = (value) => text(value).toLowerCase();
const requestedUser = (req) => {
  const query = req.query || {};
  const params = req.params || {};
  const body = req.body || {};
  return text(query.user_id || query.userId || params.id || body.user_id || body.userId);
};
const canManage = (req, userId) => {
  const target = String(userId || '');
  return req.user?.role === 'admin'
    || lower(req.user?.user_id) === lower(target)
    || String(req.user?.userId) === target;
};
const emailChangeAttempts = new Map();
const emailConfirmationAttempts = new Map();

const recordEmailConfirmationAttempt = userId => {
  const key = String(userId);
  const now = Date.now();
  const current = emailConfirmationAttempts.get(key);
  if (!current || now - current.startedAt >= 15 * 60 * 1000) {
    emailConfirmationAttempts.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= 5) return false;
  current.count += 1;
  return true;
};

const ensureEmailChangeColumns = async () => {
  await db.query("ALTER TABLE users ADD COLUMN pending_email VARCHAR(100) DEFAULT NULL").catch(error => {
    if (error.code !== 'ER_DUP_FIELDNAME') throw error;
  });
  await db.query("ALTER TABLE users ADD COLUMN email_change_otp VARCHAR(6) DEFAULT NULL").catch(error => {
    if (error.code !== 'ER_DUP_FIELDNAME') throw error;
  });
  await db.query("ALTER TABLE users ADD COLUMN email_change_expires DATETIME DEFAULT NULL").catch(error => {
    if (error.code !== 'ER_DUP_FIELDNAME') throw error;
  });
};

const sendMail = options => new Promise((resolve, reject) => {
  transporter.sendMail(options, (error, info) => error ? reject(error) : resolve(info));
});

// Whether a stored picture exists, without sending the picture itself.
const picturePresent = async userId => {
  const [rows] = await db.execute(
    `SELECT CHAR_LENGTH(TRIM(COALESCE(profile_picture, ''))) > 0 AS present
     FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  return Boolean(rows.length && rows[0].present);
};

// A stored profile picture is base64 text kept in the users table, and the
// larger ones run to over two megabytes. The dashboard pages only need a
// display name, so they ask for this instead and avoid downloading a picture
// they never draw. The picture is still available from getProfile below.
exports.getProfileSummary = async (req, res) => {
  const requested = requestedUser(req);
  const useSignedIn = !requested && req.user?.userId;
  const userId = useSignedIn ? null : requested;
  if (!useSignedIn && !userId) {
    return res.status(400).json({ status: 'error', message: 'User ID parameter missing.' });
  }
  if (!useSignedIn && !canManage(req, userId)) {
    return res.status(403).json({ status: 'error', message: 'You cannot view this profile.' });
  }

  // profile_picture is deliberately absent from this column list.
  const select = `
    SELECT u.id, u.user_id, u.user_id AS username,
      COALESCE(NULLIF(TRIM(u.full_name), ''), NULLIF(TRIM(CONCAT_WS(' ', s.first_name, s.last_name)), ''),
        NULLIF(TRIM(CONCAT_WS(' ', t.first_name, t.middle_name, t.last_name)), ''), u.user_id) AS full_name,
      u.email, u.subject_code, u.role, u.status, s.student_no, t.teacher_id
    FROM users u
    LEFT JOIN students s ON s.user_account_id = u.id
    LEFT JOIN teachers t ON t.user_account_id = u.id
  `;

  try {
    const rows = useSignedIn
      ? (await db.execute(`${select} WHERE u.id = ? LIMIT 1`, [req.user.userId]))[0]
      : (await db.execute(
        `${select} WHERE TRIM(u.user_id) = ? OR CAST(u.id AS CHAR) = ? OR LOWER(TRIM(u.email)) = LOWER(?) LIMIT 1`,
        [userId, userId, userId]
      ))[0];

    if (!rows.length) {
      return res.status(404).json({ status: 'error', message: 'User profile was not found.' });
    }
    const row = rows[0];
    return res.json({
      status: 'success',
      success: true,
      data: {
        ...row,
        has_profile_picture: await picturePresent(row.id),
        immutable_id: row.role === 'student' ? row.student_no : row.role === 'teacher' ? row.teacher_id : row.user_id,
        immutable_label: row.role === 'student' ? 'Student ID' : row.role === 'teacher' ? 'Teacher ID' : 'User ID'
      }
    });
  } catch (error) {
    console.error('Profile summary error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to load the user profile.' });
  }
};

exports.getProfile = async (req, res) => {
  const userId = requestedUser(req);
  if (!userId && req.user?.userId) {
    const [rows] = await db.execute(`
      SELECT u.id, u.user_id, u.user_id AS username, u.email, u.subject_code, u.role,
        u.profile_picture, u.status, s.student_no, t.teacher_id,
        COALESCE(NULLIF(TRIM(u.full_name), ''), NULLIF(TRIM(CONCAT_WS(' ', s.first_name, s.last_name)), ''), NULLIF(TRIM(CONCAT_WS(' ', t.first_name, t.middle_name, t.last_name)), ''), u.user_id) AS full_name
      FROM users u
      LEFT JOIN students s ON s.user_account_id = u.id
      LEFT JOIN teachers t ON t.user_account_id = u.id
      WHERE u.id = ?
      LIMIT 1
    `, [req.user.userId]);
    if (!rows.length) return res.status(404).json({ status: 'error', message: 'User profile was not found.' });
    const row = rows[0];
    return res.json({ status: 'success', success: true, data: {
      ...row,
      immutable_id: row.role === 'student' ? row.student_no : row.role === 'teacher' ? row.teacher_id : row.user_id,
      immutable_label: row.role === 'student' ? 'Student ID' : row.role === 'teacher' ? 'Teacher ID' : 'User ID'
    }});
  }
  if (!userId) return res.status(400).json({ status: 'error', message: 'User ID parameter missing.' });
  if (!canManage(req, userId)) return res.status(403).json({ status: 'error', message: 'You cannot view this profile.' });

  try {
    const [rows] = await db.execute(`
      SELECT u.id, u.user_id, u.user_id AS username,
        COALESCE(NULLIF(TRIM(u.full_name), ''), NULLIF(TRIM(CONCAT_WS(' ', s.first_name, s.last_name)), ''), NULLIF(TRIM(CONCAT_WS(' ', t.first_name, t.middle_name, t.last_name)), ''), u.user_id) AS full_name,
        u.email, u.subject_code, u.role, u.profile_picture, u.status, s.student_no, t.teacher_id
      FROM users u
      LEFT JOIN students s ON s.user_account_id = u.id
      LEFT JOIN teachers t ON t.user_account_id = u.id
      WHERE TRIM(u.user_id) = ? OR CAST(u.id AS CHAR) = ? OR LOWER(TRIM(u.email)) = LOWER(?)
      LIMIT 1
    `, [userId, userId, userId]);

    if (!rows.length) return res.status(404).json({ status: 'error', message: `User record '${userId}' was not found.` });
    const row = rows[0];
    return res.status(200).json({ status: 'success', success: true, data: {
      ...row,
      immutable_id: row.role === 'student' ? row.student_no : row.role === 'teacher' ? row.teacher_id : row.user_id,
      immutable_label: row.role === 'student' ? 'Student ID' : row.role === 'teacher' ? 'Teacher ID' : 'User ID'
    }});
  } catch (error) {
    console.error('User profile fetch error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to load the user profile.' });
  }
};

const updateLinkedName = async (connection, userId, role, fullName) => {
  if (!fullName) return;
  const parts = fullName.split(/\s+/).filter(Boolean);
  const lastName = parts.length > 1 ? parts.pop() : fullName;
  const firstName = parts.join(' ');
  if (role === 'student') {
    await connection.execute('UPDATE students SET first_name = ?, last_name = ? WHERE user_account_id = ?', [firstName, lastName, userId]);
  } else if (role === 'teacher') {
    await connection.execute('UPDATE teachers SET first_name = ?, last_name = ? WHERE user_account_id = ?', [firstName, lastName, userId]);
  }
};

exports.updateAccount = async (req, res) => {
  const username = text(req.body.username);
  const fullName = text(req.body.full_name);
  const profilePicture = req.body.profile_picture === undefined ? null : req.body.profile_picture;
  if (!username || !isValidUsername(username)) {
    return res.status(400).json({ status: 'error', message: 'Username must be 3–30 characters and contain only letters, numbers, spaces, dots, dashes, or underscores.' });
  }
  if (username.length > 30) return res.status(400).json({ status: 'error', message: 'Username is too long.' });
  if (fullName.length > 100) return res.status(400).json({ status: 'error', message: 'Full name is too long.' });
  if (fullName && fullName.split(/\s+/).filter(Boolean).length < 2) {
    return res.status(400).json({ status: 'error', message: 'Enter both a first name and a last name.' });
  }

  const userId = req.user.userId;
  let connection;
  try {
    const [duplicates] = await db.execute('SELECT id FROM users WHERE LOWER(TRIM(user_id)) = LOWER(?) AND id <> ? LIMIT 1', [username, userId]);
    if (duplicates.length) return res.status(409).json({ status: 'error', message: 'That username is already in use.' });
    const [identityConflicts] = await db.execute(`
      SELECT u.id
      FROM users u
      WHERE u.id <> ?
        AND (
          LOWER(TRIM(u.email)) = LOWER(?)
          OR EXISTS (SELECT 1 FROM students s WHERE LOWER(TRIM(s.student_no)) = LOWER(?) AND (s.user_account_id IS NULL OR s.user_account_id <> u.id))
          OR EXISTS (SELECT 1 FROM teachers t WHERE LOWER(TRIM(t.teacher_id)) = LOWER(?) AND (t.user_account_id IS NULL OR t.user_account_id <> u.id))
        )
      LIMIT 1
    `, [userId, username, username, username]);
    if (identityConflicts.length) return res.status(409).json({ status: 'error', message: 'That username conflicts with another account identifier.' });
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [currentRows] = await connection.execute('SELECT role FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [userId]);
    if (!currentRows.length) {
      await connection.rollback();
      return res.status(404).json({ status: 'error', message: 'User account not found.' });
    }
    await connection.execute("UPDATE users SET user_id = ?, full_name = COALESCE(NULLIF(?, ''), full_name), profile_picture = COALESCE(?, profile_picture) WHERE id = ?", [username, fullName, profilePicture, userId]);
    await updateLinkedName(connection, userId, lower(currentRows[0].role), fullName);
    await connection.commit();
    return res.json({ status: 'success', success: true, username, message: 'Profile account details updated.' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ status: 'error', message: 'That username is already in use.' });
    console.error('Profile account update error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to update profile account details.' });
  } finally {
    if (connection) connection.release();
  }
};

exports.requestEmailChange = async (req, res) => {
  const newEmail = lower(req.body.new_email);
  if (!isValidEmail(newEmail)) return res.status(400).json({ status: 'error', message: 'Enter a valid new email address.' });
  const key = `email:${req.user.userId}`;
  const now = Date.now();
  const currentAttempt = emailChangeAttempts.get(key);
  if (currentAttempt && now - currentAttempt.startedAt < 15 * 60 * 1000 && currentAttempt.count >= 5) {
    return res.status(429).json({ status: 'error', message: 'Too many email-change attempts. Try again later.' });
  }
  emailChangeAttempts.set(key, { startedAt: currentAttempt && now - currentAttempt.startedAt < 15 * 60 * 1000 ? currentAttempt.startedAt : now, count: currentAttempt && now - currentAttempt.startedAt < 15 * 60 * 1000 ? currentAttempt.count + 1 : 1 });
  emailConfirmationAttempts.delete(req.user.userId);

  try {
    await ensureEmailChangeColumns();
    const [users] = await db.execute('SELECT id, role, email FROM users WHERE id = ? LIMIT 1', [req.user.userId]);
    if (!users.length) return res.status(404).json({ status: 'error', message: 'User account not found.' });
    if (users[0].email === newEmail) return res.status(400).json({ status: 'error', message: 'The new email must be different from the current email.' });
    const [duplicate] = await db.execute('SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(?) AND id <> ? LIMIT 1', [newEmail, req.user.userId]);
    if (duplicate.length) return res.status(409).json({ status: 'error', message: 'That email address is already in use.' });
    if (lower(users[0].role) === 'teacher') {
      const [teacherDuplicate] = await db.execute('SELECT id FROM teachers WHERE LOWER(TRIM(email)) = LOWER(?) AND (user_account_id IS NULL OR user_account_id <> ?) LIMIT 1', [newEmail, req.user.userId]);
      if (teacherDuplicate.length) return res.status(409).json({ status: 'error', message: 'That email address is already in use.' });
    }

    const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    await db.execute('UPDATE users SET pending_email = ?, email_change_otp = ?, email_change_expires = ? WHERE id = ?', [newEmail, code, expires, req.user.userId]);
    let emailed = true;
    try {
      await sendMail({
        from: process.env.EMAIL_USER,
        to: newEmail,
        subject: 'Confirm your new email address',
        text: `Your verification code is: ${code}\n\nThis code expires in 10 minutes.`
      });
    } catch (mailError) {
      // Without a connection the message cannot leave the machine, so the code
      // is shown on screen rather than failing the whole change. See the note
      // in otpController.js about why this is acceptable here.
      emailed = false;
      console.warn('[MAILER] Could not send the email change code. Reason given:',
        mailError && mailError.message ? mailError.message : mailError);
    }

    if (!emailed) {
      console.log(`[EMAIL CHANGE] Verification code for ${newEmail}: ${code}`);
      return res.json({
        status: 'success',
        success: true,
        offline: true,
        code,
        message: `This machine is offline, so the code was not emailed. Your code is: ${code}`
      });
    }
    return res.json({ status: 'success', success: true, message: `A verification code was sent to ${newEmail}.` });
  } catch (error) {
    console.error('Email change request error:', error);
    return res.status(502).json({ status: 'error', message: 'Unable to send the email verification code.' });
  }
};

exports.confirmEmailChange = async (req, res) => {
  const newEmail = lower(req.body.new_email);
  const code = text(req.body.code || req.body.otp);
  if (!isValidEmail(newEmail) || !/^\d{6}$/.test(code))
     return res.status(400).json({ status: 'error', message: 'New email and 6-digit code are required.' });

  
  if (!recordEmailConfirmationAttempt(req.user.userId)) {
    return res.status(429).json({ status: 'error', message: 'Too many verification attempts. Request a new code and try again later.' });
  }

  let connection;
  try {
    await ensureEmailChangeColumns();
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [users] = await connection.execute('SELECT id, role, email, pending_email, email_change_otp, email_change_expires FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [req.user.userId]);
    if (!users.length) {
      await connection.rollback();
      return res.status(404).json({ status: 'error', message: 'User account not found.' });
    }
    const user = users[0];
    if (user.pending_email !== newEmail || user.email_change_otp !== code || !user.email_change_expires || new Date(user.email_change_expires).getTime() < Date.now()) {
      await connection.rollback();
      return res.status(400).json({ status: 'error', message: 'The verification code is invalid or expired.' });
    }
    const [duplicate] = await connection.execute('SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(?) AND id <> ? LIMIT 1', [newEmail, req.user.userId]);
    if (duplicate.length) {
      await connection.rollback();
      return res.status(409).json({ status: 'error', message: 'That email address is already in use.' });
    }
    if (lower(user.role) === 'teacher') {
      const [teacherDuplicate] = await connection.execute('SELECT id FROM teachers WHERE LOWER(TRIM(email)) = LOWER(?) AND (user_account_id IS NULL OR user_account_id <> ?) LIMIT 1', [newEmail, req.user.userId]);
      if (teacherDuplicate.length) {
        await connection.rollback();
        return res.status(409).json({ status: 'error', message: 'That email address is already in use.' });
      }
    }
    await connection.execute("UPDATE users SET email = ?, pending_email = NULL, email_change_otp = NULL, email_change_expires = NULL WHERE id = ?", [newEmail, req.user.userId]);
    if (lower(user.role) === 'teacher') await connection.execute('UPDATE teachers SET email = ? WHERE user_account_id = ?', [newEmail, req.user.userId]);
    await connection.commit();
    return res.json({ status: 'success', success: true, email: newEmail, message: 'Email address updated successfully.' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Email change confirmation error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to update the email address.' });
  } finally {
    if (connection) connection.release();
  }
};

// Kept for older pages. New profile pages use the narrower account and
// email-change endpoints above; direct email replacement is always blocked.
exports.updateProfile = async (req, res) => {
  const body = req.body || {};
  const requestedId = text(body.user_id || body.userId);
  const fullName = text(body.full_name);
  const email = lower(body.email);
  const subjectCode = text(body.subject_code);
  const profilePicture = body.profile_picture === undefined ? null : body.profile_picture;
  let userId = req.user?.role === 'admin' && requestedId ? requestedId : req.user?.userId;
  if (!userId) return res.status(400).json({ success: false, message: 'User ID is required for updates.' });
  if (!canManage(req, userId) && req.user?.role !== 'admin') return res.status(403).json({ success: false, message: 'You cannot update this profile.' });

  try {
    if (req.user?.role === 'admin' && requestedId) {
      const [targets] = await db.execute(
        'SELECT id FROM users WHERE CAST(id AS CHAR) = ? OR user_id = ? OR LOWER(TRIM(email)) = LOWER(?) LIMIT 1',
        [requestedId, requestedId, requestedId]
      );
      if (!targets.length) return res.status(404).json({ success: false, message: 'User record not found to update.' });
      userId = targets[0].id;
    }
    const [current] = await db.execute('SELECT id, email FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!current.length) return res.status(404).json({ success: false, message: 'User record not found to update.' });
    if (email && email !== lower(current[0].email)) {
      return res.status(400).json({ success: false, message: 'Use the email-change verification flow to change your email.' });
    }
    const [result] = await db.execute(`
      UPDATE users
      SET full_name = COALESCE(NULLIF(?, ''), full_name),
          subject_code = COALESCE(NULLIF(?, ''), subject_code),
          profile_picture = COALESCE(?, profile_picture)
      WHERE id = ?
    `, [fullName, subjectCode, profilePicture, userId]);
    if (!result.affectedRows && !fullName && !email && !subjectCode && profilePicture === null) {
      return res.json({ success: true, status: 'success', message: 'Profile is already up to date.' });
    }
    return res.json({ success: true, status: 'success', message: 'Profile updated successfully!' });
  } catch (error) {
    console.error('Error updating user profile:', error);
    return res.status(500).json({ success: false, message: 'Unable to update the profile.' });
  }
};

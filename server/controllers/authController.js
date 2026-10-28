// Sign-in, sign-out, session checks, and account verification.
// Admin account management lives in accountController.js.
const db = require('../config/db');
const { clearSessionCookie, setSessionCookie, signToken } = require('../middleware/auth');
const { hashPassword, needsPasswordRehash, verifyPassword } = require('../utils/password');
const { isBSITCourse } = require('../config/scope');
const { studentHasClassList } = require('../utils/studentAccess');

const text = (value) => String(value ?? '').trim();
const lower = (value) => text(value).toLowerCase();
const allowedRoles = new Set(['admin', 'teacher', 'student']);

const LOGIN_LIMIT = Number(process.env.LOGIN_ATTEMPT_LIMIT) || 5;
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_ATTEMPT_WINDOW_MS) || 15 * 60 * 1000;
const loginAttempts = new Map();

const loginAttemptKey = (req, userId) => `${req.ip}:${lower(userId)}`;

// Drops expired buckets so the map cannot grow without bound.
const pruneLoginAttempts = (now) => {
  for (const [key, bucket] of loginAttempts) {
    if (now - bucket.startedAt >= LOGIN_WINDOW_MS) loginAttempts.delete(key);
  }
};

// Returns 0 when the caller may still try, otherwise the whole number of
// minutes left in the current window.
const isLoginBlocked = (req, userId) => {
  const now = Date.now();
  pruneLoginAttempts(now);
  const bucket = loginAttempts.get(loginAttemptKey(req, userId));
  if (!bucket || bucket.count < LOGIN_LIMIT) return 0;
  return Math.max(1, Math.ceil((LOGIN_WINDOW_MS - (now - bucket.startedAt)) / 60000));
};

const recordLoginFailure = (req, userId) => {
  const key = loginAttemptKey(req, userId);
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || now - current.startedAt >= LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { startedAt: now, count: 1 });
    return;
  }
  current.count += 1;
};

const clearLoginFailures = (req, userId) => {
  loginAttempts.delete(loginAttemptKey(req, userId));
};


const sessionForUser = (user) => signToken({
  userId: user.id,
  user_id: user.user_id,
  role: lower(user.role)
});


exports.checkSession = (req, res) => {
  if (!req.user) {
    return res.status(401).json({ status: 'error', authenticated: false, message: 'Authentication required.' });
  }
  return res.json({
    status: 'success',
    authenticated: true,
    user: {
      id: req.user.userId,
      user_id: req.user.user_id,
      role: req.user.role
    }
  });
};


exports.logout = (_req, res) => {
  clearSessionCookie(res);
  return res.json({ status: 'success', message: 'Logged out.' });
};


exports.login = async (req, res) => {
  const userId = text(req.body.user_id);
  const password = text(req.body.password);
  const selectedRole = lower(req.body.role);

  if (!userId || !password) {
    return res.status(400).json({ status: 'error', message: 'User ID and Password are required.' });
  }
  if (selectedRole && !allowedRoles.has(selectedRole)) {
    return res.status(400).json({ status: 'error', message: 'Invalid account type.' });
  }

  const roleClause = selectedRole ? 'AND LOWER(TRIM(u.role)) = ?' : '';

  // Throttle before touching the database so a blocked caller costs nothing.
  const blockedFor = isLoginBlocked(req, userId);
  if (blockedFor) {
    return res.status(429).json({
      status: 'error',
      success: false,
      message: `Too many failed login attempts. Try again in ${blockedFor} minute${blockedFor === 1 ? '' : 's'}.`
    });
  }

  const loginQuery = selectedRole === 'student'
    ? `SELECT DISTINCT u.*, s.student_no, link.class_list_schedule_id
       FROM users u
       LEFT JOIN students s ON s.user_account_id = u.id
       LEFT JOIN class_list_students link ON link.student_id = s.id
       WHERE (TRIM(u.user_id) = ? OR TRIM(s.student_no) = ? OR TRIM(u.full_name) = ?)
       ${roleClause}`
    : selectedRole === 'teacher'
      ? `SELECT DISTINCT u.*
         FROM users u
         LEFT JOIN teachers t ON t.user_account_id = u.id
         WHERE (TRIM(u.user_id) = ? OR TRIM(t.teacher_id) = ?)
         ${roleClause}`
      : selectedRole === 'admin'
        ? `SELECT u.* FROM users u
           WHERE (TRIM(u.user_id) = ? OR TRIM(COALESCE(u.admin_id, '')) = ?)
           ${roleClause}`
        : `SELECT u.* FROM users u WHERE TRIM(u.user_id) = ? ${roleClause}`;

  const params = selectedRole === 'student'
    ? [userId, userId, userId, ...(selectedRole ? [selectedRole] : [])]
    : selectedRole === 'teacher'
      ? [userId, userId, ...(selectedRole ? [selectedRole] : [])]
      : selectedRole === 'admin'
        ? [userId, userId, ...(selectedRole ? [selectedRole] : [])]
        : [userId, ...(selectedRole ? [selectedRole] : [])];

  try {
    const [rows] = await db.execute(loginQuery, params);
    if (rows.length === 0) {
      recordLoginFailure(req, userId);
      return res.status(401).json({ status: 'error', success: false, message: 'User not found.' });
    }

    const user = rows[0];
    if (selectedRole && lower(user.role) !== selectedRole) {
      recordLoginFailure(req, userId);
      return res.status(401).json({ status: 'error', success: false, message: 'The selected role does not match this account.' });
    }
    if (lower(user.status || 'active') !== 'active') {
      return res.status(403).json({ status: 'error', success: false, message: 'This account is inactive.' });
    }

    const approvalStatus = lower(user.approval_status || 'accepted');
    if (approvalStatus === 'pending') {
      return res.status(403).json({
        status: 'error',
        success: false,
        approval_status: 'pending',
        message: 'Your account is pending teacher approval.'
      });
    }
    if (approvalStatus === 'rejected') {
      return res.status(403).json({
        status: 'error',
        success: false,
        approval_status: 'rejected',
        message: 'Your account registration was rejected.'
      });
    }

    const registrationRequired = selectedRole === 'student' && !user.student_no;

    if (!(await verifyPassword(user.password, password))) {
      recordLoginFailure(req, userId);
      return res.status(401).json({ status: 'error', success: false, message: 'Incorrect password.' });
    }

    // A correct password clears the counter so a genuine user who fumbled a
    // few times is not locked out.
    clearLoginFailures(req, userId);

    if (lower(user.role) === 'student') {
      const [studentRows] = await db.execute('SELECT id, course FROM students WHERE user_account_id = ? LIMIT 1', [user.id]);
      if (!studentRows.length || !isBSITCourse(studentRows[0].course) || !(await studentHasClassList(db, studentRows[0].id))) {
        return res.status(403).json({
          status: 'error',
          success: false,
          message: 'Student access is unavailable until the student is assigned to a class list.'
        });
      }
    }

    // Upgrade legacy plaintext passwords after a successful login.
    if (needsPasswordRehash(user.password)) {
      const upgradedHash = await hashPassword(password);
      await db.execute('UPDATE users SET password = ? WHERE id = ?', [upgradedHash, user.id]);
    }

    const token = sessionForUser(user);
    setSessionCookie(res, token);
    return res.status(200).json({
      status: 'success',
      success: true,
      message: 'Login successful!',
      token,
      user_id: user.user_id,
      student_number: user.student_no || null,
      registration_required: registrationRequired,
      role: lower(user.role)
    });
  } catch (err) {
    console.error('Database Login Error:', err);
    return res.status(500).json({ status: 'error', message: 'Database query error during login.' });
  }
};


exports.verifyAccount = async (req, res) => {
  const role = lower(req.body.role);
  const userId = lower(req.body.userId || req.body.user_id);
  const email = lower(req.body.email);

  if (!role || !userId || !email || !allowedRoles.has(role)) {
    return res.status(400).json({ status: 'error', message: 'Role, user ID, and email are required.' });
  }

  const query = `
    SELECT u.id, u.user_id, u.email, u.role, u.approval_status
    FROM users u
    LEFT JOIN students s ON s.user_account_id = u.id
    LEFT JOIN teachers t ON t.user_account_id = u.id
    WHERE LOWER(TRIM(u.email)) = ?
      AND LOWER(TRIM(u.role)) = ?
      AND (
        LOWER(TRIM(u.user_id)) = ?
        OR LOWER(TRIM(COALESCE(u.admin_id, ''))) = ?
        OR LOWER(TRIM(COALESCE(u.full_name, ''))) = ?
        OR LOWER(TRIM(COALESCE(s.student_no, ''))) = ?
        OR LOWER(TRIM(COALESCE(t.teacher_id, ''))) = ?
      )
    LIMIT 1
  `;

  try {
    const [results] = await db.execute(query, [email, role, userId, userId, userId, userId, userId]);
    if (results.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Account verification failed.' });
    }
    const user = results[0];
    return res.status(200).json({
      status: 'success',
      message: 'Account verified successfully!',
      data: { userId: user.user_id, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('[DB ERROR] Verification failed:', err);
    return res.status(500).json({ status: 'error', message: 'Database error during verification.' });
  }
};

// Admin account management: create, list, edit, and delete user accounts.
// Sign-in and session handling live in authController.js.
const db = require('../config/db');
const { hashPassword } = require('../utils/password');
const { isValidEmail } = require('../utils/profileValidation');
const { BSIT_DEPARTMENT, isBSITCourse } = require('../config/scope');
const { studentHasClassList } = require('../utils/studentAccess');

const text = (value) => String(value ?? '').trim();
const lower = (value) => text(value).toLowerCase();
const allowedRoles = new Set(['admin', 'teacher', 'student']);

// Reads one user before a transaction is opened, so the caller can refuse
// early without holding a database connection.
const connectionlessUserLookup = async (userId) => db.execute(
  'SELECT id, role, user_id, email, status FROM users WHERE id = ? LIMIT 1',
  [userId]
);

exports.createManagedAccount = async (req, res) => {
  const accountNumber = text(req.body.account_number);
  const username = text(req.body.username);
  const email = lower(req.body.email);
  const password = text(req.body.password);
  const role = lower(req.body.role);
  const fullName = text(req.body.full_name || req.body.teacher_full_name);
  const department = BSIT_DEPARTMENT;

  if (!username || !email || !password || !['student', 'teacher', 'admin'].includes(role)) {
    return res.status(400).json({ status: 'error', message: 'Username, email address, password, and account type are required.' });
  }
  if (role !== 'admin' && !accountNumber) {
    return res.status(400).json({ status: 'error', message: 'A student number or teacher number is required for this account type.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters long.' });
  }
  if (role !== 'student' && !fullName) {
    const article = role === 'admin' ? 'an' : 'a';
    return res.status(400).json({ status: 'error', message: `Full name is required for ${article} ${role} account.` });
  }

  let connection;
  try {
    const passwordHash = await hashPassword(password);
    connection = await db.getConnection();
    await connection.beginTransaction();

    let studentRecord = null;
    if (role === 'student') {
      const [eligibleStudents] = await connection.query(`
        SELECT s.id, s.first_name, s.last_name, s.user_account_id
        FROM students s
        INNER JOIN class_list_students link ON link.student_id = s.id
        INNER JOIN class_list_schedules cls ON cls.id = link.class_list_schedule_id
        WHERE LOWER(TRIM(s.student_no)) = LOWER(TRIM(?))
          AND LOWER(COALESCE(s.status, 'active')) = 'active'
          AND LOWER(REPLACE(REPLACE(TRIM(s.course), ' ', ''), '-', '')) LIKE 'bsit%'
        LIMIT 1
        FOR UPDATE
      `, [accountNumber]);

      if (eligibleStudents.length === 0) {
        await connection.rollback();
        return res.status(409).json({
          status: 'error',
          message: 'This student is not assigned to a class list. Add the student to a class list before creating an account.'
        });
      }
      if (eligibleStudents[0].user_account_id) {
        await connection.rollback();
        return res.status(409).json({
          status: 'error',
          message: 'This student already has a user account.'
        });
      }
      studentRecord = eligibleStudents[0];
    }

    const resolvedName = role === 'student'
      ? (studentRecord ? `${studentRecord.first_name || ''} ${studentRecord.last_name || ''}`.trim() || accountNumber : accountNumber)
      : fullName;

    const [result] = await connection.query(
      'INSERT INTO users (user_id, password, email, role, approval_status, full_name, admin_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [username, passwordHash, email, role, 'accepted', resolvedName, role === 'admin' ? (accountNumber || null) : null]
    );

    if (role === 'student') {
      const [studentUpdate] = await connection.query('UPDATE students SET user_account_id = ? WHERE id = ?', [result.insertId, studentRecord.id]);
      if (!studentUpdate.affectedRows) throw new Error('Student record could not be linked to the new account.');
    } else if (role === 'teacher') {
      const nameParts = fullName.split(/\s+/).filter(Boolean);
      const lastName = nameParts.length > 1 ? nameParts.pop() : fullName;
      const firstName = nameParts.join(' ');
      await connection.query(
        'INSERT INTO teachers (user_account_id, teacher_id, first_name, last_name, email, department, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [result.insertId, accountNumber, firstName, lastName, email, department, 'Active']
      );
    }

    await connection.commit();
    if (req.io) {
      req.io.emit('account_created', { user_id: username, role, user_id_value: result.insertId });
      if (role === 'student') req.io.emit('schedule_updated', { reason: 'student_account_created', student_id: studentRecord.id });
    }
    return res.status(201).json({ status: 'success', success: true, message: 'Account created successfully.' });
  } catch (err) {
    if (connection) await connection.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') {
      const duplicateField = lower(err.sqlMessage || '');
      const message = duplicateField.includes('email')
        ? 'That email address is already in use.'
        : duplicateField.includes('admin_id')
          ? 'That admin ID is already in use.'
          : duplicateField.includes('teacher_id')
            ? 'That teacher number is already in use.'
            : 'That username is already in use.';
      return res.status(409).json({ status: 'error', message });
    }
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(409).json({ status: 'error', message: 'The database schema is incomplete. Run the project migrations first.' });
    }
    console.error('Managed account creation error:', err);
    return res.status(500).json({ status: 'error', message: 'Unable to create the account.' });
  } finally {
    if (connection) connection.release();
  }
};


exports.getEligibleStudentAccounts = async (_req, res) => {
  try {
    const [students] = await db.query(`
      SELECT s.id, s.student_no, s.first_name, s.last_name, s.course, s.department,
        s.user_account_id, COUNT(DISTINCT cls.id) AS class_list_count
      FROM students s
      LEFT JOIN class_list_students link ON link.student_id = s.id
      LEFT JOIN class_list_schedules cls ON cls.id = link.class_list_schedule_id
      WHERE LOWER(COALESCE(s.status, 'active')) = 'active'
        AND LOWER(REPLACE(REPLACE(TRIM(s.course), ' ', ''), '-', '')) LIKE 'bsit%'
      GROUP BY s.id, s.student_no, s.first_name, s.last_name, s.course, s.department, s.user_account_id
      ORDER BY s.last_name, s.first_name, s.student_no
    `);

    return res.json(students.map(student => ({
      ...student,
      class_list_count: Number(student.class_list_count) || 0,
      has_account: Boolean(student.user_account_id),
      eligible: !student.user_account_id && Number(student.class_list_count) > 0
    })));
  } catch (err) {
    console.error('Fetch eligible student accounts error:', err);
    return res.status(500).json({ status: 'error', message: 'Unable to load student account options.' });
  }
};


exports.checkStudentAccountEligibility = async (req, res) => {
  const accountNumber = text(req.params.accountNumber);
  if (!accountNumber) return res.status(400).json({ status: 'error', message: 'Student number is required.' });

  try {
    const [rows] = await db.execute(`
      SELECT s.id, s.student_no, s.first_name, s.last_name, s.course, s.user_account_id,
        COUNT(DISTINCT cls.id) AS class_list_count
      FROM students s
      LEFT JOIN class_list_students link ON link.student_id = s.id
      LEFT JOIN class_list_schedules cls ON cls.id = link.class_list_schedule_id
      WHERE LOWER(TRIM(s.student_no)) = LOWER(TRIM(?))
        AND LOWER(COALESCE(s.status, 'active')) = 'active'
        AND LOWER(REPLACE(REPLACE(TRIM(s.course), ' ', ''), '-', '')) LIKE 'bsit%'
      GROUP BY s.id, s.student_no, s.first_name, s.last_name, s.course, s.user_account_id
      LIMIT 1
    `, [accountNumber]);

    if (!rows.length) {
      return res.json({
        success: true,
        found: false,
        eligible: false,
        message: 'Student number was not found. Add the student before creating an account.'
      });
    }

    const student = rows[0];
    const classListCount = Number(student.class_list_count) || 0;
    const hasAccount = Boolean(student.user_account_id);
    const eligible = !hasAccount && classListCount > 0;
    let message = 'Student is assigned to a class list and is eligible for an account.';
    if (!classListCount) message = 'This student is not assigned to a class list yet.';
    if (hasAccount) message = 'This student already has a user account.';

    return res.json({
      success: true,
      found: true,
      eligible,
      has_account: hasAccount,
      class_list_count: classListCount,
      student: {
        id: student.id,
        student_no: student.student_no,
        full_name: `${student.first_name || ''} ${student.last_name || ''}`.trim(),
        course: student.course || ''
      },
      message
    });
  } catch (err) {
    console.error('Check student account eligibility error:', err);
    return res.status(500).json({ status: 'error', message: 'Unable to verify the student class-list assignment.' });
  }
};


exports.listManagedUsers = async (_req, res) => {
  try {
    const [users] = await db.query(`
      SELECT u.id, u.user_id, u.admin_id, u.email, u.role, u.status, u.approval_status, u.full_name, u.created_at
      FROM users u
      ORDER BY u.created_at DESC, u.id DESC
    `);
    const [studentRows] = await db.query(`
      SELECT s.user_account_id, s.id AS student_id, s.student_no, s.first_name, s.last_name,
        s.course, COUNT(DISTINCT cls.id) AS class_list_count
      FROM students s
      LEFT JOIN class_list_students link ON link.student_id = s.id
      LEFT JOIN class_list_schedules cls ON cls.id = link.class_list_schedule_id
      WHERE s.user_account_id IS NOT NULL
      GROUP BY s.user_account_id, s.id, s.student_no, s.first_name, s.last_name, s.course
    `);
    const [teacherRows] = await db.query(`
      SELECT t.user_account_id, t.teacher_id, t.first_name, t.last_name, t.department
      FROM teachers t
      WHERE t.user_account_id IS NOT NULL
    `);

    const studentByAccount = new Map(studentRows.map(student => [String(student.user_account_id), student]));
    const teacherByAccount = new Map(teacherRows.map(teacher => [String(teacher.user_account_id), teacher]));
    const managedUsers = users.filter(user => lower(user.role) !== 'student' || isBSITCourse(studentByAccount.get(String(user.id))?.course));
    return res.json(managedUsers.map(user => {
      const student = studentByAccount.get(String(user.id));
      const teacher = teacherByAccount.get(String(user.id));
      const fullName = text(user.full_name) || (student
        ? `${student.first_name || ''} ${student.last_name || ''}`.trim()
        : teacher
          ? `${teacher.first_name || ''} ${teacher.last_name || ''}`.trim()
          : user.user_id);
      return {
        id: user.id,
        user_id: user.user_id,
        full_name: fullName,
        email: user.email,
        role: lower(user.role),
        status: user.status || 'Active',
        approval_status: user.approval_status || 'accepted',
        created_at: user.created_at,
        account_number: student?.student_no || teacher?.teacher_id || text(user.admin_id) || user.user_id,
        student_no: student?.student_no || null,
        teacher_id: teacher?.teacher_id || null,
        course: student?.course || null,
        department: teacher?.department || null,
        class_list_count: Number(student?.class_list_count) || 0
      };
    }));
  } catch (err) {
    console.error('Fetch managed users error:', err);
    return res.status(500).json({ status: 'error', message: 'Unable to load managed users.' });
  }
};


exports.updateManagedUser = async (req, res) => {
  const userId = Number(req.params.id);
  const email = lower(req.body.email);
  const newPassword = text(req.body.newPassword || req.body.password);

  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ status: 'error', message: 'User account not found.' });
  }
  if (!email && !newPassword) {
    return res.status(400).json({ status: 'error', message: 'Enter an email address or a new password.' });
  }
  if (email && !isValidEmail(email)) {
    return res.status(400).json({ status: 'error', message: 'Enter a valid email address.' });
  }
  if (newPassword && newPassword.length < 8) {
    return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters long.' });
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [users] = await connection.execute(
      'SELECT id, email, role FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
      [userId]
    );
    if (!users.length) {
      await connection.rollback();
      return res.status(404).json({ status: 'error', message: 'User account not found.' });
    }

    if (email) {
      const [duplicate] = await connection.execute(
        'SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(?) AND id <> ? LIMIT 1',
        [email, userId]
      );
      if (duplicate.length) {
        await connection.rollback();
        return res.status(409).json({ status: 'error', message: 'That email address is already in use.' });
      }
    }

    const fields = [];
    const values = [];
    if (email) {
      fields.push('email = ?');
      values.push(email);
    }
    if (newPassword) {
      fields.push('password = ?', 'is_default_password = 0');
      values.push(await hashPassword(newPassword));
    }
    values.push(userId);
    await connection.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);

    if (email && lower(users[0].role) === 'teacher') {
      await connection.execute(
        'UPDATE teachers SET email = ? WHERE user_account_id = ?',
        [email, userId]
      );
    }

    await connection.commit();
    if (req.io) req.io.emit('managed_user_updated', { id: userId, emailChanged: Boolean(email), passwordChanged: Boolean(newPassword) });
    return res.json({
      status: 'success',
      success: true,
      message: newPassword && email
        ? 'Email address and password updated successfully.'
        : newPassword
          ? 'Password updated successfully.'
          : 'Email address updated successfully.'
    });
  } catch (err) {
    if (connection) await connection.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ status: 'error', message: 'That email address is already in use.' });
    }
    console.error('Update managed user error:', err);
    return res.status(500).json({ status: 'error', message: err.sqlMessage || 'Unable to update the user account.' });
  } finally {
    if (connection) connection.release();
  }
};


exports.updateManagedUserStatus = async (req, res) => {
  const userId = Number(req.params.id);
  const requestedStatus = lower(req.body.status);
  const status = requestedStatus === 'active' ? 'Active' : requestedStatus === 'inactive' ? 'Inactive' : '';
  if (!Number.isInteger(userId) || userId < 1 || !status) {
    return res.status(400).json({ status: 'error', message: 'Use Active or Inactive as the account status.' });
  }
  if (String(req.user.userId) === String(userId) && status === 'Inactive') {
    return res.status(400).json({ status: 'error', message: 'You cannot deactivate your own administrator account.' });
  }

  let connection;
  try {
    const [users] = await connectionlessUserLookup(userId);
    if (!users.length) return res.status(404).json({ status: 'error', message: 'User account not found.' });

    connection = await db.getConnection();
    await connection.beginTransaction();
    const [lockedUsers] = await connection.execute(
      'SELECT id, role, approval_status FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
      [userId]
    );
    if (!lockedUsers.length) {
      await connection.rollback();
      return res.status(404).json({ status: 'error', message: 'User account not found.' });
    }
    if (status === 'Active' && lower(lockedUsers[0].approval_status || 'accepted') !== 'accepted') {
      await connection.rollback();
      return res.status(409).json({ status: 'error', message: 'Approve this account before activating it.' });
    }
    if (status === 'Active' && lower(lockedUsers[0].role) === 'student') {
      const [studentRows] = await connection.execute('SELECT id, course FROM students WHERE user_account_id = ? LIMIT 1', [userId]);
      if (!studentRows.length || !isBSITCourse(studentRows[0].course) || !(await studentHasClassList(connection, studentRows[0].id))) {
        await connection.rollback();
        return res.status(409).json({ status: 'error', message: 'This student must be assigned to a class list before the account can be activated.' });
      }
    }
    await connection.execute('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
    if (lower(lockedUsers[0].role) === 'teacher') {
      await connection.execute('UPDATE teachers SET status = ? WHERE user_account_id = ?', [status, userId]);
    }
    await connection.commit();
    if (req.io) req.io.emit('managed_user_updated', { id: userId, status });
    return res.json({ status: 'success', success: true, message: `Account ${status === 'Active' ? 'activated' : 'deactivated'}.` });
  } catch (err) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Update managed user status error:', err);
    return res.status(500).json({ status: 'error', message: err.sqlMessage || 'Unable to update the account status.' });
  } finally {
    if (connection) connection.release();
  }
};


exports.deleteManagedUser = async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ status: 'error', message: 'User account not found.' });
  }
  if (String(req.user.userId) === String(userId)) {
    return res.status(400).json({ status: 'error', message: 'You cannot delete your own administrator account.' });
  }

  let connection;
  try {
    const [users] = await connectionlessUserLookup(userId);
    if (!users.length) return res.status(404).json({ status: 'error', message: 'User account not found.' });
    const role = lower(users[0].role);

    connection = await db.getConnection();
    await connection.beginTransaction();
    // Delete only the login account. Student records and class-list links
    // intentionally remain so the account can be recreated later.
    if (role === 'student') {
      await connection.execute('UPDATE students SET user_account_id = NULL WHERE user_account_id = ?', [userId]);
    } else if (role === 'teacher') {
      await connection.execute('UPDATE teachers SET user_account_id = NULL WHERE user_account_id = ?', [userId]);
    }
    await connection.execute('DELETE FROM users WHERE id = ?', [userId]);
    await connection.commit();
    if (req.io) req.io.emit('managed_user_deleted', { id: userId, recordDeleted: false });
    return res.json({
      status: 'success',
      success: true,
      message: role === 'student'
        ? 'Student account deleted. The student record and class-list assignments were kept.'
        : 'User account deleted.'
    });
  } catch (err) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Delete managed user account error:', err);
    return res.status(500).json({ status: 'error', message: err.sqlMessage || 'Unable to delete the account.' });
  } finally {
    if (connection) connection.release();
  }
};


exports.deleteManagedStudentRecord = async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ status: 'error', message: 'User account not found.' });
  }
  if (String(req.user.userId) === String(userId)) {
    return res.status(400).json({ status: 'error', message: 'You cannot delete your own administrator account.' });
  }

  let connection;
  try {
    const [users] = await connectionlessUserLookup(userId);
    if (!users.length) return res.status(404).json({ status: 'error', message: 'User account not found.' });
    if (lower(users[0].role) !== 'student') {
      return res.status(400).json({ status: 'error', message: 'The full-delete option is available only for student accounts.' });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    const [studentRows] = await connection.execute('SELECT id FROM students WHERE user_account_id = ?', [userId]);
    for (const student of studentRows) {
      await connection.execute('DELETE FROM schedule_student_assignments WHERE student_id = ?', [student.id]).catch(error => {
        if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
      });
      await connection.execute('DELETE FROM class_list_students WHERE student_id = ?', [student.id]);
      await connection.execute('DELETE FROM students WHERE id = ?', [student.id]);
    }
    await connection.execute('DELETE FROM users WHERE id = ?', [userId]);
    await connection.commit();
    if (req.io) req.io.emit('managed_user_deleted', { id: userId, recordDeleted: true });
    return res.json({ status: 'success', success: true, message: 'Student account and student record deleted.' });
  } catch (err) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Delete managed student record error:', err);
    return res.status(500).json({ status: 'error', message: err.sqlMessage || 'Unable to delete the student record.' });
  } finally {
    if (connection) connection.release();
  }
};


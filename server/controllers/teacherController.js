const db = require('../config/db');
const { hashPassword } = require('../utils/password');
const { isValidEmail, isValidUsername } = require('../utils/profileValidation');
const { BSIT_DEPARTMENT, isBSITDepartment } = require('../config/scope');
const classListSync = require('../services/classListSync');
const native = require('../services/nativeService');

const text = value => String(value ?? '').trim();
const lower = value => text(value).toLowerCase();

/* The shape the page expects, turned from whatever row came back. */
const shapeTeacher = (row) => ({
  ...row,
  full_name: [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' '),
  schedule_count: Number(row.schedule_count) || 0,
  class_list_count: Number(row.class_list_count) || 0
});

const listTeachers = async (_req, res) => {
  try {
    /* C answers this first. It holds the same query as the fallback below,
       and the row is only used when the program cannot be run. */
    const nativeReply = await native.getTeacherList();
    if (nativeReply && Array.isArray(nativeReply.teachers)) {
      res.set('X-SIS-Teacher-Source', 'c-native-worker');
      return res.json(nativeReply.teachers.filter(row => isBSITDepartment(row.department)).map(shapeTeacher));
    }

    const [rows] = await db.query(`
      SELECT t.id, t.teacher_id, t.user_account_id, t.first_name, t.middle_name, t.last_name,
        t.email, t.department, t.status,
        u.user_id AS account_username, u.email AS account_email, u.status AS account_status,
        COUNT(DISTINCT cs.id) AS schedule_count,
        COUNT(DISTINCT cls.id) AS class_list_count
      FROM teachers t
      LEFT JOIN users u ON u.id = t.user_account_id
      LEFT JOIN class_schedules cs ON LOWER(TRIM(cs.teacher_id)) = LOWER(TRIM(t.teacher_id))
      LEFT JOIN class_list_schedules cls ON LOWER(TRIM(cls.teacher_id)) = LOWER(TRIM(t.teacher_id))
      GROUP BY t.id, t.teacher_id, t.user_account_id, t.first_name, t.middle_name, t.last_name,
        t.email, t.department, t.status, u.user_id, u.email, u.status
      ORDER BY t.last_name, t.first_name, t.teacher_id
    `);
    res.set('X-SIS-Teacher-Source', 'node-fallback');
    return res.json(rows
      .filter(row => isBSITDepartment(row.department))
      .map(shapeTeacher));
  } catch (error) {
    console.error('Fetch professors error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to load professors.' });
  }
};

const createTeacher = async (req, res) => {
  const body = req.body || {};
  const teacherId = text(body.teacher_id);
  const firstName = text(body.first_name);
  const middleName = text(body.middle_name);
  const lastName = text(body.last_name);
  const email = lower(body.email);
  const username = text(body.username);
  const password = text(body.password);
  const createAccount = Boolean(username || password);

  if (!teacherId || !firstName || !lastName || !email) {
    return res.status(400).json({ status: 'error', message: 'Teacher ID, first name, last name, and email are required.' });
  }
  if (teacherId.length > 30 || firstName.length > 50 || middleName.length > 50 || lastName.length > 50 || email.length > 100) {
    return res.status(400).json({ status: 'error', message: 'One or more professor details exceed the allowed length.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ status: 'error', message: 'Enter a valid professor email address.' });
  }
  if (createAccount && (!isValidUsername(username) || password.length < 8)) {
    return res.status(400).json({ status: 'error', message: 'Provide a valid username and a password of at least 8 characters, or leave both account fields blank.' });
  }

  let connection;
  try {
    /* Creating a professor is done here rather than in C, because it has
       to hash a password first and hashing is a library job. */
    const passwordHash = createAccount ? await hashPassword(password) : '';
    connection = await db.getConnection();
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [teacherDuplicates] = await connection.execute(
      'SELECT id FROM teachers WHERE LOWER(TRIM(teacher_id)) = LOWER(?) OR LOWER(TRIM(email)) = LOWER(?) LIMIT 1 FOR UPDATE',
      [teacherId, email]
    );
    if (teacherDuplicates.length) {
      await connection.rollback();
      return res.status(409).json({ status: 'error', message: 'That teacher ID or email is already in use.' });
    }

    if (createAccount) {
      const [accountDuplicates] = await connection.execute(
        'SELECT id FROM users WHERE LOWER(TRIM(user_id)) = LOWER(?) OR LOWER(TRIM(email)) = LOWER(?) LIMIT 1 FOR UPDATE',
        [username, email]
      );
      if (accountDuplicates.length) {
        await connection.rollback();
        return res.status(409).json({ status: 'error', message: 'That username or email is already in use.' });
      }
    }

    const [teacherResult] = await connection.execute(`
      INSERT INTO teachers (user_account_id, teacher_id, first_name, middle_name, last_name, email, department, status)
      VALUES (NULL, ?, ?, ?, ?, ?, ?, 'Active')
    `, [teacherId, firstName, middleName || null, lastName, email, BSIT_DEPARTMENT]);
    let accountId = null;
    if (createAccount) {
      const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');
      const [accountResult] = await connection.execute(`
        INSERT INTO users (user_id, password, email, role, approval_status, full_name)
        VALUES (?, ?, ?, 'teacher', 'accepted', ?)
      `, [username, passwordHash, email, fullName]);
      accountId = accountResult.insertId;
      await connection.execute('UPDATE teachers SET user_account_id = ? WHERE id = ?', [accountId, teacherResult.insertId]);
    }
    await connection.commit();
    if (req.io) req.io.emit('teacher_created', { teacher_id: teacherId, id: teacherResult.insertId });
    return res.status(201).json({
      status: 'success',
      success: true,
      id: teacherResult.insertId,
      teacher_id: teacherId,
      account_created: createAccount,
      message: `Professor ${firstName} ${lastName} added successfully.`
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ status: 'error', message: 'That teacher ID, email, or username is already in use.' });
    }
    console.error('Create professor error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to add the professor.' });
  } finally {
    if (connection) connection.release();
  }
};

const removeTeacher = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ status: 'error', message: 'Invalid professor ID.' });

  let connection;
  try {
    await classListSync.ensureTables();
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [teachers] = await connection.execute(
      'SELECT id, teacher_id, user_account_id FROM teachers WHERE id = ? LIMIT 1 FOR UPDATE',
      [id]
    );
    if (!teachers.length) {
      await connection.rollback();
      return res.status(404).json({ status: 'error', message: 'Professor not found.' });
    }

    const teacher = teachers[0];

    // Deleting a professor used to destroy every class list and schedule they
    // held, which silently stripped those students of their enrolment. The admin
    // can now hand the teaching over instead, by naming a replacement professor.
    // The records stay, only the professor they belong to changes.
    const requestedReplacement = req.body && req.body.reassignToTeacherId;
    let replacement = null;
    if (requestedReplacement !== undefined && requestedReplacement !== null && requestedReplacement !== '') {
      const replacementId = Number(requestedReplacement);
      if (!Number.isInteger(replacementId) || replacementId < 1) {
        await connection.rollback();
        return res.status(400).json({ status: 'error', message: 'Choose a valid replacement professor.' });
      }
      if (replacementId === Number(teacher.id)) {
        await connection.rollback();
        return res.status(400).json({ status: 'error', message: 'The replacement must be a different professor.' });
      }
      const [candidates] = await connection.execute(
        'SELECT id, teacher_id, first_name, middle_name, last_name FROM teachers WHERE id = ? LIMIT 1 FOR UPDATE',
        [replacementId]
      );
      if (!candidates.length) {
        await connection.rollback();
        return res.status(404).json({ status: 'error', message: 'Replacement professor not found.' });
      }
      const chosen = candidates[0];
      replacement = {
        id: chosen.id,
        teacher_id: chosen.teacher_id,
        professor_name: [chosen.first_name, chosen.middle_name, chosen.last_name].filter(Boolean).join(' ')
      };
    }

    const [canonicalRows] = await connection.execute(
      'SELECT id FROM class_schedules WHERE LOWER(TRIM(teacher_id)) = LOWER(?) FOR UPDATE',
      [teacher.teacher_id]
    );
    const sourceIds = canonicalRows.map(row => row.id);
    let classListRows = [];
    if (sourceIds.length) {
      const placeholders = sourceIds.map(() => '?').join(',');
      [classListRows] = await connection.execute(
        `SELECT id FROM class_list_schedules WHERE source_schedule_id IN (${placeholders}) OR LOWER(TRIM(teacher_id)) = LOWER(?) FOR UPDATE`,
        [...sourceIds, teacher.teacher_id]
      );
    } else {
      [classListRows] = await connection.execute(
        'SELECT id FROM class_list_schedules WHERE LOWER(TRIM(teacher_id)) = LOWER(?) FOR UPDATE',
        [teacher.teacher_id]
      );
    }
    const classListIds = classListRows.map(row => row.id);
    const studentIds = new Set();
    let keptStudents = 0;
    let movedSchedules = 0;

    if (replacement) {
      // Hand the teaching over. Nothing is deleted, the enrolments stay as they
      // are, and the students keep the classes they were already enrolled in.
      if (classListIds.length) {
        const placeholders = classListIds.map(() => '?').join(',');
        const [assigned] = await connection.execute(
          `SELECT DISTINCT student_id FROM class_list_students WHERE class_list_schedule_id IN (${placeholders}) FOR UPDATE`,
          classListIds
        );
        assigned.forEach(row => studentIds.add(row.student_id));
        keptStudents = assigned.length;
        const [listResult] = await connection.execute(
          `UPDATE class_list_schedules SET teacher_id = ?, professor_name = ? WHERE id IN (${placeholders})`,
          [replacement.teacher_id, replacement.professor_name, ...classListIds]
        );
        movedSchedules += listResult.affectedRows;
      }
      if (sourceIds.length) {
        const placeholders = sourceIds.map(() => '?').join(',');
        const [scheduleResult] = await connection.execute(
          `UPDATE class_schedules SET teacher_id = ?, professor_name = ? WHERE id IN (${placeholders})`,
          [replacement.teacher_id, replacement.professor_name, ...sourceIds]
        );
        movedSchedules += scheduleResult.affectedRows;
      }
      const [legacyResult] = await connection.execute(
        'UPDATE students SET teacher_id = ? WHERE LOWER(TRIM(teacher_id)) = LOWER(?)',
        [replacement.teacher_id, teacher.teacher_id]
      );
      movedSchedules += legacyResult.affectedRows;
    } else {
      if (classListIds.length) {
        const placeholders = classListIds.map(() => '?').join(',');
        const [assigned] = await connection.execute(
          `SELECT DISTINCT student_id FROM class_list_students WHERE class_list_schedule_id IN (${placeholders}) FOR UPDATE`,
          classListIds
        );
        assigned.forEach(row => studentIds.add(row.student_id));
        await connection.execute(`DELETE FROM class_list_students WHERE class_list_schedule_id IN (${placeholders})`, classListIds);
        await connection.execute(`DELETE FROM class_list_schedules WHERE id IN (${placeholders})`, classListIds);
      }
      if (sourceIds.length) {
        const placeholders = sourceIds.map(() => '?').join(',');
        await connection.execute(`DELETE FROM schedule_student_assignments WHERE schedule_id IN (${placeholders})`, sourceIds).catch(error => {
          if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
        });
        await connection.execute(`DELETE FROM class_schedules WHERE id IN (${placeholders})`, sourceIds);
      }
      const [legacyStudents] = await connection.execute(
        'SELECT id FROM students WHERE LOWER(TRIM(teacher_id)) = LOWER(?) FOR UPDATE',
        [teacher.teacher_id]
      );
      legacyStudents.forEach(row => studentIds.add(row.id));
      const ids = [...studentIds];
      await classListSync.syncStudentScheduleFields(connection, ids);
      await classListSync.deactivateUnassignedStudents(connection, ids);
    }
    await connection.execute('DELETE FROM teachers WHERE id = ?', [teacher.id]);

    let accountDeleted = false;
    if (teacher.user_account_id) {
      const [otherTeacherLinks] = await connection.execute(
        'SELECT id FROM teachers WHERE user_account_id = ? AND id <> ? LIMIT 1',
        [teacher.user_account_id, teacher.id]
      );
      if (!otherTeacherLinks.length) {
        await connection.execute("DELETE FROM users WHERE id = ? AND LOWER(role) = 'teacher'", [teacher.user_account_id]);
        accountDeleted = true;
      }
    }
    const affectedStudents = [...studentIds];
    await connection.commit();
    if (req.io) {
      req.io.emit('teacher_deleted', { teacher_id: teacher.teacher_id, id: teacher.id, student_ids: affectedStudents });
      req.io.emit('schedule_updated', {
        action: 'professor_replaced',
        teacher_id: replacement ? replacement.teacher_id : teacher.teacher_id,
        student_ids: affectedStudents
      });
    }
    return res.json({
      status: 'success',
      success: true,
      teacher_id: teacher.teacher_id,
      reassigned_to: replacement ? replacement.teacher_id : null,
      reassigned_to_name: replacement ? replacement.professor_name : null,
      kept_students: keptStudents,
      updated_schedules: movedSchedules,
      deleted_schedules: replacement ? 0 : sourceIds.length,
      deleted_class_lists: replacement ? 0 : classListIds.length,
      updated_students: affectedStudents.length,
      account_deleted: accountDeleted,
      message: replacement
        ? `${replacement.professor_name} now takes these classes. ${keptStudents} student enrolment(s) were kept.`
        : 'Professor, linked account, schedules, and class-list assignments were deleted. Student records were kept.'
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Delete professor error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to delete the professor.' });
  } finally {
    if (connection) connection.release();
  }
};

module.exports = { listTeachers, createTeacher, removeTeacher };

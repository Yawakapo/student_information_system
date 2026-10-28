// Assigning students to class lists: view, assign, remove, move.

const db = require('../config/db');
const { formatClassTime } = require('../utils/time');
const { isBSITCourse } = require('../config/scope');
const {
  ensureTables,
  syncStudentScheduleFields,
  deactivateUnassignedStudents,
  text
} = require('../services/classListSync');

const assignmentIdsFromRequest = (body = {}) => {
  const values = Array.isArray(body.class_list_schedule_ids)
    ? body.class_list_schedule_ids
    : Array.isArray(body.schedule_ids)
      ? body.schedule_ids
      : [body.class_list_schedule_id ?? body.schedule_id];
  return [...new Set(values
    .map(value => Number(value))
    .filter(value => Number.isInteger(value) && value > 0))];
};

const getStudentForAssignment = async (connection, studentNo) => {
  const [rows] = await connection.execute(
    'SELECT id, student_no, status FROM students WHERE student_no = ? LIMIT 1 FOR UPDATE',
    [studentNo]
  );
  return rows[0] || null;
};

const getClassListsForAssignment = async (connection, classListIds) => {
  const placeholders = classListIds.map(() => '?').join(',');
  const [rows] = await connection.execute(
    `SELECT id, course, department, teacher_id, professor_name, subject, day, class_time
     FROM class_list_schedules
     WHERE id IN (${placeholders})
     FOR UPDATE`,
    classListIds
  );
  return rows;
};

exports.getStudentAssignments = async (req, res) => {
  const studentNo = text(req.params.studentNo);
  if (!studentNo) return res.status(400).json({ status: 'error', message: 'Student number is required.' });

  try {
    await ensureTables();
    const [students] = await db.execute(
      'SELECT id, student_no, first_name, last_name FROM students WHERE student_no = ? LIMIT 1',
      [studentNo]
    );
    if (!students.length) return res.status(404).json({ status: 'error', message: 'Student record not found.' });

    const [assignments] = await db.execute(`
      SELECT cls.id,
        COALESCE(NULLIF(TRIM(cs.subject), ''), cls.subject) AS subject,
        cls.section_course, cls.course,
        COALESCE(NULLIF(TRIM(cs.department), ''), cls.department) AS department,
        COALESCE(NULLIF(TRIM(cs.teacher_id), ''), cls.teacher_id) AS teacher_id,
        COALESCE(NULLIF(TRIM(cs.professor_name), ''), NULLIF(TRIM(cls.professor_name), ''), cs.teacher_id, cls.teacher_id) AS professor_name,
        COALESCE(NULLIF(TRIM(cs.day), ''), cls.day) AS day,
        CASE
          WHEN cs.start_time IS NOT NULL AND cs.end_time IS NOT NULL
            THEN CONCAT(DATE_FORMAT(cs.start_time, '%l:%i %p'), ' - ', DATE_FORMAT(cs.end_time, '%l:%i %p'))
          ELSE cls.class_time
        END AS class_time,
        cs.room_lab, cls.source_schedule_id
      FROM class_list_students link
      INNER JOIN class_list_schedules cls ON cls.id = link.class_list_schedule_id
      LEFT JOIN class_schedules cs ON cs.id = cls.source_schedule_id
      WHERE link.student_id = ?
      ORDER BY FIELD(LOWER(TRIM(COALESCE(NULLIF(TRIM(cs.day), ''), cls.day))), 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'), cls.id
    `, [students[0].id]);

    return res.json(assignments.map(assignment => ({
      ...assignment,
      class_time: formatClassTime(assignment.class_time)
    })));
  } catch (error) {
    console.error('Fetch student assignments error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to load the student schedule assignments.' });
  }
};

exports.assignStudent = async (req, res) => {
  const studentNo = text(req.params.studentNo);
  const classListIds = assignmentIdsFromRequest(req.body);
  if (!studentNo || !classListIds.length) {
    return res.status(400).json({ status: 'error', message: 'Student number and at least one class-list schedule are required.' });
  }

  let connection;
  try {
    await ensureTables();
    connection = await db.getConnection();
    await connection.beginTransaction();
    const student = await getStudentForAssignment(connection, studentNo);
    const lists = await getClassListsForAssignment(connection, classListIds);
    if (!student) {
      await connection.rollback();
      return res.status(404).json({ status: 'error', message: 'Student record not found.' });
    }
    if (lists.length !== classListIds.length || lists.some(list => !isBSITCourse(list.course || list.section_course))) {
      await connection.rollback();
      return res.status(400).json({ status: 'error', message: 'One or more selected schedules are invalid or are not BSIT schedules.' });
    }

    for (const classListId of classListIds) {
      await connection.execute(
        'INSERT IGNORE INTO class_list_students (class_list_schedule_id, student_id) VALUES (?, ?)',
        [classListId, student.id]
      );
    }
    await syncStudentScheduleFields(connection, [student.id]);

    // syncStudentScheduleFields above also copies teacher_id from the class list,
    // so the student now sits under that professor. Their account can still be
    // Inactive, though, because they were deactivated for having no class at all.
    // Restoring it is opt-in, so assigning a class never silently overrides a
    // suspension an administrator made on purpose.
    let accountRestored = false;
    if (req.body && req.body.reactivate === true) {
      const [restored] = await connection.execute(
        `UPDATE users SET status = 'Active'
         WHERE id = (SELECT user_account_id FROM students WHERE id = ?)
           AND LOWER(role) = 'student'
           AND LOWER(status) <> 'active'`,
        [student.id]
      );
      accountRestored = restored.affectedRows > 0;
    }

    await connection.commit();

    if (req.io) {
      req.io.emit('schedule_updated', {
        action: 'assigned',
        student_id: student.id,
        class_list_schedule_ids: classListIds
      });
    }
    return res.status(200).json({
      status: 'success',
      success: true,
      assigned: classListIds,
      account_restored: accountRestored,
      message: accountRestored
        ? `Assigned. The account was set back to Active so the student can sign in again.`
        : classListIds.length > 1
          ? `${classListIds.length} schedules assigned to the student.`
          : 'Schedule assigned to the student.'
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(200).json({ status: 'success', success: true, message: 'The selected schedule is already assigned.' });
    }
    console.error('Assign student schedule error:', error);
    return res.status(500).json({ status: 'error', message: error.sqlMessage || 'Unable to assign the student schedule.' });
  } finally {
    if (connection) connection.release();
  }
};

exports.unassignStudent = async (req, res) => {
  const studentNo = text(req.params.studentNo);
  const classListId = Number(req.params.classListId || req.body.class_list_schedule_id);
  if (!studentNo || !Number.isInteger(classListId) || classListId < 1) {
    return res.status(400).json({ status: 'error', message: 'Student number and class-list schedule are required.' });
  }

  let connection;
  try {
    await ensureTables();
    connection = await db.getConnection();
    await connection.beginTransaction();
    const student = await getStudentForAssignment(connection, studentNo);
    if (!student) {
      await connection.rollback();
      return res.status(404).json({ status: 'error', message: 'Student record not found.' });
    }
    const [result] = await connection.execute(
      'DELETE FROM class_list_students WHERE class_list_schedule_id = ? AND student_id = ?',
      [classListId, student.id]
    );
    if (!result.affectedRows) {
      await connection.commit();
      return res.status(200).json({ status: 'success', success: true, already_removed: true, message: 'The schedule was already removed from the student.' });
    }

    await syncStudentScheduleFields(connection, [student.id]);
    await deactivateUnassignedStudents(connection, [student.id]);
    await connection.commit();
    if (req.io) {
      req.io.emit('schedule_updated', {
        action: 'unassigned',
        student_id: student.id,
        class_list_schedule_id: classListId
      });
    }
    return res.json({ status: 'success', success: true, message: 'Schedule removed from the student. Other subjects were kept.' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Unassign student schedule error:', error);
    return res.status(500).json({ status: 'error', message: error.sqlMessage || 'Unable to remove the student schedule.' });
  } finally {
    if (connection) connection.release();
  }
};

// Backward-compatible endpoint. Historically this replaced a student's only
// assignment; it now adds the requested schedule while preserving other subjects.
exports.moveStudent = async (req, res) => {
  const studentNo = text(req.params.studentNo);
  const classListId = Number(req.body.class_list_schedule_id);
  if (!studentNo || !Number.isInteger(classListId) || classListId < 1) {
    return res.status(400).json({ status: 'error', message: 'Student and class list are required.' });
  }

  let connection;
  try {
    await ensureTables();
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [students] = await connection.query('SELECT id FROM students WHERE student_no = ? LIMIT 1', [studentNo]);
    const [lists] = await connection.query('SELECT course, teacher_id, day, class_time FROM class_list_schedules WHERE id = ? LIMIT 1', [classListId]);
    if (!students.length || !lists.length || !isBSITCourse(lists[0].course)) {
      await connection.rollback();
      return res.status(404).json({ status: 'error', message: 'Student or BSIT class list was not found.' });
    }
    await connection.query('INSERT IGNORE INTO class_list_students (class_list_schedule_id, student_id) VALUES (?, ?)', [classListId, students[0].id]);
    await connection.query('UPDATE students SET course = ?, teacher_id = ?, day = ?, class_time = ? WHERE id = ?', [lists[0].course, lists[0].teacher_id || null, lists[0].day, formatClassTime(lists[0].class_time), students[0].id]);
    await connection.commit();
    if (req.io) {
      req.io.emit('schedule_updated', {
        student_id: students[0].id,
        class_list_schedule_id: classListId,
        teacher_id: lists[0].teacher_id || null
      });
    }
    return res.json({ status: 'success', message: 'Student schedule updated.' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    return res.status(500).json({ status: 'error', message: error.sqlMessage || 'Unable to update student schedule.' });
  } finally {
    if (connection) connection.release();
  }
};

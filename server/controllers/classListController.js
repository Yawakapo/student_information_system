// Class-list schedules: list, create, update, delete, and group names.

// Student assignment endpoints live in classListStudents.js.

const db = require('../config/db');
const { formatClassTime, parseClassTime } = require('../utils/time');
const { BSIT_COURSE, BSIT_DEPARTMENT, isBSITCourse, isBSITDepartment } = require('../config/scope');
const {
  ensureTables,
  normalizeName,
  resolveTeacherId,
  syncScheduleCopies,
  syncStudentScheduleFields,
  deactivateUnassignedStudents,
  text
} = require('../services/classListSync');

const listFields = `id, subject, section_course, department, course, day, class_time,
  teacher_id, professor_name, source_schedule_id, created_at`;

const teacherIdentifiers = async (identifier) => {
  const [rows] = await db.execute(`
    SELECT t.teacher_id, t.user_account_id, u.user_id,
      CONCAT_WS(' ', t.first_name, t.middle_name, t.last_name) AS full_name
    FROM teachers t
    LEFT JOIN users u ON u.id = t.user_account_id
    WHERE LOWER(TRIM(t.teacher_id)) = LOWER(?)
       OR LOWER(TRIM(CAST(t.user_account_id AS CHAR))) = LOWER(?)
       OR LOWER(TRIM(u.user_id)) = LOWER(?)
    LIMIT 1
  `, [identifier, identifier, identifier]);
  if (!rows.length) return new Set([identifier.toLowerCase()]);
  const row = rows[0];
  return new Set([identifier, row.teacher_id, String(row.user_account_id), row.user_id, row.full_name]
    .filter(Boolean)
    .flatMap(value => [String(value).trim().toLowerCase(), normalizeName(value)])
    .filter(Boolean));
};

exports.getAll = async (req, res) => {
  try {
    await syncScheduleCopies();
    const [lists] = await db.query(`SELECT ${listFields} FROM class_list_schedules ORDER BY day, subject, id DESC`);
    const displayLists = lists
      .filter(list => isBSITCourse(list.course || list.section_course))
      .map(list => ({
        ...list,
        class_time: formatClassTime(list.class_time)
      }));

    const requestedTeacher = (req.user?.role === 'teacher' || req.user?.role === 'faculty')
      ? text(req.user.user_id)
      : text(req.query.teacher_user_id || req.query.teacher_id || req.query.user_id);
    if (!requestedTeacher) return res.json(displayLists);

    const identifiers = await teacherIdentifiers(requestedTeacher);
    const filtered = displayLists.filter((list) => {
      const teacherId = text(list.teacher_id).toLowerCase();
      const professorName = normalizeName(list.professor_name);
      return identifiers.has(teacherId) || identifiers.has(professorName);
    });
    return res.json(filtered);
  } catch (error) {
    console.error('Fetch class list schedules error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to load class list schedules.' });
  }
};

exports.getGroupLabels = async (_req, res) => {
  try {
    await ensureTables();
    const [rows] = await db.query(
      'SELECT department, course, display_label FROM class_list_group_labels'
    );
    return res.json(rows);
  } catch (error) {
    console.error('Fetch group labels error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to load group names.' });
  }
};

exports.updateGroupLabel = async (req, res) => {
  const displayLabel = text(req.body.display_label);

  if (!displayLabel) {
    return res.status(400).json({ status: 'error', message: 'Enter a name for this group.' });
  }
  if (displayLabel.length > 255) {
    return res.status(400).json({ status: 'error', message: 'The name must be 255 characters or fewer.' });
  }
  // The label is cosmetic. The real department and course are always the BSIT
  // values, so renaming can never widen the system beyond BSIT.
  if (!isBSITDepartment(req.body.department) || !isBSITCourse(req.body.course)) {
    return res.status(400).json({ status: 'error', message: 'Only BSIT groups can be named in this system.' });
  }

  let connection;
  try {
    await ensureTables();
    connection = await db.getConnection();
    await connection.execute(`
      INSERT INTO class_list_group_labels (department, course, display_label)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE display_label = VALUES(display_label)
    `, [BSIT_DEPARTMENT, BSIT_COURSE, displayLabel]);
    await connection.commit();
    if (req.io) {
      req.io.emit('class_list_label_updated', {
        department: BSIT_DEPARTMENT,
        course: BSIT_COURSE,
        display_label: displayLabel
      });
    }
    return res.json({
      status: 'success',
      success: true,
      message: 'Group name updated.',
      display_label: displayLabel
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Update group label error:', error);
    return res.status(500).json({ status: 'error', message: error.sqlMessage || 'Unable to update the group name.' });
  } finally {
    if (connection) connection.release();
  }
};

exports.create = async (req, res) => {
  const subject = text(req.body.subject);
  const section = text(req.body.section || req.body.section_course);
  const requestedCourse = text(req.body.course || section);
  const department = BSIT_DEPARTMENT;
  const course = BSIT_COURSE;
  const day = text(req.body.day);
  const classTime = formatClassTime(req.body.class_time || req.body.time);
  const professorName = text(req.body.professor_name);
  const teacherId = text(req.body.teacher_id || req.body.teacher_user_id);

  if (!subject || !requestedCourse || !day || !classTime) {
    return res.status(400).json({ status: 'error', message: 'Subject, course, day, and time are required.' });
  }
  if (!isBSITCourse(requestedCourse)) {
    return res.status(400).json({ status: 'error', message: 'Only BSIT class lists are allowed in this system.' });
  }

  try {
    await ensureTables();
    const [result] = await db.query(
      'INSERT INTO class_list_schedules (subject, section_course, department, course, day, class_time, professor_name, teacher_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [subject, course, department, course, day, classTime, professorName, teacherId]
    );
    if (req.io) req.io.emit('schedule_created', { class_list_schedule_id: result.insertId });
    return res.status(201).json({ status: 'success', id: result.insertId, message: 'Class list schedule created.' });
  } catch (error) {
    console.error('Create class list error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to create the class list schedule.' });
  }
};

exports.getStudents = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ status: 'error', message: 'Invalid class list schedule.' });
  try {
    await ensureTables();
    const [scheduleRows] = await db.query('SELECT id, course FROM class_list_schedules WHERE id = ? LIMIT 1', [id]);
    if (!scheduleRows.length || !isBSITCourse(scheduleRows[0].course)) {
      return res.status(404).json({ status: 'error', message: 'BSIT class list schedule not found.' });
    }
    const [students] = await db.query(`
      SELECT s.student_no, s.first_name, s.last_name, s.year_level, s.course, s.status,
        s.gender, s.birthday, s.class_time, s.time_period, s.contact_number,
        s.emergency_contact_number, s.address, cls.subject, cls.section_course,
        cls.department, cls.course AS class_course, cls.day,
        cls.class_time AS schedule_time, cls.teacher_id,
        COALESCE(NULLIF(TRIM(cls.professor_name), ''), NULLIF(TRIM(cls.teacher_id), ''), CONCAT('Class List: ', cls.subject)) AS professor_name
      FROM class_list_schedules cls
      INNER JOIN class_list_students link ON link.class_list_schedule_id = cls.id
      INNER JOIN students s ON s.id = link.student_id
      WHERE cls.id = ?
      ORDER BY s.last_name, s.first_name
    `, [id]);
    return res.json(students.map(student => ({
      ...student,
      class_time: formatClassTime(student.class_time),
      schedule_time: formatClassTime(student.schedule_time)
    })));
  } catch (error) {
    console.error('Fetch class list students error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to load class list students.' });
  }
};

exports.remove = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ status: 'error', message: 'Invalid class list schedule.' });

  let connection;
  try {
    await ensureTables();
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [scheduleRows] = await connection.execute(
      'SELECT id, source_schedule_id FROM class_list_schedules WHERE id = ? LIMIT 1 FOR UPDATE',
      [id]
    );
    if (!scheduleRows.length) {
      await connection.commit();
      return res.json({
        status: 'success',
        success: true,
        already_deleted: true,
        message: 'Class list schedule was already removed.'
      });
    }

    const sourceScheduleId = scheduleRows[0].source_schedule_id || null;
    let classListIds = [id];
    if (sourceScheduleId) {
      const [relatedLists] = await connection.execute(
        'SELECT id FROM class_list_schedules WHERE source_schedule_id = ? FOR UPDATE',
        [sourceScheduleId]
      );
      classListIds = relatedLists.map(row => row.id);
    }

    const placeholders = classListIds.map(() => '?').join(',');
    const [assignedStudents] = await connection.execute(
      `SELECT DISTINCT student_id FROM class_list_students WHERE class_list_schedule_id IN (${placeholders})`,
      classListIds
    );
    await connection.execute(
      `DELETE FROM class_list_students WHERE class_list_schedule_id IN (${placeholders})`,
      classListIds
    );
    await connection.execute(
      `DELETE FROM class_list_schedules WHERE id IN (${placeholders})`,
      classListIds
    );

    if (sourceScheduleId) {
      await connection.execute(
        'DELETE FROM schedule_student_assignments WHERE schedule_id = ?',
        [sourceScheduleId]
      ).catch(error => {
        if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
      });
      await connection.execute('DELETE FROM class_schedules WHERE id = ?', [sourceScheduleId]);
    }

    const studentIds = assignedStudents.map(row => row.student_id);
    await syncStudentScheduleFields(connection, studentIds);
    await deactivateUnassignedStudents(connection, studentIds);
    await connection.commit();
    if (req.io) {
      req.io.emit('schedule_deleted', {
        class_list_schedule_id: id,
        source_schedule_id: sourceScheduleId,
        student_ids: studentIds
      });
    }
    return res.json({
      status: 'success',
      success: true,
      message: 'Schedule deleted. Students were kept and their schedule assignments were updated.',
      deleted_class_lists: classListIds.length,
      updated_students: studentIds.length
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Delete class list error:', error);
    return res.status(500).json({ status: 'error', message: 'Unable to delete the class list schedule.' });
  } finally {
    if (connection) connection.release();
  }
};

exports.update = async (req, res) => {
  const id = Number(req.params.id);
  const department = BSIT_DEPARTMENT;
  const requestedCourse = text(req.body.course);
  const course = BSIT_COURSE;
  const subject = text(req.body.subject);
  const day = text(req.body.day);
  const classTime = formatClassTime(req.body.class_time);
  const professorName = text(req.body.professor_name);
  const teacherId = text(req.body.teacher_id);
  if (!Number.isInteger(id) || id < 1 || !requestedCourse || !subject || !day || !classTime) {
    return res.status(400).json({ status: 'error', message: 'Course, subject, day, and time are required.' });
  }
  if (!isBSITCourse(requestedCourse)) {
    return res.status(400).json({ status: 'error', message: 'Only BSIT class lists are allowed in this system.' });
  }

  let connection;
  try {
    await ensureTables();
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [existingRows] = await connection.execute(
      'SELECT id, teacher_id, professor_name, source_schedule_id FROM class_list_schedules WHERE id = ? LIMIT 1',
      [id]
    );
    if (!existingRows.length) {
      await connection.rollback();
      return res.status(404).json({ status: 'error', message: 'Class list not found.' });
    }

    const existing = existingRows[0];
    const finalProfessorName = professorName || text(existing.professor_name) || teacherId || 'Professor not assigned';
    const requestedTeacherId = teacherId || text(existing.teacher_id);
    const finalTeacherId = professorName
      ? await resolveTeacherId(connection, teacherId, finalProfessorName) || requestedTeacherId
      : requestedTeacherId;
    let sourceScheduleId = existing.source_schedule_id || null;

    // Older class-list rows may not have a source link yet. Link an exact
    // matching schedule so future edits are reflected in the teacher portal.
    if (!sourceScheduleId) {
      const [matches] = await connection.execute(`
        SELECT id
        FROM class_schedules
        WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?))
          AND LOWER(TRIM(course)) = LOWER(TRIM(?))
          AND LOWER(TRIM(day)) = LOWER(TRIM(?))
        ORDER BY id DESC
        LIMIT 1
      `, [subject, course, day]);
      if (matches.length) {
        const candidateId = matches[0].id;
        const [owners] = await connection.execute(
          'SELECT id FROM class_list_schedules WHERE source_schedule_id = ? AND id <> ? LIMIT 1',
          [candidateId, id]
        );
        if (!owners.length) sourceScheduleId = candidateId;
      }
    }

    if (sourceScheduleId) {
      const [owners] = await connection.execute(
        'SELECT id FROM class_list_schedules WHERE source_schedule_id = ? AND id <> ? LIMIT 1',
        [sourceScheduleId, id]
      );
      if (owners.length) sourceScheduleId = null;
    }

    await connection.execute(`
      UPDATE class_list_schedules
      SET department = ?, course = ?, section_course = ?, subject = ?, day = ?, class_time = ?,
          professor_name = ?, teacher_id = ?, source_schedule_id = ?
      WHERE id = ?
    `, [department, course, course, subject, day, classTime, finalProfessorName, finalTeacherId, sourceScheduleId, id]);

    const timeRange = parseClassTime(classTime);
    if (sourceScheduleId && timeRange.startTime && timeRange.endTime) {
      await connection.execute(`
        UPDATE class_schedules
        SET department = ?, course = ?, section_course = ?, subject = ?, day = ?,
            professor_name = ?, teacher_id = ?, start_time = ?, end_time = ?
        WHERE id = ?
      `, [department, course, course, subject, day, finalProfessorName, finalTeacherId, timeRange.startTime, timeRange.endTime, sourceScheduleId]);
    }

    // Keep the denormalized student fields consistent with the class-list
    // assignment so every portal reads the same edited schedule.
    await connection.execute(`
      UPDATE students s
      INNER JOIN class_list_students link ON link.student_id = s.id
      SET s.course = ?, s.teacher_id = ?, s.day = ?, s.class_time = ?
      WHERE link.class_list_schedule_id = ?
    `, [course, finalTeacherId || null, day, classTime, id]);

    await connection.commit();
    if (req.io) req.io.emit('schedule_updated', { class_list_schedule_id: id, source_schedule_id: sourceScheduleId });
    return res.json({ status: 'success', success: true, message: 'Class list schedule updated.' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Update class list error:', error);
    return res.status(500).json({ status: 'error', message: error.sqlMessage || 'Unable to update the class list.' });
  } finally {
    if (connection) connection.release();
  }
};

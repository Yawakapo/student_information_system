// Shared class-list helpers. Used by the class-list controllers and also by

// the schedule and teacher controllers, so it lives in services/.

const db = require('../config/db');
const { formatClassTime } = require('../utils/time');
const { BSIT_COURSE, BSIT_DEPARTMENT } = require('../config/scope');

const text = (value) => String(value ?? '').trim();
const normalizeName = (value) => text(value).toLowerCase()
  .replace(/\b(prof|professor|profesora|atty|dr)\b/g, '')
  .replace(/[^a-z0-9]+/g, '');

const resolveTeacherId = async (connection, teacherId, professorName) => {
  const cleanId = text(teacherId);
  if (cleanId) return cleanId;
  const cleanName = text(professorName);
  if (!cleanName) return '';
  const [rows] = await connection.execute('SELECT teacher_id, first_name, middle_name, last_name FROM teachers');
  const wanted = normalizeName(cleanName);
  const match = rows.find(row => {
    const fullName = normalizeName(`${row.first_name || ''} ${row.middle_name || ''} ${row.last_name || ''}`);
    return fullName === wanted || fullName.includes(wanted) || wanted.includes(fullName);
  });
  return match?.teacher_id || '';
};

const ensureTables = async () => {
  await db.query(`CREATE TABLE IF NOT EXISTS class_list_schedules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    subject VARCHAR(255) NOT NULL,
    section_course VARCHAR(255) NOT NULL,
    department VARCHAR(255) NOT NULL DEFAULT '',
    course VARCHAR(255) NOT NULL DEFAULT '',
    day VARCHAR(30) NOT NULL,
    class_time VARCHAR(60) NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.query("ALTER TABLE class_list_schedules ADD COLUMN class_time VARCHAR(60) NOT NULL DEFAULT ''").catch(error => {
    if (error.code !== 'ER_DUP_FIELDNAME') throw error;
  });
  for (const column of ['department', 'course', 'teacher_id', 'professor_name']) {
    await db.query(`ALTER TABLE class_list_schedules ADD COLUMN ${column} VARCHAR(255) NOT NULL DEFAULT ''`).catch(error => {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    });
  }
  await db.query('ALTER TABLE class_list_schedules ADD COLUMN source_schedule_id INT NULL UNIQUE').catch(error => {
    if (error.code !== 'ER_DUP_FIELDNAME' && error.code !== 'ER_DUP_KEYNAME') throw error;
  });
  await db.query("UPDATE class_list_schedules SET course = section_course WHERE course = ''");
  await db.query(`CREATE TABLE IF NOT EXISTS class_list_students (
    class_list_schedule_id INT NOT NULL,
    student_id INT NOT NULL,
    PRIMARY KEY (class_list_schedule_id, student_id)
  )`);
  // Optional display label for a department/course group. The real department
  // and course stay BSIT-only; this only changes the text shown in the panel.
  await db.query(`CREATE TABLE IF NOT EXISTS class_list_group_labels (
    id INT AUTO_INCREMENT PRIMARY KEY,
    department VARCHAR(255) NOT NULL,
    course VARCHAR(255) NOT NULL,
    display_label VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY group_key (department, course)
  )`);
};

const syncScheduleCopies = async () => {
  await ensureTables();
  await db.query(`UPDATE class_list_schedules cls
    INNER JOIN class_schedules cs ON cs.subject = cls.subject AND cs.course = cls.course AND cs.day = cls.day
    LEFT JOIN class_list_schedules mapped ON mapped.source_schedule_id = cs.id
    SET cls.source_schedule_id = cs.id
    WHERE cls.source_schedule_id IS NULL AND mapped.id IS NULL
       AND LOWER(REPLACE(REPLACE(TRIM(cls.course), ' ', ''), '-', '')) LIKE 'bsit%'`);
  await db.query(`INSERT INTO class_list_schedules (source_schedule_id, subject, section_course, department, course, day, class_time, teacher_id, professor_name)
    SELECT cs.id, cs.subject, cs.section_course, cs.department, cs.course, cs.day,
      CONCAT(DATE_FORMAT(cs.start_time, '%l:%i %p'), ' - ', DATE_FORMAT(cs.end_time, '%l:%i %p')),
      cs.teacher_id, cs.professor_name
    FROM class_schedules cs
    LEFT JOIN class_list_schedules cls ON cls.source_schedule_id = cs.id
    WHERE cls.id IS NULL
       AND LOWER(REPLACE(REPLACE(TRIM(cs.course), ' ', ''), '-', '')) LIKE 'bsit%'`);
};

const deactivateUnassignedStudents = async (connection, studentIds = []) => {
  const uniqueIds = [...new Set(studentIds.map(Number).filter(id => Number.isInteger(id) && id > 0))];
  if (!uniqueIds.length) return;
  const placeholders = uniqueIds.map(() => '?').join(',');
  const [rows] = await connection.execute(`
    SELECT s.id, s.user_account_id,
      COUNT(DISTINCT cls.id) AS valid_class_list_count
    FROM students s
    LEFT JOIN class_list_students link ON link.student_id = s.id
    LEFT JOIN class_list_schedules cls ON cls.id = link.class_list_schedule_id
    WHERE s.id IN (${placeholders})
    GROUP BY s.id, s.user_account_id
  `, uniqueIds);
  for (const row of rows) {
    if (row.user_account_id && Number(row.valid_class_list_count) === 0) {
      await connection.execute(
        "UPDATE users SET status = 'Inactive' WHERE id = ? AND LOWER(role) = 'student'",
        [row.user_account_id]
      );
    }
  }
};

const syncStudentScheduleFields = async (connection, studentIds = []) => {
  const uniqueIds = [...new Set(studentIds.map(Number).filter(id => Number.isInteger(id) && id > 0))];
  for (const studentId of uniqueIds) {
    const [remaining] = await connection.execute(`
      SELECT cls.teacher_id, cls.day, cls.class_time
      FROM class_list_students link
      INNER JOIN class_list_schedules cls ON cls.id = link.class_list_schedule_id
      WHERE link.student_id = ?
      ORDER BY cls.id DESC
      LIMIT 1
    `, [studentId]);
    if (remaining.length) {
      const schedule = remaining[0];
      const classTime = formatClassTime(schedule.class_time) || 'Not assigned';
      await connection.execute(`
        UPDATE students
        SET teacher_id = ?, day = ?, class_time = ?, time_period = ?
        WHERE id = ?
      `, [text(schedule.teacher_id) || null, text(schedule.day) || 'Unassigned', classTime, /pm/i.test(classTime) ? 'PM' : 'AM', studentId]);
    } else {
      await connection.execute(`
        UPDATE students
        SET teacher_id = NULL, day = 'Unassigned', class_time = 'Not assigned', time_period = 'AM'
        WHERE id = ?
      `, [studentId]);
    }
  }
};

const createFromSchedule = async (schedule, connection = db) => {
  if (connection === db) await ensureTables();
  const classTime = formatClassTime(schedule.class_time || `${schedule.start_time || ''} - ${schedule.end_time || ''}`.trim());
  const [result] = await connection.query(
    'INSERT INTO class_list_schedules (source_schedule_id, subject, section_course, department, course, day, class_time, teacher_id, professor_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [schedule.id || null, schedule.subject, BSIT_COURSE, BSIT_DEPARTMENT, BSIT_COURSE, schedule.day, classTime, schedule.teacher_id || '', schedule.professor_name || '']
  );
  return result.insertId;
};

module.exports = {
  deactivateUnassignedStudents,
  ensureTables,
  normalizeName,
  resolveTeacherId,
  syncScheduleCopies,
  syncStudentScheduleFields,
  createFromSchedule,
  text
};

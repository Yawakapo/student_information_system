const db = require('../config/db');
const classListSync = require('../services/classListSync');
const { getScheduleList, checkSchedule, runScheduleWorker } = require('../services/nativeService');

// Turns the worker's own failure code into the status code and wording the page
// already expects, so the frontend does not have to learn a second vocabulary.
const SCHEDULE_FAILURE = {
  missing_subject: [400, 'Subject is required.'],
  missing_professor: [400, 'Professor is required.'],
  missing_day: [400, 'Day is required.'],
  missing_time: [400, 'Start time and end time are required.'],
  bad_time: [400, 'Enter valid start and end times.'],
  end_before_start: [400, 'End time must be later than start time.'],
  not_bsit: [400, 'Only BSIT schedules are allowed in this system.'],
  not_found: [404, 'Schedule entry not found.'],
  conflict: [409, 'That professor already has a class at this time.'],
  bad_request: [400, 'That schedule request is not valid.']
};
const { formatClassTime, parseClassTime } = require('../utils/time');
const { BSIT_COURSE, BSIT_DEPARTMENT, isBSITCourse, isBSITDepartment } = require('../config/scope');

const text = (value) => String(value ?? '').trim();
const lower = (value) => text(value).toLowerCase();
const normalizeName = (value) => lower(value)
  .replace(/\b(prof|professor|profesora|atty|dr)\b/g, '')
  .replace(/[^a-z0-9]+/g, '')
  .trim();
const normalizeCourse = (value) => lower(value).replace(/[^a-z0-9]+/g, '');
const normalizeSubject = (value) => lower(value).replace(/[^a-z0-9]+/g, '');
const normalizeDepartment = (value) => {
  const department = lower(value).trim();
  return /^(college|school) of computer studies$/.test(department)
    ? 'school of information technology'
    : department;
};
const isUsableSchedule = (schedule) => Boolean(
  schedule
    && isBSITCourse(schedule.course || schedule.section_course)
    && text(schedule.subject)
    && !/^bsit$/i.test(text(schedule.subject))
    && text(schedule.day)
    && text(schedule.start_time)
    && text(schedule.end_time)
);

const resolveTeacherId = async (teacherId, professorName, connection = db) => {
  const cleanId = text(teacherId);
  if (cleanId) return cleanId;
  const cleanName = text(professorName);
  if (!cleanName) return '';
  const [rows] = await connection.execute(`
    SELECT t.teacher_id, t.first_name, t.middle_name, t.last_name
    FROM teachers t
  `);
  const wanted = normalizeName(cleanName);
  const match = rows.find(row => {
    const fullName = normalizeName(`${row.first_name || ''} ${row.middle_name || ''} ${row.last_name || ''}`);
    return fullName === wanted || fullName.includes(wanted) || wanted.includes(fullName);
  });
  return match?.teacher_id || '';
};

exports.getTeachers = async (_req, res) => {
  try {
    const [teachers] = await db.query("SELECT teacher_id, user_account_id, first_name, middle_name, last_name, department FROM teachers WHERE LOWER(COALESCE(status, 'active')) = 'active' ORDER BY last_name, first_name");
    return res.json(teachers
      .filter(teacher => isBSITDepartment(teacher.department))
      .map(teacher => ({
        ...teacher,
        full_name: [teacher.first_name, teacher.middle_name, teacher.last_name].filter(Boolean).join(' ')
      })));
  } catch (error) {
    return res.status(500).json({ status: 'error', message: 'Unable to load professors.' });
  }
};

exports.getSchedules = async (req, res) => {
  try {
    const requestedTeacher = (req.user?.role === 'teacher' || req.user?.role === 'faculty')
      ? text(req.user.user_id)
      : text(req.query.user_id || req.query['user id'] || req.query.teacher_id || req.query.teacher_user_id || req.query.id);

    const scheduleFields = `cs.id, cs.teacher_id, cs.subject, cs.section_course, cs.department, cs.course,
      cs.room_lab, cs.day, cs.start_time, cs.end_time, cs.created_at,
      COALESCE(NULLIF(TRIM(cs.professor_name), ''), NULLIF(TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.middle_name, ''), ' ', COALESCE(t.last_name, ''))), ''), NULLIF(TRIM(cs.teacher_id), ''), CONCAT('Schedule: ', cs.subject)) AS professor_name`;

    // The C worker answers this one first because it only has to list the whole
    // timetable. The identical Node.js query below is the fallback, so a missing
    // or broken worker cannot empty the page. Both paths then go through the
    // same BSIT filter and the same teacher matching.
    //
    // The worker wraps its rows in an object so it can report which side
    // answered, so the rows are taken out of that wrapper before being used.
    const nativeReply = await getScheduleList();
    const nativeResults = Array.isArray(nativeReply)
      ? nativeReply
      : (nativeReply && Array.isArray(nativeReply.schedules) ? nativeReply.schedules : null);

    let results = nativeResults;
    let source = 'c-native-worker';
    if (!results) {
      source = 'nodejs-fallback';
      [results] = await db.query(`SELECT ${scheduleFields}
        FROM class_schedules cs
        LEFT JOIN teachers t ON t.teacher_id = cs.teacher_id
        ORDER BY cs.id DESC`);
    }
    // Reported in a header so the browser can show which side answered without
    // changing the shape of the JSON the pages already read.
    res.set('X-SIS-Schedule-Source', source);

    // The C worker prints created_at the way MySQL stores it. The Node.js driver
    // hands back a Date, which would otherwise be sent as a UTC string and make
    // the two answers look different when they are the same row. No page shows
    // this field, but keeping the two identical means the C answer and the
    // Node.js answer can be compared directly.
    const stamp = (value) => {
      if (!(value instanceof Date)) return value;
      const pad = number => String(number).padStart(2, '0');
      return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} `
        + `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
    };

    const bsitResults = (results || []).filter(isUsableSchedule)
      .map(schedule => ({ ...schedule, created_at: stamp(schedule.created_at) }));
    if (!requestedTeacher) return res.status(200).json(bsitResults);

    const [teacherRows] = await db.execute(`
      SELECT t.teacher_id, t.user_account_id, t.first_name, t.middle_name, t.last_name, u.user_id
      FROM teachers t
      LEFT JOIN users u ON u.id = t.user_account_id
      WHERE LOWER(TRIM(t.teacher_id)) = LOWER(?)
         OR LOWER(TRIM(CAST(t.user_account_id AS CHAR))) = LOWER(?)
         OR LOWER(TRIM(u.user_id)) = LOWER(?)
      LIMIT 1
    `, [requestedTeacher, requestedTeacher, requestedTeacher]);
    const identifiers = new Set([requestedTeacher.toLowerCase()]);
    const names = new Set();
    if (teacherRows[0]) {
      const teacher = teacherRows[0];
      [teacher.teacher_id, teacher.user_account_id, teacher.user_id].filter(Boolean)
        .forEach(value => identifiers.add(String(value).toLowerCase()));
      names.add(normalizeName(`${teacher.first_name || ''} ${teacher.middle_name || ''} ${teacher.last_name || ''}`));
    }
    const filtered = bsitResults.filter(schedule => {
      const teacherId = lower(schedule.teacher_id);
      const professorName = normalizeName(schedule.professor_name);
      return identifiers.has(teacherId) || names.has(professorName);
    });
    return res.status(200).json(filtered);
  } catch (err) {
    console.error('Fetch Schedules Error:', err);
    return res.status(500).json({ status: 'error', message: err.sqlMessage || 'Failed to fetch schedules' });
  }
};

exports.getStudentSchedule = async (req, res) => {
  const requestedStudentId = text(req.params.id);
  if (!requestedStudentId) return res.status(400).json({ success: false, message: 'Student ID is required.' });
  // A student is always resolved from the authenticated numeric account ID.
  // This keeps schedule access working after the login username is edited.
  const studentId = req.user?.role === 'student' ? String(req.user.userId) : requestedStudentId;
  if (req.user?.role === 'student' && String(req.user.userId) !== studentId) {
    return res.status(403).json({ success: false, message: 'You cannot view another student schedule.' });
  }

  try {
    const [studentRows] = await db.execute(`
      SELECT s.id, s.course, s.department, s.teacher_id
      FROM students s
      LEFT JOIN users u ON u.id = s.user_account_id
      WHERE s.student_no = ? OR TRIM(u.user_id) = ? OR TRIM(u.full_name) = ? OR CAST(s.user_account_id AS CHAR) = ?
      LIMIT 1
    `, [studentId, studentId, studentId, studentId]);
    if (!studentRows.length) return res.status(404).json({ success: false, message: 'Student record not found.' });
    if (!isBSITCourse(studentRows[0].course)) {
      return res.status(403).json({ success: false, message: 'This student is not a BSIT student.' });
    }

    // A class-list assignment is required for student access, but the live
    // admin/teacher schedule is the source of truth for the rows shown here.
    // If no canonical schedule exists, the assigned class-list row is used as
    // a safe fallback for older records.
    const [classLists] = await db.execute(`
      SELECT cls.id, cls.subject, cls.section_course, cls.department, cls.course,
        cls.day, cls.class_time, cls.teacher_id, cls.professor_name,
        cls.source_schedule_id
      FROM class_list_schedules cls
      INNER JOIN class_list_students link ON link.class_list_schedule_id = cls.id
      WHERE link.student_id = ?
      ORDER BY cls.day, cls.id
    `, [studentRows[0].id]);

    // The admin/teacher schedule is the live source for a student's portal.
    // A class-list row can remain linked to an older manually-created row, so
    // first resolve the student's current professor/course to the canonical
    // class_schedules entries. Fall back to the assigned class-list row only
    // when no canonical schedule exists.
    const teacherTerms = [...new Set([
      studentRows[0].teacher_id,
      ...classLists.map(classList => classList.teacher_id),
      ...classLists.map(classList => classList.professor_name)
    ].map(value => lower(text(value))).filter(Boolean))];
    const sourceScheduleIds = [...new Set(classLists
      .map(classList => Number(classList.source_schedule_id))
      .filter(value => Number.isInteger(value) && value > 0))];
    let canonicalSchedules = [];
    if (classLists.length && (teacherTerms.length || sourceScheduleIds.length)) {
      const teacherPlaceholders = teacherTerms.map(() => '?').join(',');
      const sourcePlaceholders = sourceScheduleIds.map(() => '?').join(',');
      const teacherClause = teacherTerms.length ? `(
        LOWER(TRIM(cs.teacher_id)) IN (${teacherPlaceholders})
        OR LOWER(TRIM(cs.professor_name)) IN (${teacherPlaceholders})
        OR LOWER(TRIM(t.teacher_id)) IN (${teacherPlaceholders})
        OR LOWER(TRIM(CONCAT_WS(' ', t.first_name, t.middle_name, t.last_name))) IN (${teacherPlaceholders})
      )` : '';
      const sourceClause = sourceScheduleIds.length ? `cs.id IN (${sourcePlaceholders})` : '';
      const whereClause = [teacherClause, sourceClause].filter(Boolean).join(' OR ');
      const [canonicalRows] = await db.execute(`
        SELECT cs.id, cs.teacher_id, cs.subject, cs.section_course, cs.department, cs.course,
          cs.room_lab, cs.day, cs.start_time, cs.end_time,
          COALESCE(NULLIF(TRIM(cs.professor_name), ''), NULLIF(TRIM(CONCAT_WS(' ', t.first_name, t.middle_name, t.last_name)), ''), NULLIF(TRIM(cs.teacher_id), ''), CONCAT('Schedule: ', cs.subject)) AS professor_name
        FROM class_schedules cs
        LEFT JOIN teachers t ON t.teacher_id = cs.teacher_id
        WHERE ${whereClause}
        ORDER BY cs.day, cs.start_time, cs.id
      `, [
        ...teacherTerms,
        ...teacherTerms,
        ...teacherTerms,
        ...teacherTerms,
        ...sourceScheduleIds
      ]);

      const studentCourse = normalizeCourse(studentRows[0].course);
      const studentDepartment = normalizeDepartment(studentRows[0].department);
      canonicalSchedules = canonicalRows.filter(schedule => {
        if (!isUsableSchedule(schedule)) return false;
        const scheduleDepartment = normalizeDepartment(schedule.department);
        if (studentDepartment && scheduleDepartment && studentDepartment !== scheduleDepartment) return false;
        if (!studentCourse) return true;
        const scheduleCourse = normalizeCourse(schedule.course || schedule.section_course);
        return scheduleCourse === studentCourse
          || scheduleCourse.includes(studentCourse)
          || studentCourse.includes(scheduleCourse);
      });
    }

    const scheduleMatchesProfessor = (schedule, classList) => {
      const classListTeacherId = lower(text(classList.teacher_id));
      const scheduleTeacherId = lower(text(schedule.teacher_id));
      const classListProfessor = normalizeName(classList.professor_name);
      const scheduleProfessor = normalizeName(schedule.professor_name);
      return Boolean(
        (classListTeacherId && scheduleTeacherId && classListTeacherId === scheduleTeacherId)
        || (classListProfessor && scheduleProfessor && classListProfessor === scheduleProfessor)
      );
    };

    const scheduleMatchesClassList = (schedule, classList) => {
      const classCourse = normalizeCourse(classList.course || classList.section_course);
      const scheduleCourse = normalizeCourse(schedule.course || schedule.section_course);
      const courseMatches = !classCourse || !scheduleCourse
        || classCourse === scheduleCourse
        || classCourse.includes(scheduleCourse)
        || scheduleCourse.includes(classCourse);
      return courseMatches
        && normalizeSubject(schedule.subject) === normalizeSubject(classList.subject)
        && lower(text(schedule.day)) === lower(text(classList.day));
    };

    const findCanonicalForClassList = classList => {
      if (classList.source_schedule_id) {
        const sourceMatch = canonicalSchedules.find(schedule => String(schedule.id) === String(classList.source_schedule_id));
        if (sourceMatch) return sourceMatch;
      }
      const professorSchedules = canonicalSchedules.filter(schedule => scheduleMatchesProfessor(schedule, classList));
      return professorSchedules.find(schedule => scheduleMatchesClassList(schedule, classList))
        || (professorSchedules.length === 1 ? professorSchedules[0] : null);
    };

    const schedules = [];
    const seenSchedules = new Set();
    for (const classList of classLists) {
      const canonical = findCanonicalForClassList(classList);
      if (canonical) {
        const key = `canonical:${canonical.id}`;
        if (!seenSchedules.has(key)) {
          seenSchedules.add(key);
          schedules.push({
            department: canonical.department || 'Not specified',
            course: canonical.course || canonical.section_course || 'Not specified',
            subject: canonical.subject,
            professor_name: canonical.professor_name,
            room_lab: canonical.room_lab || '',
            day: canonical.day,
            start_time: canonical.start_time,
            end_time: canonical.end_time,
            class_time: formatClassTime(`${canonical.start_time || ''} - ${canonical.end_time || ''}`.trim())
          });
        }
        continue;
      }

      let schedule = null;
      if (classList.source_schedule_id) {
        const [sourceMatches] = await db.execute(`
          SELECT id, room_lab, start_time, end_time, professor_name
          FROM class_schedules
          WHERE id = ?
          LIMIT 1
        `, [classList.source_schedule_id]);
        schedule = sourceMatches[0] || null;
      } else {
        // Only use heuristic enrichment when it identifies one schedule. A
        // broad subject/course/day match can otherwise attach the wrong room.
        const [matches] = await db.execute(`
          SELECT id, room_lab, start_time, end_time, professor_name
          FROM class_schedules
          WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?))
            AND LOWER(TRIM(course)) = LOWER(TRIM(?))
            AND LOWER(TRIM(day)) = LOWER(TRIM(?))
          LIMIT 2
        `, [classList.subject, classList.course || classList.section_course, classList.day]);
        if (matches.length === 1) schedule = matches[0];
      }
      const classListTime = formatClassTime(classList.class_time);
      const fallbackTime = formatClassTime(`${schedule?.start_time || ''} - ${schedule?.end_time || ''}`.trim());
      const key = `class-list:${classList.id}`;
      if (!seenSchedules.has(key)) {
        seenSchedules.add(key);
        schedules.push({
          department: classList.department || 'Not specified',
          course: classList.course || classList.section_course || 'Not specified',
          subject: classList.subject,
          professor_name: classList.professor_name || schedule?.professor_name || classList.teacher_id || 'Professor not assigned',
          room_lab: schedule?.room_lab || '',
          day: classList.day,
          // The class-list assignment is authoritative. This prevents an edited
          // class-list time from being replaced by a stale class_schedules row.
          start_time: classListTime ? null : schedule?.start_time || null,
          end_time: classListTime ? null : schedule?.end_time || null,
          class_time: classListTime || fallbackTime || null
        });
      }
    }

    // A class-list row only records that a student was given a schedule. The
    // schedule panel is where the real timetable lives. So after the assigned
    // rows are built, every live schedule for this student's professor that is
    // not on screen yet is added here.
    //
    // Without this, a schedule created in the admin panel stays invisible on the
    // student portal until somebody separately assigns it to that student, which
    // is why a freshly added schedule appeared to "not update".
    const shownSubjects = new Set(schedules.map(item =>
      `${normalizeSubject(item.subject)}|${lower(text(item.day))}`));
    for (const canonical of canonicalSchedules) {
      const key = `${normalizeSubject(canonical.subject)}|${lower(text(canonical.day))}`;
      // Same subject on the same day is already on screen, whatever it came
      // from, so it is not added a second time.
      if (shownSubjects.has(key)) continue;
      shownSubjects.add(key);
      schedules.push({
        department: canonical.department || 'Not specified',
        course: canonical.course || canonical.section_course || 'Not specified',
        subject: canonical.subject,
        professor_name: canonical.professor_name,
        room_lab: canonical.room_lab || '',
        day: canonical.day,
        start_time: canonical.start_time || null,
        end_time: canonical.end_time || null,
        class_time: formatClassTime(`${canonical.start_time || ''} - ${canonical.end_time || ''}`.trim()) || null
      });
    }

    // Read the week in week order rather than in whatever order the rows came
    // back from the database.
    const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    schedules.sort((a, b) => {
      const dayDiff = dayOrder.findIndex(d => lower(d) === lower(text(a.day)))
        - dayOrder.findIndex(d => lower(d) === lower(text(b.day)));
      if (dayDiff !== 0 && !Number.isNaN(dayDiff)) return dayDiff;
      return lower(text(a.start_time || a.class_time)).localeCompare(lower(text(b.start_time || b.class_time)));
    });

    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, schedules });
  } catch (err) {
    console.error('Fetch Student Schedule Error:', err);
    return res.status(500).json({ success: false, message: err.sqlMessage || 'Failed to fetch student schedule' });
  }
};

exports.createSchedule = async (req, res) => {
  const {
    subject, subject_code, room, room_lab, section, section_course,
    department, course, day, startTime, start_time, endTime, end_time,
    time, teacher_id, teacherId, professor_name
  } = req.body;
  const finalSubject = text(subject || subject_code);
  const finalSection = text(section || section_course);
  const requestedCourse = text(course || finalSection);
  const finalDepartment = BSIT_DEPARTMENT;
  const finalCourse = BSIT_COURSE;
  const finalProfessorName = text(professor_name);
  const finalRoom = text(room || room_lab);
  const finalStartTime = text(startTime || start_time);
  const finalEndTime = text(endTime || end_time);

  if (!finalSubject || !finalDepartment || !requestedCourse || !finalProfessorName || !text(day) || !finalStartTime || !finalEndTime) {
    return res.status(400).json({ status: 'error', message: 'Subject, Course, Professor, Day, Start Time, and End Time are required.' });
  }
  if (!isBSITCourse(requestedCourse)) {
    return res.status(400).json({ status: 'error', message: 'Only BSIT schedules are allowed in this system.' });
  }
  const parsedRange = parseClassTime(`${finalStartTime} - ${finalEndTime}`);
  if (!parsedRange.startTime || !parsedRange.endTime) {
    return res.status(400).json({ status: 'error', message: 'Enter valid start and end times.' });
  }
  const [startHour, startMinute] = parsedRange.startTime.split(':').map(Number);
  const [endHour, endMinute] = parsedRange.endTime.split(':').map(Number);
  if (startHour * 60 + startMinute >= endHour * 60 + endMinute) {
    return res.status(400).json({ status: 'error', message: 'End time must be later than start time.' });
  }

  // The C worker does the insert, the class-list copy and the rules, in one go.
// If it is unavailable the original Node.js path below runs instead, so the
// page keeps working either way.
  const nativeCreated = await runScheduleWorker('create', {
    teacher_id: text(teacher_id || teacherId),
    professor_name: finalProfessorName,
    subject: finalSubject,
    course: text(course || finalSection),
    day: text(day),
    start: parsedRange.startTime,
    end: parsedRange.endTime,
    room: finalRoom
  });

  if (nativeCreated && nativeCreated.status === 'success') {
    if (req.io) req.io.emit('schedule_created', { id: nativeCreated.id });
    res.set('X-SIS-Schedule-Source', 'c-native-worker');
    return res.status(201).json({
      status: 'success',
      message: 'Schedule created successfully',
      id: nativeCreated.id
    });
  }
  if (nativeCreated && nativeCreated.code) {
    const [status, message] = SCHEDULE_FAILURE[nativeCreated.code] || [400, nativeCreated.message];
    return res.status(status).json({ status: 'error', message: nativeCreated.message || message });
  }

  let connection;
  try {
    await classListSync.ensureTables();
    const resolvedTeacherId = await resolveTeacherId(teacher_id || teacherId, finalProfessorName);

    // The C worker decides whether this professor is already busy at this time.
    // Without it two classes can be booked on top of each other. If the worker
    // is unavailable the save still goes ahead, so a missing worker can never
    // stop a professor from creating a schedule.
    const clash = await checkSchedule(resolvedTeacherId, text(day), parsedRange.startTime, parsedRange.endTime);
    if (clash && clash.conflict) {
      return res.status(409).json({
        status: 'error',
        message: clash.message || 'That professor already has a class at this time.',
        conflicts: clash.conflicts || []
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    const [result] = await connection.execute(`
      INSERT INTO class_schedules (
        teacher_id, subject, section_course, department, course, professor_name,
        room_lab, day, start_time, end_time, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [resolvedTeacherId, finalSubject, finalCourse, finalDepartment, finalCourse, finalProfessorName, finalRoom, text(day), parsedRange.startTime, parsedRange.endTime]);

    await classListSync.createFromSchedule({
      id: result.insertId,
      subject: finalSubject,
      department: finalDepartment,
      course: finalCourse,
      day: text(day),
      start_time: parsedRange.startTime,
      end_time: parsedRange.endTime,
      teacher_id: resolvedTeacherId,
      professor_name: finalProfessorName
    }, connection);
    await connection.commit();
    if (req.io) req.io.emit('schedule_created', { id: result.insertId });
    return res.status(201).json({ status: 'success', message: 'Schedule created successfully', id: result.insertId });
  } catch (err) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Database Insert Schedule Error:', err.sqlMessage || err);
    return res.status(500).json({ status: 'error', message: err.sqlMessage || 'Failed to insert schedule into database' });
  } finally {
    if (connection) connection.release();
  }
};

exports.updateSchedule = async (req, res) => {
  const scheduleId = Number(req.params.id);
  if (!Number.isInteger(scheduleId) || scheduleId < 1) {
    return res.status(400).json({ status: 'error', message: 'Schedule ID is required.' });
  }

  // The C worker applies the edit and keeps the class-list copy in step. Only the
  // fields the page actually sent are passed, so an omitted field keeps whatever
  // is stored. It refuses a move that would clash with another class.
  const nativeUpdated = await runScheduleWorker('update', {
    id: scheduleId,
    teacher_id: text(req.body.teacher_id || req.body.teacherId),
    professor_name: text(req.body.professor_name),
    subject: text(req.body.subject || req.body.subject_code),
    course: text(req.body.course || req.body.section || req.body.section_course),
    day: text(req.body.day),
    start: text(req.body.startTime || req.body.start_time),
    end: text(req.body.endTime || req.body.end_time),
    room: text(req.body.room || req.body.room_lab)
  });

  if (nativeUpdated && nativeUpdated.status === 'success') {
    await classListSync.syncScheduleCopies(scheduleId).catch(() => {});
    res.set('X-SIS-Schedule-Source', 'c-native-worker');
    if (req.io) req.io.emit('schedule_updated', { id: scheduleId });
    return res.status(200).json({
      status: 'success',
      message: 'Schedule updated successfully',
      id: scheduleId
    });
  }
  if (nativeUpdated && nativeUpdated.code) {
    const [status, message] = SCHEDULE_FAILURE[nativeUpdated.code] || [400, nativeUpdated.message];
    return res.status(status).json({ status: 'error', message: nativeUpdated.message || message });
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [existingRows] = await connection.execute('SELECT * FROM class_schedules WHERE id = ? LIMIT 1', [scheduleId]);

    
    if (!existingRows.length) {
      await connection.rollback();
      return res.status(404).json({ status: 'error', message: 'Schedule entry not found.' });
    }

    const existing = existingRows[0];
    const requestedCourse = text(req.body.course || req.body.section || req.body.section_course) || existing.course || existing.section_course;
    if (!isBSITCourse(requestedCourse)) {
      await connection.rollback();
      return res.status(400).json({ status: 'error', message: 'Only BSIT schedules are allowed in this system.' });
    }
    const finalSubject = text(req.body.subject || req.body.subject_code) || existing.subject;
    const finalDepartment = BSIT_DEPARTMENT;
    const finalCourse = BSIT_COURSE;
    const finalDay = text(req.body.day) || existing.day;
    const finalRoom = text(req.body.room || req.body.room_lab) || existing.room_lab;
    const finalProfessorName = text(req.body.professor_name) || existing.professor_name || 'Professor not assigned';
    const professorWasSubmitted = Boolean(text(req.body.professor_name));
    const requestedTeacherId = text(req.body.teacher_id || req.body.teacherId) || (professorWasSubmitted ? '' : existing.teacher_id);
    const requestedStart = text(req.body.startTime || req.body.start_time);
    const requestedEnd = text(req.body.endTime || req.body.end_time);
    if (!requestedStart || !requestedEnd) {
      await connection.rollback();
      return res.status(400).json({ status: 'error', message: 'Start time and end time are required.' });
    }

    const parsedRange = parseClassTime(`${requestedStart} - ${requestedEnd}`);
    if (!parsedRange.startTime || !parsedRange.endTime) {
      await connection.rollback();
      return res.status(400).json({ status: 'error', message: 'Enter valid start and end times.' });
    }
    const [startHour, startMinute] = parsedRange.startTime.split(':').map(Number);
    const [endHour, endMinute] = parsedRange.endTime.split(':').map(Number);
    if (startHour * 60 + startMinute >= endHour * 60 + endMinute) {
      await connection.rollback();
      return res.status(400).json({ status: 'error', message: 'End time must be later than start time.' });
    }

    const resolvedTeacherId = await resolveTeacherId(requestedTeacherId, finalProfessorName, connection);
    const finalTeacherId = resolvedTeacherId || requestedTeacherId;
    const displayTime = formatClassTime(`${parsedRange.startTime} - ${parsedRange.endTime}`);

    // Same clash check as creating a schedule. The id of the row being edited is
    // passed along so a schedule does not collide with itself when only the
    // subject or the room is being changed.
    const clash = await checkSchedule(finalTeacherId, finalDay, parsedRange.startTime, parsedRange.endTime, scheduleId);
    if (clash && clash.conflict) {
      await connection.rollback();
      return res.status(409).json({
        status: 'error',
        message: clash.message || 'That professor already has a class at this time.',
        conflicts: clash.conflicts || []
      });
    }

    await connection.execute(`
      UPDATE class_schedules
      SET teacher_id = ?, subject = ?, section_course = ?, department = ?, course = ?,
          professor_name = ?, room_lab = ?, day = ?, start_time = ?, end_time = ?
      WHERE id = ?
    `, [finalTeacherId, finalSubject, finalCourse, finalDepartment, finalCourse, finalProfessorName, finalRoom, finalDay, parsedRange.startTime, parsedRange.endTime, scheduleId]);

    const [sourceLists] = await connection.execute(
      'SELECT id FROM class_list_schedules WHERE source_schedule_id = ?',
      [scheduleId]
    );
    let classListIds = sourceLists.map(row => Number(row.id)).filter(id => Number.isInteger(id) && id > 0);
    if (!classListIds.length) {
      const [matchingLists] = await connection.execute(`
        SELECT id
        FROM class_list_schedules
        WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?))
          AND LOWER(TRIM(course)) = LOWER(TRIM(?))
          AND LOWER(TRIM(day)) = LOWER(TRIM(?))
        ORDER BY id DESC
      `, [existing.subject, existing.course || existing.section_course, existing.day]);
      const candidateIds = matchingLists.map(row => Number(row.id)).filter(id => Number.isInteger(id) && id > 0);
      if (candidateIds.length) {
        const placeholders = candidateIds.map(() => '?').join(',');
        const [owned] = await connection.execute(
          `SELECT id FROM class_list_schedules WHERE source_schedule_id = ? AND id IN (${placeholders})`,
          [scheduleId, ...candidateIds]
        );
        const ownedIds = new Set(owned.map(row => Number(row.id)));
        classListIds = candidateIds.filter(id => !ownedIds.has(id));
      }
    }

    let studentIds = [];
    if (classListIds.length) {
      const placeholders = classListIds.map(() => '?').join(',');
      const [assignedStudents] = await connection.execute(
        `SELECT DISTINCT student_id FROM class_list_students WHERE class_list_schedule_id IN (${placeholders})`,
        classListIds
      );
      studentIds = assignedStudents.map(row => Number(row.student_id)).filter(id => Number.isInteger(id) && id > 0);
      await connection.execute(`
        UPDATE class_list_schedules
        SET source_schedule_id = ?, subject = ?, section_course = ?, department = ?, course = ?,
            day = ?, class_time = ?, teacher_id = ?, professor_name = ?
        WHERE id IN (${placeholders})
      `, [scheduleId, finalSubject, finalCourse, finalDepartment, finalCourse, finalDay, displayTime, finalTeacherId, finalProfessorName, ...classListIds]);
      await connection.execute(`
        UPDATE students s
        INNER JOIN class_list_students link ON link.student_id = s.id
        SET s.course = ?, s.teacher_id = ?, s.day = ?, s.class_time = ?
        WHERE link.class_list_schedule_id IN (${placeholders})
      `, [finalCourse, finalTeacherId || null, finalDay, displayTime, ...classListIds]);
    }

    await connection.commit();
    if (req.io) {
      req.io.emit('schedule_updated', {
        id: scheduleId,
        class_list_schedule_ids: classListIds,
        student_ids: studentIds
      });
    }
    return res.json({ status: 'success', success: true, message: 'Schedule updated successfully.' });
  } catch (err) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Update schedule error:', err);
    return res.status(500).json({ status: 'error', message: err.sqlMessage || 'Failed to update schedule.' });
  } finally {
    if (connection) connection.release();
  }
};

exports.deleteSchedule = async (req, res) => {
  const scheduleId = Number(req.params.id);
  if (!Number.isInteger(scheduleId) || scheduleId < 1) return res.status(400).json({ status: 'error', message: 'Schedule ID is required.' });

  // The C worker removes the schedule, its class-list copies and the links that
  // tied students to them, in one transaction. It hands back which students were
  // involved, so their own records can be refreshed afterwards. That part stays
  // in Node.js because it is about student records, not the timetable.
  const nativeDeleted = await runScheduleWorker('delete', { id: scheduleId });
  if (nativeDeleted && nativeDeleted.status === 'success') {
    const studentIds = (nativeDeleted.student_ids || []).map(Number).filter(Number.isInteger);
    if (studentIds.length) {
      await classListSync.syncStudentScheduleFields(db, studentIds).catch(() => {});
      await classListSync.deactivateUnassignedStudents(db, studentIds).catch(() => {});
    }
    res.set('X-SIS-Schedule-Source', 'c-native-worker');
    if (req.io) req.io.emit('schedule_deleted', { id: scheduleId, student_ids: studentIds });
    return res.status(200).json({
      status: 'success',
      success: true,
      message: 'Schedule deleted successfully',
      id: scheduleId
    });
  }

  let connection;
  try {
    await classListSync.ensureTables();
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [classLists] = await connection.execute(
      'SELECT id FROM class_list_schedules WHERE source_schedule_id = ? FOR UPDATE',
      [scheduleId]
    );
    const classListIds = classLists.map(row => row.id);
    const placeholders = classListIds.length ? classListIds.map(() => '?').join(',') : null;
    let assignedStudents = [];
    if (placeholders) {
      const [rows] = await connection.execute(
        `SELECT DISTINCT student_id FROM class_list_students WHERE class_list_schedule_id IN (${placeholders})`,
        classListIds
      );
      assignedStudents = rows;
      await connection.execute(
        `DELETE FROM class_list_students WHERE class_list_schedule_id IN (${placeholders})`,
        classListIds
      );
      await connection.execute(
        `DELETE FROM class_list_schedules WHERE id IN (${placeholders})`,
        classListIds
      );
    }

    await connection.execute(
      'DELETE FROM schedule_student_assignments WHERE schedule_id = ?',
      [scheduleId]
    ).catch(error => {
      if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
    });
    const [result] = await connection.execute('DELETE FROM class_schedules WHERE id = ?', [scheduleId]);
    if (!result.affectedRows) {
      await connection.commit();
      return res.status(200).json({
        status: 'success',
        success: true,
        already_deleted: true,
        message: 'Schedule was already removed.'
      });
    }

    const studentIds = assignedStudents.map(row => row.student_id);
    await classListSync.syncStudentScheduleFields(connection, studentIds);
    await classListSync.deactivateUnassignedStudents(connection, studentIds);
    await connection.commit();
    if (req.io) req.io.emit('schedule_deleted', { id: scheduleId, student_ids: studentIds });
    return res.status(200).json({
      status: 'success',
      success: true,
      message: 'Schedule deleted. Students were kept and their schedule assignments were updated.',
      updated_students: studentIds.length
    });
  } catch (err) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Delete Schedule DB Error:', err);
    return res.status(500).json({ status: 'error', message: 'Unable to delete the schedule.' });
  } finally {
    if (connection) connection.release();
  }
};

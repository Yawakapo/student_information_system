  const db = require('../config/db');
  const { formatClassTime } = require('../utils/time');
  const { isValidBirthday, normalizeImportRows, normalizeProfessor } = require('../utils/studentImport');
  const { getDashboardMetrics, getUnassignedStudentList, runStudentChecker } = require('../services/nativeService');
  const { BSIT_COURSE, BSIT_DEPARTMENT, isBSITCourse, isBSITDepartment } = require('../config/scope');

  const text = (value) => String(value ?? '').trim();
  const lower = (value) => text(value).toLowerCase();
  const allowedStatuses = new Set(['Active', 'Dropped', 'Graduated', 'Shifted', 'Inactive']);

  const findStudent = async (identifier, connection = db) => {
    const value = text(identifier);
    if (!value) return null;

    const [byNumber] = await connection.execute(
      'SELECT * FROM students WHERE student_no = ? LIMIT 1',
      [value]
    );
    if (byNumber.length) return byNumber[0];

    if (/^\d+$/.test(value)) {
      const [byId] = await connection.execute('SELECT * FROM students WHERE id = ? LIMIT 1', [Number(value)]);
      if (byId.length) return byId[0];
    }
    return null;
  };

 
  exports.getUnassignedStudents = async (req, res) => {
    try {
      
      const nativeReply = await getUnassignedStudentList();
      const nativeRows = Array.isArray(nativeReply)
        ? nativeReply
        : (nativeReply && Array.isArray(nativeReply.students) ? nativeReply.students : null);

      let rows = nativeRows;
      let source = 'c-native-worker';
      if (!rows) {
        source = 'nodejs-fallback';
        [rows] = await db.execute(`
          SELECT s.id, s.student_no, s.first_name, s.last_name, s.year_level,
                s.course, s.department, s.status, s.day, s.class_time, s.teacher_id,
                u.id AS user_account_id, u.user_id AS account_username, u.status AS account_status,
                (SELECT COUNT(*) FROM class_list_students link WHERE link.student_id = s.id) AS class_list_count
          FROM students s
          LEFT JOIN users u ON u.id = s.user_account_id
          WHERE s.teacher_id IS NULL
            OR TRIM(s.teacher_id) = ''
            OR NOT EXISTS (
                  SELECT 1 FROM teachers t
                  WHERE LOWER(TRIM(t.teacher_id)) = LOWER(TRIM(s.teacher_id))
                )
          ORDER BY s.last_name, s.first_name, s.student_no
        `);
      }
     
      
      res.set('X-SIS-Student-Source', source);
      return res.json((rows || []).map(row => ({
        ...row,
        class_list_count: Number(row.class_list_count) || 0
      })));
    } catch (error) {
      console.error('Fetch unassigned students error:', error);
      return res.status(500).json({ status: 'error', message: 'Unable to load students without a professor.' });
    }
  };

  exports.getStudents = async (req, res) => {
    try {
      const query = req.query || {};
      const teacherId = req.user?.role === 'teacher' || req.user?.role === 'faculty'
        ? text(req.user.user_id)
        : text(query.teacher_id || query.teacher_user_id);
      const params = [];
      let where = '';
      if (teacherId) {
        where = `WHERE EXISTS (
          SELECT 1
          FROM class_list_students teacher_link
          INNER JOIN class_list_schedules teacher_list ON teacher_list.id = teacher_link.class_list_schedule_id
          LEFT JOIN teachers teacher_record ON LOWER(TRIM(teacher_record.teacher_id)) = LOWER(TRIM(teacher_list.teacher_id))
          LEFT JOIN users teacher_user ON teacher_user.id = teacher_record.user_account_id
          WHERE teacher_link.student_id = s.id
            AND (
              LOWER(TRIM(s.teacher_id)) = LOWER(?)
              OR LOWER(TRIM(teacher_list.teacher_id)) = LOWER(?)
              OR LOWER(TRIM(teacher_list.professor_name)) = LOWER(?)
              OR LOWER(TRIM(teacher_record.teacher_id)) = LOWER(?)
              OR LOWER(TRIM(teacher_user.user_id)) = LOWER(?)
              OR LOWER(TRIM(CONCAT_WS(' ', teacher_record.first_name, teacher_record.middle_name, teacher_record.last_name))) = LOWER(?)
            )
        )`;
        params.push(teacherId, teacherId, teacherId, teacherId, teacherId, teacherId);
      }
      const [results] = await db.query(`SELECT DISTINCT s.* FROM students s ${where} ORDER BY s.id DESC`, params);
      return res.json((results || []).filter(student => isBSITCourse(student.course)));
    } catch (err) {
      console.error('Fetch Students Error:', err);
      return res.status(500).json({ status: 'error', message: 'Failed to fetch students' });
    }
  };

  exports.addStudent = async (req, res) => {
    const {
      user_account_id,
      student_no,
      department,
      course,
      first_name,
      last_name,
      year_level,
      gender,
      day,
      class_time,
      time_period,
      birthday,
      address,
      contact_number,
      emergency_contact_number,
      teacher_id,
      class_list_schedule_id,
      class_list_schedule_ids,
      status
    } = req.body;

    const finalStudentNo = text(student_no || user_account_id);
    const requestedStatus = text(status) || 'Active';
    const requestedCourse = text(course);
    const finalCourse = BSIT_COURSE;
    const finalDepartment = BSIT_DEPARTMENT;

    // The four rules about the details themselves live in
    // backend/check_student.c: every required detail filled in, the course is
    // BSIT, nothing longer than its column, and the student number is free.
    // Node asks and reports the refusal; it does not repeat the decision.
    if (!allowedStatuses.has(requestedStatus)) {
      return res.status(400).json({ status: 'error', message: 'Invalid student status.' });
    }
    if (!/^(1st|2nd|3rd|4th) Year$/i.test(text(year_level))) {
      return res.status(400).json({ status: 'error', message: 'Use 1st Year, 2nd Year, 3rd Year, or 4th Year.' });
    }
    if (!isValidBirthday(text(birthday))) {
      return res.status(400).json({ status: 'error', message: 'Use a valid birthday in YYYY-MM-DD format.' });
    }

    const verdict = await runStudentChecker({
      student_no: finalStudentNo,
      first_name: text(first_name),
      last_name: text(last_name),
      year_level: text(year_level),
      gender: text(gender),
      birthday: text(birthday),
      address: text(address),
      contact_number: text(contact_number),
      emergency_contact: text(emergency_contact_number),
      course: requestedCourse
    });
    if (verdict && verdict.status !== 'success') {
      const status = verdict.code === 'duplicate' ? 409 : 400;
      return res.status(status).json({ status: 'error', message: verdict.message });
    }

    let connection;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();

      let validAccountId = null;
      if (req.user?.role === 'student') {
        validAccountId = Number(req.user.userId);
        const [accountRows] = await connection.execute('SELECT id, user_id FROM users WHERE id = ? LIMIT 1', [validAccountId]);
        if (!accountRows.length) {
          await connection.rollback();
          return res.status(401).json({ status: 'error', message: 'Your account could not be found.' });
        }
        const [existingStudents] = await connection.execute('SELECT id FROM students WHERE user_account_id = ? LIMIT 1', [validAccountId]);
        if (existingStudents.length) {
          await connection.rollback();
          return res.status(409).json({ status: 'error', message: 'Your student profile already exists.' });
        }
      } else if (req.user?.role === 'admin' && user_account_id) {
        const [accountRows] = await connection.execute(
          'SELECT id FROM users WHERE user_id = ? OR email = ? OR CAST(id AS CHAR) = ? LIMIT 1',
          [text(user_account_id), text(user_account_id), text(user_account_id)]
        );
        if (accountRows.length) validAccountId = accountRows[0].id;
      }

      const requestedClassListIds = [...new Set((Array.isArray(class_list_schedule_ids)
        ? class_list_schedule_ids
        : [class_list_schedule_id])
        .map(value => Number(value))
        .filter(value => Number.isInteger(value) && value > 0))];
      if (!requestedClassListIds.length) {
        await connection.rollback();
        return res.status(400).json({ status: 'error', message: 'Select at least one class-list schedule before adding the student.' });
      }

      const schedulePlaceholders = requestedClassListIds.map(() => '?').join(',');
      const [selectedSchedules] = await connection.execute(
        `SELECT id, course, department, teacher_id, professor_name, day, class_time
        FROM class_list_schedules
        WHERE id IN (${schedulePlaceholders})`,
        requestedClassListIds
      );
      if (selectedSchedules.length !== requestedClassListIds.length) {
        await connection.rollback();
        return res.status(400).json({ status: 'error', message: 'One or more selected class-list schedules do not exist.' });
      }
      if (selectedSchedules.some(schedule => !isBSITCourse(schedule.course) || !isBSITDepartment(schedule.department))) {
        await connection.rollback();
        return res.status(400).json({ status: 'error', message: 'Only BSIT class-list schedules can be assigned.' });
      }
      const selectedSchedule = selectedSchedules[0];

      // The student number was already checked by check_student.c before the
      // transaction began. The row is locked here only so that two requests
      // saving the same number at the same moment cannot both get past it.

      const finalClassTime = formatClassTime(selectedSchedule?.class_time || class_time);
      const finalTimePeriod = /pm/i.test(finalClassTime) ? 'PM' : 'AM';
      const [result] = await connection.execute(`
        INSERT INTO students (
          user_account_id, teacher_id, student_no, department, course, first_name, last_name, year_level,
          gender, day, class_time, time_period, birthday, address, contact_number,
          emergency_contact_number, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        validAccountId,
        text(selectedSchedule?.teacher_id) || null,
        finalStudentNo,
        finalDepartment,
        finalCourse,
        text(first_name),
        text(last_name),
        text(year_level) || '1st Year',
        text(gender) || 'Male',
        text(selectedSchedule?.day) || 'Monday',
        finalClassTime,
        finalTimePeriod,
        birthday || null,
        text(address),
        text(contact_number),
        text(emergency_contact_number),
        requestedStatus
      ]);

      for (const schedule of selectedSchedules) {
        await connection.execute(
          'INSERT INTO class_list_students (class_list_schedule_id, student_id) VALUES (?, ?)',
          [schedule.id, result.insertId]
        );
      }

      await connection.commit();
      const newStudentPayload = {
        id: result.insertId,
        user_account_id: validAccountId,
        teacher_id: text(selectedSchedule?.teacher_id) || null,
        teacher_ids: selectedSchedules.map(schedule => text(schedule.teacher_id) || null).filter(Boolean),
        class_list_schedule_ids: selectedSchedules.map(schedule => schedule.id),
        student_no: finalStudentNo,
        department: finalDepartment,
        course: finalCourse,
        first_name: text(first_name),
        last_name: text(last_name),
        year_level: text(year_level) || '1st Year',
        gender: text(gender) || 'Male',
        day: text(selectedSchedule?.day) || 'Monday',
        class_time: finalClassTime,
        time_period: finalTimePeriod,
        birthday: birthday || null,
        address: text(address),
        contact_number: text(contact_number),
        emergency_contact_number: text(emergency_contact_number),
        status: requestedStatus
      };

      if (req.io) req.io.emit('new_student_registered', newStudentPayload);
      return res.status(201).json({
        status: 'success',
        success: true,
        message: selectedSchedules.length > 1
          ? `Student registered with ${selectedSchedules.length} schedules.`
          : 'Student registered successfully.',
        id: result.insertId,
        class_list_schedule_ids: selectedSchedules.map(schedule => schedule.id)
      });
    } catch (err) {
      if (connection) await connection.rollback().catch(() => {});
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ status: 'error', message: 'A student with this student number already exists.' });
      }
      console.error('Database Insert Student Error:', err);
      return res.status(500).json({ status: 'error', message: 'Unable to register the student.' });
    } finally {
      if (connection) connection.release();
    }
  };

  exports.importStudents = async (req, res) => {
    const sourceRows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!sourceRows.length) return res.status(400).json({ status: 'error', message: 'No student rows were provided.' });
    if (sourceRows.length > 500) return res.status(413).json({ status: 'error', message: 'A maximum of 500 students can be imported at once.' });

    const { rows, errors } = normalizeImportRows(sourceRows);

    if (errors.length) return res.status(422).json({ status: 'error', imported: 0, errors: errors.slice(0, 50) });

    let connection;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      const importedIds = [];
      const assignedStudentIds = new Set();
      const existingStudentIds = new Set();
      const linkedExistingStudentIds = new Set();
      let assignedScheduleCount = 0;
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const rowNumber = index + 2;
        const requestedScheduleIds = [...new Set((Array.isArray(row.class_list_schedule_ids)
          ? row.class_list_schedule_ids
          : [row.class_list_schedule_id])
          .map(value => Number(value))
          .filter(value => Number.isInteger(value) && value > 0))];
        let schedules = [];
        if (requestedScheduleIds.length) {
          const placeholders = requestedScheduleIds.map(() => '?').join(',');
          const [scheduleRows] = await connection.execute(`
            SELECT id, course, department, teacher_id, professor_name, day, class_time
            FROM class_list_schedules
            WHERE id IN (${placeholders})
            FOR UPDATE
          `, requestedScheduleIds);
          if (scheduleRows.length !== requestedScheduleIds.length || scheduleRows.some(schedule => !isBSITCourse(schedule.course) || !isBSITDepartment(schedule.department))) {
            errors.push({ row: rowNumber, field: 'schedule', message: 'One or more selected BSIT class-list schedules were not found.' });
            continue;
          }
          if (row.professor) {
            const wantedProfessors = row.professor.split(/\s*(?:;|\||\r?\n)\s*/).map(normalizeProfessor).filter(Boolean);
            const professorMismatch = scheduleRows.some(schedule => {
              const actual = [schedule.professor_name, schedule.teacher_id].map(normalizeProfessor).filter(Boolean);
              return wantedProfessors.length && !wantedProfessors.some(wanted => actual.includes(wanted));
            });
            if (professorMismatch) {
              errors.push({ row: rowNumber, field: 'professor', message: 'Professor does not match one of the selected schedules.' });
              continue;
            }
          }
          schedules = scheduleRows;
        }
        const schedule = schedules[0] || null;
        const [existingRows] = await connection.execute(
          'SELECT id, first_name, last_name FROM students WHERE student_no = ? LIMIT 1 FOR UPDATE',
          [row.student_no]
        );
        const existingStudent = existingRows[0] || null;
        if (existingStudent) {
          const sameFirstName = lower(existingStudent.first_name) === lower(row.first_name);
          const sameLastName = lower(existingStudent.last_name) === lower(row.last_name);
          if (!sameFirstName || !sameLastName) {
            errors.push({ row: rowNumber, field: 'student_no', message: 'This student number belongs to different student details. Import was not changed.' });
            continue;
          }
          existingStudentIds.add(existingStudent.id);
        }

        let studentId = existingStudent?.id;
        if (!studentId) {
          const classTime = schedule ? formatClassTime(schedule.class_time) : '';
          const [result] = await connection.execute(`
            INSERT INTO students (
              user_account_id, teacher_id, student_no, department, course, first_name, last_name, year_level,
              gender, day, class_time, time_period, birthday, address, contact_number,
              emergency_contact_number, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
          `, [
            null,
            schedule ? text(schedule.teacher_id) || null : null,
            row.student_no,
            BSIT_DEPARTMENT,
            BSIT_COURSE,
            row.first_name,
            row.last_name,
            row.year_level,
            row.gender,
            schedule ? schedule.day : 'Unassigned',
            classTime || 'Not assigned',
            /pm/i.test(classTime) ? 'PM' : 'AM',
            row.birthday,
            row.address,
            row.contact_number,
            row.emergency_contact_number,
            'Active'
          ]);
          studentId = result.insertId;
          importedIds.push(studentId);
        }

        if (schedules.length) {
          for (const assignedSchedule of schedules) {
            const [assignment] = await connection.execute(
              'INSERT IGNORE INTO class_list_students (class_list_schedule_id, student_id) VALUES (?, ?)',
              [assignedSchedule.id, studentId]
            );
            assignedScheduleCount += assignment.affectedRows;
          }
          assignedStudentIds.add(studentId);
          if (existingStudent) linkedExistingStudentIds.add(studentId);
        }
      }

      if (errors.length) {
        await connection.rollback();
        return res.status(422).json({ status: 'error', imported: 0, errors: errors.slice(0, 50) });
      }
      await connection.commit();
      if (req.io) req.io.emit('students_imported', { count: importedIds.length, existing: existingStudentIds.size });
      const unassignedCount = importedIds.filter(studentId => !assignedStudentIds.has(studentId)).length;
      const existingMessage = linkedExistingStudentIds.size
        ? ` ${linkedExistingStudentIds.size} existing student${linkedExistingStudentIds.size === 1 ? '' : 's'} kept and linked to the selected schedule${linkedExistingStudentIds.size === 1 ? '' : 's'}.`
        : existingStudentIds.size
          ? ` ${existingStudentIds.size} existing student${existingStudentIds.size === 1 ? '' : 's'} already existed and ${existingStudentIds.size === 1 ? 'was' : 'were'} left unchanged.`
          : '';
      return res.status(201).json({
        status: 'success',
        success: true,
        imported: importedIds.length,
        existingStudents: existingStudentIds.size,
        linkedExistingStudents: linkedExistingStudentIds.size,
        assignedToClassList: assignedStudentIds.size,
        assignedSchedules: assignedScheduleCount,
        awaitingSchedule: unassignedCount,
        message: `${importedIds.length} new student${importedIds.length === 1 ? '' : 's'} imported successfully.${existingMessage}${unassignedCount ? ` ${unassignedCount} still need a class-list schedule.` : ''}`
      });
    } catch (err) {
      if (connection) await connection.rollback().catch(() => {});
      console.error('Import students error:', err);
      return res.status(500).json({ status: 'error', message: 'Unable to import students.' });
    } finally {
      if (connection) connection.release();
    }
  };

  exports.getDashboardCounts = async (_req, res) => {
    try {
      const nativeMetrics = await getDashboardMetrics();
      const nativeSummary = nativeMetrics
        && ['totalStudents', 'activeStudents', 'shiftedStudents', 'droppedStudents'].every(key => Number.isFinite(Number(nativeMetrics[key])))
        ? nativeMetrics
        : null;
      let summary = nativeSummary;
      if (!summary) {
        const [summaryRows] = await db.query(`
          SELECT
            COUNT(DISTINCT s.id) AS allStudents,
            COUNT(DISTINCT CASE WHEN cls.id IS NOT NULL THEN s.id END) AS totalStudents,
            COUNT(DISTINCT CASE WHEN cls.id IS NOT NULL AND LOWER(TRIM(s.status)) = 'active' THEN s.id END) AS activeStudents,
            COUNT(DISTINCT CASE WHEN cls.id IS NOT NULL AND LOWER(TRIM(s.status)) = 'shifted' THEN s.id END) AS shiftedStudents,
            COUNT(DISTINCT CASE WHEN cls.id IS NOT NULL AND LOWER(TRIM(s.status)) = 'dropped' THEN s.id END) AS droppedStudents,
            COUNT(DISTINCT CASE WHEN cls.id IS NULL THEN s.id END) AS unassignedStudents
          FROM students s
          LEFT JOIN class_list_students link ON link.student_id = s.id
          LEFT JOIN class_list_schedules cls ON cls.id = link.class_list_schedule_id
          WHERE LOWER(REPLACE(REPLACE(TRIM(s.course), ' ', ''), '-', '')) LIKE 'bsit%'
        `);
        summary = summaryRows[0] || {};
      }

      const [courseRows] = await db.query(`
        SELECT
          COALESCE(NULLIF(TRIM(cls.course), ''), NULLIF(TRIM(cls.section_course), ''), 'BSIT') AS course,
          COUNT(DISTINCT link.student_id) AS studentCount
        FROM class_list_students link
        INNER JOIN class_list_schedules cls ON cls.id = link.class_list_schedule_id
        INNER JOIN students s ON s.id = link.student_id
        GROUP BY COALESCE(NULLIF(TRIM(cls.course), ''), NULLIF(TRIM(cls.section_course), ''), 'BSIT')
        ORDER BY course
      `);

      const courseDistribution = (courseRows || [])
        .filter(row => isBSITCourse(row.course))
        .map(row => ({ course: row.course, students: Number(row.studentCount) || 0 }));

      return res.json({
        totalStudents: Number(summary.totalStudents) || 0,
        activeStudents: Number(summary.activeStudents) || 0,
        shiftedStudents: Number(summary.shiftedStudents) || 0,
        droppedStudents: Number(summary.droppedStudents) || 0,
        courseDistribution,
        metricsSource: nativeSummary ? 'c-native-worker' : 'nodejs-fallback'
      });
    } catch (err) {
      console.error('Fetch Dashboard Counts Error:', err);
      return res.status(500).json({ status: 'error', message: 'Failed to fetch dashboard metrics' });
    }
  };

  exports.getPendingStudents = async (_req, res) => {
    try {
      const [results] = await db.query(`
        SELECT DISTINCT u.id, u.user_id, u.email, u.role, u.approval_status, u.created_at
        FROM users u
        INNER JOIN students s ON s.user_account_id = u.id
        WHERE u.role = 'student'
          AND u.approval_status IN ('pending', 'rejected')
          AND LOWER(REPLACE(REPLACE(TRIM(s.course), ' ', ''), '-', '')) LIKE 'bsit%'
        ORDER BY u.created_at DESC
      `);
      return res.json(results || []);
    } catch (err) {
      console.error('[ERROR] Failed to fetch pending students:', err);
      return res.status(500).json({ status: 'error', message: 'Failed to fetch pending students' });
    }
  };

  exports.updateApprovalStatus = async (req, res) => {
    const studentIdentifier = text(req.params.id || req.body.studentId || req.body.user_id || req.body.id || req.body.student_no);
    const status = lower(req.body.status || req.body.approval_status || 'approved');
    const normalizedStatus = status === 'approved' ? 'accepted' : status === 'rejected' ? 'rejected' : '';
    if (!studentIdentifier || !normalizedStatus) {
      return res.status(400).json({ status: 'error', message: 'A student identifier and approved/rejected status are required.' });
    }

    try {
      if (normalizedStatus === 'accepted') {
        const [eligible] = await db.execute(`
          SELECT u.id
          FROM users u
          INNER JOIN students s ON s.user_account_id = u.id
          INNER JOIN class_list_students link ON link.student_id = s.id
          INNER JOIN class_list_schedules cls ON cls.id = link.class_list_schedule_id
          WHERE u.role = 'student' AND (u.user_id = ? OR u.email = ? OR CAST(u.id AS CHAR) = ?)
            AND LOWER(COALESCE(s.status, 'active')) = 'active'
            AND LOWER(REPLACE(REPLACE(TRIM(s.course), ' ', ''), '-', '')) LIKE 'bsit%'
          LIMIT 1
        `, [studentIdentifier, studentIdentifier, studentIdentifier]);
        if (!eligible.length) {
          return res.status(409).json({ status: 'error', message: 'Assign the student to a class list before approving the account.' });
        }
      }
      const [result] = await db.execute(`
        UPDATE users
        SET approval_status = ?
        WHERE role = 'student' AND (user_id = ? OR email = ? OR CAST(id AS CHAR) = ?)
      `, [normalizedStatus, studentIdentifier, studentIdentifier, studentIdentifier]);
      if (!result.affectedRows) return res.status(404).json({ status: 'error', message: 'No matching student account found.' });
      return res.json({ status: 'success', success: true, message: `Student registration ${status} successfully` });
    } catch (err) {
      console.error('[ERROR] Update Approval Status Failed:', err);
      return res.status(500).json({ status: 'error', message: err.sqlMessage || err.message || 'Failed to update approval status' });
    }
  };

  exports.viewStudent = async (req, res) => {
    try {
      const student = await findStudent(req.query.id || req.query.student_no || req.params.id);
      if (!student) return res.status(404).json({ status: 'error', message: 'Student details not found' });
      return res.json(student);
    } catch (err) {
      console.error('Fetch student info error:', err);
      return res.status(500).json({ status: 'error', message: 'Database query failed' });
    }
  };

  exports.deleteStudent = async (req, res) => {
    const studentIdentifier = text(req.params.id);
    if (!studentIdentifier) return res.status(400).json({ status: 'error', message: 'Student ID is required' });

    let connection;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      const student = await findStudent(studentIdentifier, connection);
      if (!student) {
        await connection.rollback();
        return res.status(404).json({ status: 'error', message: 'Student not found' });
      }

      await connection.query('DELETE FROM schedule_student_assignments WHERE student_id = ?', [student.id]).catch(error => {
        if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
      });
      await connection.query('DELETE FROM class_list_students WHERE student_id = ?', [student.id]);
      await connection.query('DELETE FROM students WHERE id = ?', [student.id]);
      if (student.user_account_id) await connection.query('DELETE FROM users WHERE id = ?', [student.user_account_id]);
      await connection.commit();
      return res.json({ status: 'success', message: 'Student profile and account deleted successfully' });
    } catch (err) {
      if (connection) await connection.rollback().catch(() => {});
      console.error('Delete Student Error:', err);
      return res.status(500).json({ status: 'error', message: err.sqlMessage || 'Failed to delete student' });
    } finally {
      if (connection) connection.release();
    }
  };

  exports.checkStudentRegistrationStatus = async (req, res) => {
    const userId = text(req.params.userId);
    if (!userId || ['undefined', 'null'].includes(userId.toLowerCase())) return res.json({ isRegistered: false });

    try {
      const [rows] = await db.execute(`
        SELECT 1
        FROM students s
        LEFT JOIN users u ON u.id = s.user_account_id
        WHERE s.student_no = ?
          OR LOWER(TRIM(u.user_id)) = LOWER(?)
          OR CAST(s.user_account_id AS CHAR) = ?
        LIMIT 1
      `, [userId, userId, userId]);
      return res.json({ isRegistered: rows.length > 0 });
    } catch (err) {
      console.error('Check Student Registration Error:', err);
      return res.status(500).json({ status: 'error', message: 'Database query failed' });
    }
  };

  exports.updateStudentStatus = async (req, res) => {
    const studentId = text(req.params.id);
    const requestedStatus = text(req.body.status);
    const status = { active: 'Active', shifted: 'Shifted', dropped: 'Dropped' }[requestedStatus.toLowerCase()];
    if (!studentId || !status) return res.status(400).json({ status: 'error', message: 'Use Active, Shifted, or Dropped as the student status.' });

    try {
      const student = await findStudent(studentId);
      if (!student) return res.status(404).json({ status: 'error', message: 'Student record not found.' });
      await db.execute('UPDATE students SET status = ? WHERE id = ?', [status, student.id]);
      if (req.io) req.io.emit('student_status_updated', { id: student.id, status });
      return res.json({ status: 'success', success: true, message: 'Student status updated.' });
    } catch (err) {
      console.error('Update Student Status Error:', err);
      return res.status(500).json({ status: 'error', message: 'Failed to update student status.' });
    }
  };

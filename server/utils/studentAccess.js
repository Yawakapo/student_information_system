// Shared student-access rules. Used when a student signs in and when an admin
// tries to activate a student account, so it lives in one place.

/** True when the student is attached to at least one active class list. */
const studentHasClassList = async (connection, studentId) => {
  if (!studentId) return false;
  const [rows] = await connection.execute(`
    SELECT 1
    FROM class_list_students link
    INNER JOIN class_list_schedules cls ON cls.id = link.class_list_schedule_id
    WHERE link.student_id = ?
    LIMIT 1
  `, [studentId]);
  return rows.length > 0;
};

module.exports = { studentHasClassList };

const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const nativeDirectory = path.resolve(__dirname, '../../backend');
const warned = new Set();

const executableName = name => process.platform === 'win32' ? `${name}.exe` : name;

const runNative = async (name, args = [], timeout = 2500) => {
  const command = path.join(nativeDirectory, executableName(name));
  try {
    const { stdout } = await execFileAsync(command, args, {
      env: process.env,
      timeout,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    });
    return readAnswer(stdout);

  } catch (error) {
    // A program that says "no" still prints an answer and exits with a
    // non-zero code. That is a refusal, not a crash, so the printed answer is
    // used. Only a program that printed nothing counts as unavailable.
    if (error.stdout) return readAnswer(error.stdout);

    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`[NATIVE BACKEND] ${name} is unavailable; using the Node.js fallback.`);
    }
    return null;
  }
};

// Turns the printed lines into one object. The last line is the answer,
// because a program may print a notice before it.
const readAnswer = stdout => {
  const output = String(stdout || '').trim();
  if (!output) return null;
  try {
    return JSON.parse(output.split(/\r?\n/).filter(Boolean).at(-1));
  } catch {
    return null;
  }
};

const getDashboardMetrics = () => runNative('dashboard_counts');

// Purpose: list every schedule in the timetable. Backs the View schedule page.
const getScheduleList = () => runNative('view_schedules');

// Purpose: list the students who do not have a professor yet. Backs the
// "Assign Unassigned Students" panel on the View Students page.
const getUnassignedStudentList = () => runNative('unassigned_students');

// Purpose: decide whether a schedule may be saved, by checking the time range
// and looking for a professor who is already busy at that time.
// Usage: check_schedule <teacher_id> <day> <start> <end> [exclude_id]
const checkSchedule = (teacherId, day, startTime, endTime, excludeId = '') =>
  runNative('check_schedule', [
    String(teacherId ?? ''),
    String(day ?? ''),
    String(startTime ?? ''),
    String(endTime ?? ''),
    String(excludeId ?? '')
  ], 4000);

// Purpose: do the schedule database work. create, update, delete and list all
// live in backend/schedule_worker.c, which validates the rules and writes inside
// one transaction. Fields are passed as key=value pairs, so a value containing
// spaces has to arrive as a single argument.
const runScheduleWorker = (action, fields = {}) => {
  const args = [action];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    args.push(`${key}=${value}`);
  }
  return runNative('schedule_worker', args, 6000);
};

// Purpose: ask backend/check_student.c whether a student may be saved. The four
// rules live in C: every required detail filled in, the course is BSIT, nothing
// longer than its column, and the student number is not already taken.
const runStudentChecker = (fields = {}) => {
  const args = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    args.push(`${key}=${value}`);
  }
  return runNative('check_student', args, 6000);
};

// Purpose: read the professor list from backend/teachers_worker.c. Creating a
// professor stays in the controller, because it has to hash a password first.
const runTeacherWorker = (action, fields = {}) => {
  const args = [action];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    args.push(`${key}=${value}`);
  }
  return runNative('teachers_worker', args, 6000);
};

const getTeacherList = () => runTeacherWorker('list');

module.exports = {
  getDashboardMetrics,
  getScheduleList,
  getUnassignedStudentList,
  checkSchedule,
  runScheduleWorker,
  runTeacherWorker,
  getTeacherList,
  runStudentChecker,
  runNative
};

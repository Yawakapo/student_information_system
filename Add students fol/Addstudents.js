// =====================================================================
// ADD STUDENTS PAGE
//
// One job per function, in the order the page uses them:
//
//   1. start            the only automatic function; it wires the page up
//   2. loadPickers      asks the server for professors and schedules
//   3. drawProfessors   fills the professor list
//   4. drawSchedules    fills the schedule list for the chosen professors
//   5. addOneStudent    what the Add Student button does
//   6. readSpreadsheet  turns a chosen file into an array of rows
//   7. checkImportRows  the rules for a row that came from a spreadsheet
//   8. drawImportPreview shows the first few rows before they are saved
//   9. importStudents   saves the checked rows
//
// This file never decides whether a student may be saved. It asks the
// server, and it draws the answer the server gives.
// =====================================================================

const BSIT_COURSE = 'BSIT';
const BSIT_DEPARTMENT = 'School of Information Technology';
const REQUIRED_FIELDS = [
  ['student_no', 'Student number'],
  ['first_name', 'First name'],
  ['last_name', 'Last name'],
  ['year_level', 'Year'],
  ['gender', 'Gender'],
  ['birthday', 'Birthday'],
  ['address', 'Address'],
  ['contact_number', 'Number'],
  ['emergency_contact_number', 'Emergency contact number']
];

// The only information this page keeps while it is open.
const page = {
  professors: [],
  schedules: [],
  chosenProfessors: new Set(),
  chosenSchedules: new Set(),
  importRows: []
};

// The two ways a professor may be written in a spreadsheet heading or name.
const plainName = value => String(value || '').toLowerCase()
  .replace(/\b(prof|professor|profesora|atty|dr)\b/g, '')
  .replace(/[^a-z0-9]+/g, '');
const plainHeading = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const plainDepartment = value => String(value || '').trim().toLowerCase()
  .replace(/^(college|school) of computer studies$/, 'school of information technology');

const isBsit = value => /^bsit/i.test(String(value || '').trim());
const showTime = value => window.sisFormatClassTime?.(value) || value || 'Time not set';
const apiUrl = path => window.sisApiUrl?.(path) || path;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));
}

function showBanner(banner, message) {
  banner.textContent = message;
  banner.style.display = 'flex';
}

// ---------------------------------------------------------------------
// 1. START
// Reads the elements, hangs the buttons up, then loads the two pickers.
// ---------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', start);

async function start() {
  if ((localStorage.getItem('role') || '').toLowerCase() !== 'admin') {
    window.location.href = '../Login%20part/login.html';
    return;
  }

  const form = document.getElementById('addStudentForm');
  form.addEventListener('submit', handleSubmit);

  document.getElementById('professorOptions').addEventListener('change', onProfessorPicked);
  document.getElementById('scheduleOptions').addEventListener('change', onSchedulePicked);
  document.getElementById('studentImportFile').addEventListener('change', handleImportFile);
  document.getElementById('importStudentsButton').addEventListener('click', importStudents);

  // Another part of the system may add a professor or a schedule while this
  // page is open, so the two pickers are read again instead of the page.
  window.sisOnDataChange?.(() => {
    if (document.visibilityState !== 'visible') return;
    loadPickers().catch(() => {});
  });

  await loadPickers();
}

// ---------------------------------------------------------------------
// 2. LOAD PICKERS
// Two requests, drawn as soon as both arrive.
// ---------------------------------------------------------------------
async function loadPickers() {
  try {
    const [professorList, scheduleList] = await Promise.all([
      fetch(apiUrl('/api/teachers')).then(readingJson('professors')),
      fetch(apiUrl('/api/class-list-schedules')).then(readingJson('schedules'))
    ]);

    page.professors = professorList.sort(byName);
    page.schedules = scheduleList.sort(bySubjectThenDay);

    drawProfessors();
    drawSchedules();
  } catch (error) {
    document.getElementById('professorOptions').innerHTML =
      `<p class="multi-select-empty">Unable to load professors.</p>`;
    document.getElementById('scheduleOptions').innerHTML =
      `<p class="multi-select-empty">Unable to load schedules.</p>`;
    document.getElementById('scheduleHelp').textContent = error.message;
  }
}

function byName(first, second) {
  return String(first.full_name || '').localeCompare(String(second.full_name || ''));
}

function bySubjectThenDay(first, second) {
  const week = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return String(first.subject || '').localeCompare(String(second.subject || ''))
    || week.indexOf(String(first.day || '').toLowerCase()) - week.indexOf(String(second.day || '').toLowerCase());
}

// Turns a failed reply into a readable message instead of a raw status code.
function readingJson(whatFailed) {
  return response => {
    if (!response.ok) throw new Error(`Unable to load ${whatFailed}.`);
    return response.json();
  };
}

// ---------------------------------------------------------------------
// 3. DRAW THE PROFESSOR LIST
// Only active professors in the BSIT department are offered.
// ---------------------------------------------------------------------
function drawProfessors() {
  const box = document.getElementById('professorOptions');
  const bsit = plainDepartment(BSIT_DEPARTMENT);

  const matching = page.professors.filter(professor =>
    plainDepartment(professor.department) === bsit
    && String(professor.status || 'Active').toLowerCase() === 'active');

  // A tick that is no longer allowed is cleared, so a stale choice cannot be
  // sent to the server.
  const allowed = new Set(matching.map(professor => String(professor.teacher_id)));
  page.chosenProfessors = new Set([...page.chosenProfessors].filter(id => allowed.has(String(id))));

  if (!matching.length) {
    box.innerHTML = '<p class="multi-select-empty">No active BSIT professors were found.</p>';
    return;
  }

  box.innerHTML = matching.map(professor => {
    const ready = hasBsitSchedule(professor);
    const note = ready ? 'Schedules available' : 'No schedule assigned yet';
    return `<label class="multi-select-option">
      <input type="checkbox" data-professor-id="${escapeHtml(professor.teacher_id)}" ${isPicked('professor', professor.teacher_id) ? 'checked' : ''}>
      <span><strong>${escapeHtml(professor.full_name)}</strong><small>${escapeHtml(professor.teacher_id)} · ${note}</small></span>
    </label>`;
  }).join('');
}

function isPicked(kind, id) {
  if (kind === 'professor') return page.chosenProfessors.has(String(id));
  return page.chosenSchedules.has(String(id));
}

function hasBsitSchedule(professor) {
  return page.schedules.some(schedule =>
    belongsToProfessor(schedule, professor)
    && isBsit(schedule.course || schedule.section_course));
}

// A schedule belongs to a professor when the saved ids agree, or failing that
// when the two names read the same once the titles are taken off.
function belongsToProfessor(schedule, professor) {
  const scheduleId = String(schedule.teacher_id || '').trim().toLowerCase();
  if (!scheduleId) return false;
  return scheduleId === String(professor.teacher_id || '').trim().toLowerCase()
    || scheduleId === String(professor.user_account_id || '').trim().toLowerCase()
    || plainName(schedule.professor_name) === plainName(professor.full_name);
}

function onProfessorPicked(event) {
  const box = event.target.closest('input[data-professor-id]');
  if (!box) return;
  const id = String(box.dataset.professorId);
  if (box.checked) page.chosenProfessors.add(id);
  else page.chosenProfessors.delete(id);
  drawSchedules();
}

// ---------------------------------------------------------------------
// 4. DRAW THE SCHEDULE LIST
// Only the schedules of the professors just ticked, and only BSIT ones.
// ---------------------------------------------------------------------
function drawSchedules() {
  const box = document.getElementById('scheduleOptions');
  const help = document.getElementById('scheduleHelp');
  const chosen = chosenProfessors();

  if (!chosen.length) {
    page.chosenSchedules.clear();
    box.innerHTML = '<p class="multi-select-empty">Select a professor first</p>';
    help.textContent = 'Choose one or more BSIT professors first.';
    return;
  }

  const matching = page.schedules.filter(schedule =>
    chosen.some(professor => belongsToProfessor(schedule, professor))
    && plainDepartment(schedule.department) === plainDepartment(BSIT_DEPARTMENT)
    && isBsit(schedule.course || schedule.section_course));

  const allowed = new Set(matching.map(schedule => String(schedule.id)));
  page.chosenSchedules = new Set([...page.chosenSchedules].filter(id => allowed.has(String(id))));

  if (!matching.length) {
    box.innerHTML = '<p class="multi-select-empty">No schedules found for the selected professors.</p>';
  } else {
    box.innerHTML = matching.map(schedule => `<label class="multi-select-option">
      <input type="checkbox" data-schedule-id="${escapeHtml(schedule.id)}" ${isPicked('schedule', schedule.id) ? 'checked' : ''}>
      <span><strong>${escapeHtml(schedule.subject)}</strong><small>${escapeHtml(schedule.professor_name || schedule.teacher_id || 'Professor not assigned')} · ${escapeHtml(schedule.day || 'Day not set')} · ${escapeHtml(showTime(schedule.class_time))}</small></span>
    </label>`).join('');
  }

  const names = chosen.map(professor => professor.full_name).join(', ');
  const count = matching.length;
  help.textContent = count
    ? `${count} schedule${count === 1 ? '' : 's'} available for ${names}.`
    : `No schedules are currently assigned to ${names}.`;
}

function onSchedulePicked(event) {
  const box = event.target.closest('input[data-schedule-id]');
  if (!box) return;
  const id = String(box.dataset.scheduleId);
  if (box.checked) page.chosenSchedules.add(id);
  else page.chosenSchedules.delete(id);
}

function chosenProfessors() {
  return [...page.chosenProfessors]
    .map(id => page.professors.find(professor => String(professor.teacher_id) === String(id)))
    .filter(Boolean);
}

function chosenSchedules() {
  return [...page.chosenSchedules]
    .map(id => page.schedules.find(schedule => String(schedule.id) === String(id)))
    .filter(Boolean);
}

// ---------------------------------------------------------------------
// 5. ADD ONE STUDENT
// Checks that the form is filled in, then asks the server to save it.
// ---------------------------------------------------------------------
async function handleSubmit(event) {
  event.preventDefault();
  const success = document.getElementById('successMessage');
  const problem = document.getElementById('errorMessage');
  success.style.display = 'none';
  problem.style.display = 'none';

  // The same button imports a spreadsheet when one is waiting to be saved.
  if (page.importRows.length) {
    await importStudents();
    return;
  }

  const empty = REQUIRED_FIELDS.find(([id]) => !document.getElementById(id)?.value.trim());
  if (empty) {
    showBanner(problem, `${empty[1]} is required.`);
    document.getElementById(empty[0])?.focus();
    return;
  }

  const professors = chosenProfessors();
  if (!professors.length) {
    showBanner(problem, 'Choose at least one professor.');
    return;
  }

  const schedules = chosenSchedules();
  if (!schedules.length) {
    showBanner(problem, 'Choose at least one professor schedule.');
    return;
  }

  const wrong = schedules.find(schedule =>
    !professors.some(professor => belongsToProfessor(schedule, professor))
    || !isBsit(schedule.course || schedule.section_course));
  if (wrong) {
    showBanner(problem, 'Every selected schedule must be a BSIT schedule assigned to one of the selected professors.');
    return;
  }

  try {
    const reply = await fetch(apiUrl('/api/students'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildStudent(professors, schedules))
    });
    const result = await reply.json();
    if (!reply.ok) throw new Error(result.message || 'Unable to add student.');

    showBanner(success, result.message || 'Student added successfully.');
    document.getElementById('addStudentForm').reset();
    page.chosenProfessors.clear();
    page.chosenSchedules.clear();
    drawProfessors();
    drawSchedules();
    setTimeout(() => { window.location.href = '../View students fol/View students.html'; }, 1200);
  } catch (error) {
    showBanner(problem, error.message || 'Unable to add student.');
  }
}

// The shape the server expects. Course and department are not read from the
// form because this system has only one course.
function buildStudent(professors, schedules) {
  const main = schedules[0];
  const value = id => document.getElementById(id).value.trim();
  return {
    class_list_schedule_id: main.id,
    class_list_schedule_ids: schedules.map(schedule => schedule.id),
    teacher_id: main.teacher_id || professors[0].teacher_id,
    student_no: value('student_no'),
    course: BSIT_COURSE,
    first_name: value('first_name'),
    last_name: value('last_name'),
    year_level: document.getElementById('year_level').value,
    gender: document.getElementById('gender').value,
    day: main.day,
    class_time: main.class_time || '',
    time_period: '',
    birthday: document.getElementById('birthday').value,
    address: value('address'),
    contact_number: value('contact_number'),
    emergency_contact_number: value('emergency_contact_number'),
    status: 'Active'
  };
}

// ---------------------------------------------------------------------
// 6. READ A SPREADSHEET
// Accepts .csv and Excel. The CSV reader is written out here because a
// plain text file needs splitting before it can be read.
// ---------------------------------------------------------------------
const IMPORT_FIELDS = [
  ['student_no', ['student no', 'student number', 'student num', 'student id', 'id']],
  ['first_name', ['first name', 'given name']],
  ['last_name', ['last name', 'surname']],
  ['year_level', ['year', 'year level', 'level']],
  ['gender', ['gender', 'sex']],
  ['professor', ['professor', 'professor name', 'teacher']],
  ['schedule', ['professor schedule', 'schedule', 'schedule id', 'class list schedule']],
  ['schedules', ['professor schedules', 'schedules', 'schedule ids', 'class list schedules']],
  ['birthday', ['birthday', 'date of birth', 'birth date']],
  ['address', ['address', 'home address']],
  ['contact_number', ['number', 'contact number', 'phone', 'contact']],
  ['emergency_contact_number', ['emergency contact', 'emergency contact no', 'emergency contact number', 'emergency number']]
];

// The columns shown in the preview table, in the order they appear.
const PREVIEW_COLUMNS = [
  ['Student No.', 'student_no'], ['First Name', 'first_name'], ['Last Name', 'last_name'],
  ['Year', 'year_level'], ['Gender', 'gender'], ['Professors', 'professor'],
  ["Professors' Schedules", 'schedules'], ['Birthday', 'birthday'], ['Address', 'address'],
  ['Number', 'contact_number'], ['Emergency Contact No.', 'emergency_contact_number']
];

// A heading may be written in several ways, so each column lists what counts.
function cellFrom(row, field) {
  const allowed = IMPORT_FIELDS.find(([name]) => name === field)[1].map(plainHeading);
  const key = Object.keys(row).find(name => allowed.includes(plainHeading(name)));
  return key ? String(row[key] ?? '').trim() : '';
}

function readCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let at = 0; at < text.length; at += 1) {
    const character = text[at];
    // Two quote marks in a row inside a quoted cell mean one quote mark.
    if (character === '"' && quoted && text[at + 1] === '"') {
      value += '"';
      at += 1;
      continue;
    }
    if (character === '"') { quoted = !quoted; continue; }
    if (character === ',' && !quoted) { row.push(value.trim()); value = ''; continue; }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[at + 1] === '\n') at += 1;
      row.push(value.trim());
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
      continue;
    }
    value += character;
  }
  if (value || row.length) {
    row.push(value.trim());
    if (row.some(cell => cell !== '')) rows.push(row);
  }

  if (rows.length < 2) return [];
  const headings = rows.shift();
  return rows.map(cells => Object.fromEntries(headings.map((heading, at) => [heading, cells[at] || ''])));
}

function readSheet(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read the selected file.'));
    reader.onload = () => {
      try { resolve(turnFileIntoRows(file.name, reader.result)); }
      catch (error) { reject(error); }
    };
    if (file.name.toLowerCase().endsWith('.csv')) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}

function turnFileIntoRows(name, content) {
  if (name.toLowerCase().endsWith('.csv')) return readCsv(String(content || ''));
  if (!window.XLSX) throw new Error('Excel support could not be loaded. Please use a CSV file.');

  const book = window.XLSX.read(content, { type: 'array' });
  if (book.SheetNames.length !== 1) throw new Error('The workbook must contain exactly one worksheet.');
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new Error('The workbook has no worksheet.');

  // A cell holding a formula shows its result, not its working out, so the
  // file is refused rather than imported with the wrong values.
  const reach = window.XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  for (let row = reach.s.r; row <= reach.e.r; row += 1) {
    for (let column = reach.s.c; column <= reach.e.c; column += 1) {
      const cell = sheet[window.XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell?.f) throw new Error('Formula cells are not supported in the import file.');
    }
  }
  return window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

// ---------------------------------------------------------------------
// 7. CHECK THE ROWS THAT CAME FROM A FILE
// Returns the rows ready to save, plus one message per problem found.
// ---------------------------------------------------------------------
function checkImportRows(rows) {
  const problems = [];

  const checked = rows.map((source, at) => {
    const row = {};
    for (const [field] of IMPORT_FIELDS) row[field] = cellFrom(source, field);

    const line = at + 2;
    const wanted = splitList(row.schedules || row.schedule);
    const found = wanted.map(findSchedule);
    if (wanted.some((value, position) => !found[position])) {
      problems.push(`Row ${line}: select valid professor schedules.`);
    }
    for (const field of ['student_no', 'first_name', 'last_name', 'year_level', 'gender',
      'birthday', 'address', 'contact_number', 'emergency_contact_number']) {
      if (!row[field]) problems.push(`Row ${line}: ${field.replace(/_/g, ' ')} is required.`);
    }

    return {
      ...row,
      class_list_schedule_id: found[0]?.id || null,
      class_list_schedule_ids: found.filter(Boolean).map(schedule => schedule.id)
    };
  });

  return { checked, problems };
}

// A schedule may be named by its number, or by its subject and day.
function findSchedule(written) {
  if (!written) return null;

  const byNumber = page.schedules.find(schedule => String(schedule.id) === String(written));
  if (byNumber) return byNumber;

  const wanted = plainHeading(written);
  const matches = page.schedules.filter(schedule => {
    const label = plainHeading(`${schedule.subject} ${schedule.section_course || schedule.course} ${schedule.day} ${schedule.class_time} ${schedule.professor_name || schedule.teacher_id || ''}`);
    return label === wanted || label.includes(wanted) || wanted.includes(label);
  });
  // More than one match is refused, because guessing would import the wrong class.
  return matches.length === 1 ? matches[0] : null;
}

function splitList(value) {
  return String(value ?? '').split(/\s*(?:;|\||\r?\n)\s*/).map(item => item.trim()).filter(Boolean);
}

async function handleImportFile(event) {
  const button = document.getElementById('importStudentsButton');
  button.disabled = true;
  page.importRows = [];
  showImportState();
  hideImportPreview();

  const file = event.target.files[0];
  if (!file) return;

  const ending = file.name.toLowerCase().split('.').pop();
  if (!['xlsx', 'xls', 'csv'].includes(ending)) {
    say('Choose an .xlsx, .xls, or .csv file.', true);
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    say('The import file must be 5 MB or smaller.', true);
    return;
  }

  say('Reading file...');
  try {
    const rows = await readSheet(file);
    if (!rows.length) throw new Error('The file has no student rows.');

    const { checked, problems } = checkImportRows(rows);
    drawImportPreview(checked);

    if (problems.length) {
      say(problems.slice(0, 3).join(' '), true);
      return;
    }

    page.importRows = checked;
    showImportState();
    const count = checked.length;
    say(`${count} valid student${count === 1 ? '' : 's'} ready to import. Select professors and schedules below if needed, then click Import Students.`);
  } catch (error) {
    say(error.message || 'Unable to read the import file.', true);
  }
}

// ---------------------------------------------------------------------
// 8. SHOW THE ROWS BEFORE THEY ARE SAVED
// Only the first five, because the list can be long.
// ---------------------------------------------------------------------
function drawImportPreview(rows) {
  const box = document.getElementById('importPreview');
  if (!rows.length) { hideImportPreview(); return; }

  box.innerHTML = `<table><thead><tr>${PREVIEW_COLUMNS
    .map(([heading]) => `<th>${escapeHtml(heading)}</th>`).join('')}</tr></thead><tbody>${rows
    .slice(0, 5)
    .map(row => `<tr>${PREVIEW_COLUMNS
      .map(([, field]) => `<td>${escapeHtml(previewCell(row, field))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  box.hidden = false;
}

function previewCell(row, field) {
  if (field === 'schedules') {
    return row.class_list_schedule_ids.join('; ') || row.schedules || row.schedule;
  }
  return row[field] || '';
}

function hideImportPreview() {
  const box = document.getElementById('importPreview');
  box.hidden = true;
  box.innerHTML = '';
}

// The same button says "Add Student" or "Import 12 Students", depending on
// what it is about to do.
function showImportState() {
  const count = page.importRows.length;
  const label = count ? `Import ${count} Student${count === 1 ? '' : 's'}` : 'Import Students';
  document.getElementById('importStudentsButton').textContent = label;
  document.getElementById('addStudentSubmitButton').textContent = count ? label : 'Add Student';
}

function say(message, isError = false) {
  const box = document.getElementById('importMessage');
  box.textContent = message;
  box.className = `import-message${isError ? ' error' : ''}`;
}

// ---------------------------------------------------------------------
// 9. SAVE THE ROWS FROM THE FILE
// Any professor or schedule ticked on the page overrides what the file said.
// ---------------------------------------------------------------------
async function importStudents() {
  if (!page.importRows.length) return;

  const button = document.getElementById('importStudentsButton');
  button.disabled = true;
  say('Importing students...');

  try {
    const reply = await fetch(apiUrl('/api/students/import'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: applyChosenClasses(page.importRows) })
    });
    const result = await reply.json().catch(() => ({}));
    if (!reply.ok) {
      const detail = Array.isArray(result.errors)
        ? result.errors.map(problem => `Row ${problem.row}: ${problem.message}`).join(' ')
        : '';
      throw new Error(detail || result.message || 'Unable to import students.');
    }

    say(result.message || 'Students imported successfully.');
    page.importRows = [];
    document.getElementById('studentImportFile').value = '';
    hideImportPreview();
    showImportState();
    await loadPickers();
  } catch (error) {
    say(error.message || 'Unable to import students.', true);
  } finally {
    button.disabled = page.importRows.length === 0;
  }
}

function applyChosenClasses(rows) {
  const schedules = chosenSchedules();
  if (!rows.length || !schedules.length) return rows;
  const professors = chosenProfessors();
  const names = professors.map(professor => professor.full_name).join('; ');

  return rows.map(row => ({
    ...row,
    professor: names || row.professor,
    class_list_schedule_id: schedules[0].id,
    class_list_schedule_ids: schedules.map(schedule => schedule.id)
  }));
}
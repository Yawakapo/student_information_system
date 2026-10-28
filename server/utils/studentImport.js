const text = value => String(value ?? '').trim();
const lower = value => text(value).toLowerCase();

const yearValues = new Map([
  ['1', '1st Year'], ['1st year', '1st Year'], ['1st Year', '1st Year'],
  ['2', '2nd Year'], ['2nd year', '2nd Year'], ['2nd Year', '2nd Year'],
  ['3', '3rd Year'], ['3rd year', '3rd Year'], ['3rd Year', '3rd Year'],
  ['4', '4th Year'], ['4th year', '4th Year'], ['4th Year', '4th Year']
]);

const normalizeProfessor = value => lower(value)
  .replace(/\b(prof|professor|profesora|atty|dr)\b/g, '')
  .replace(/[^a-z0-9]+/g, '');

const isValidBirthday = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date <= new Date();
};

const splitScheduleValues = value => {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap(item => String(item ?? '').split(/\s*(?:;|\||\r?\n)\s*/))
    .map(item => item.trim())
    .filter(Boolean);
};

const scheduleValuesFromSource = source => {
  const explicitValues = [
    ...splitScheduleValues(source.class_list_schedule_ids),
    ...splitScheduleValues(source.schedule_ids),
    ...splitScheduleValues(source.class_list_schedule_id),
    ...splitScheduleValues(source.schedule_id)
  ].filter(Boolean);
  if (explicitValues.length) return explicitValues;
  return splitScheduleValues(source.schedules || source.schedule);
};

const normalizeImportRows = sourceRows => {
  const errors = [];
  const rows = [];
  const seenStudentNumbers = new Set();

  sourceRows.forEach((source, index) => {
    const rowNumber = index + 2;
    const sourceRow = source && typeof source === 'object' ? source : {};
    const scheduleValues = scheduleValuesFromSource(sourceRow);
    const scheduleIds = scheduleValues
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value > 0);
    const row = {
      student_no: text(sourceRow.student_no || sourceRow.studentNo),
      first_name: text(sourceRow.first_name || sourceRow.firstName),
      last_name: text(sourceRow.last_name || sourceRow.lastName),
      year_level: text(sourceRow.year_level || sourceRow.year),
      gender: text(sourceRow.gender),
      professor: text(sourceRow.professor || sourceRow.professor_name),
      class_list_schedule_id: scheduleIds[0] || null,
      class_list_schedule_ids: [...new Set(scheduleIds)],
      schedule: text(sourceRow.schedule || sourceRow.schedules),
      birthday: text(sourceRow.birthday),
      address: text(sourceRow.address),
      contact_number: text(sourceRow.contact_number || sourceRow.number),
      emergency_contact_number: text(sourceRow.emergency_contact_number || sourceRow.emergency_contact)
    };

    const required = [
      'student_no', 'first_name', 'last_name', 'year_level', 'gender',
      'birthday', 'address', 'contact_number', 'emergency_contact_number'
    ];
    required.forEach(field => {
      if (!row[field]) errors.push({ row: rowNumber, field, message: `${field.replace(/_/g, ' ')} is required.` });
    });

    if (row.year_level && !yearValues.has(lower(row.year_level))) {
      errors.push({ row: rowNumber, field: 'year_level', message: 'Use 1st Year, 2nd Year, 3rd Year, or 4th Year.' });
    }
    if (row.birthday && !isValidBirthday(row.birthday)) {
      errors.push({ row: rowNumber, field: 'birthday', message: 'Use a valid birthday in YYYY-MM-DD format.' });
    }
    const hasScheduleInput = scheduleValues.length > 0;
    if (hasScheduleInput && scheduleValues.some(value => !/^\d+$/.test(String(value)) || Number(value) < 1)) {
      errors.push({ row: rowNumber, field: 'schedule', message: 'Select valid professor schedules.' });
    }
    if (row.student_no.length > 30) {
      errors.push({ row: rowNumber, field: 'student_no', message: 'Student number is too long.' });
    }
    if (row.first_name.length > 50 || row.last_name.length > 50) {
      errors.push({ row: rowNumber, field: 'name', message: 'Name is too long.' });
    }
    if (row.gender.length > 20) {
      errors.push({ row: rowNumber, field: 'gender', message: 'Gender is too long.' });
    }
    if (row.professor.length > 255) {
      errors.push({ row: rowNumber, field: 'professor', message: 'Professor is too long.' });
    }
    if (row.address.length > 255) {
      errors.push({ row: rowNumber, field: 'address', message: 'Address is too long.' });
    }
    if (row.contact_number.length > 20 || row.emergency_contact_number.length > 20) {
      errors.push({ row: rowNumber, field: 'contact', message: 'Contact number is too long.' });
    }
    if (row.student_no && seenStudentNumbers.has(lower(row.student_no))) {
      errors.push({ row: rowNumber, field: 'student_no', message: 'Duplicate student number in the file.' });
    }
    if (row.student_no) seenStudentNumbers.add(lower(row.student_no));

    row.year_level = yearValues.get(lower(row.year_level)) || row.year_level;
    rows.push(row);
  });

  return { rows, errors };
};

module.exports = {
  isValidBirthday,
  normalizeImportRows,
  normalizeProfessor
};

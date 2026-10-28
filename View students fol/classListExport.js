(function exposeClassListExport(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SISClassListExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildClassListExportApi() {
  const safeFilePart = value => String(value || 'BSIT').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'Class';

  const buildNameRows = students => students.map(student => ({
    'Student Name': [student.first_name, student.last_name].filter(Boolean).join(' ').trim() || '-'
  }));

  const buildRows = (students, classInfo = {}, formatTime = value => value || '') => students.map(student => ({
    'Student No.': student.student_no || '',
    'First Name': student.first_name || '',
    'Last Name': student.last_name || '',
    'Year': student.year_level || '',
    'Gender': student.gender || '',
    'Birthday': student.birthday ? String(student.birthday).slice(0, 10) : '',
    'Address': student.address || '',
    'Number': student.contact_number || '',
    'Emergency Contact No.': student.emergency_contact_number || ''
  }));

  const buildFilename = classInfo => `BSIT_${safeFilePart(classInfo.subject)}_${safeFilePart(classInfo.section_course || classInfo.course)}_${safeFilePart(classInfo.day)}`;

  const csvCell = value => {
    let safe = String(value ?? '');
    if (/^[=+\-@]/.test(safe)) safe = `'${safe}`;
    return `"${safe.replace(/"/g, '""')}"`;
  };

  const buildCsv = rows => {
    const headers = Object.keys(rows[0] || {});
    return `\uFEFF${[headers, ...rows.map(row => headers.map(header => row[header]))]
      .map(row => row.map(csvCell).join(','))
      .join('\r\n')}`;
  };

  return { buildNameRows, buildRows, buildFilename, buildCsv, safeFilePart };
});

const BSIT_COURSE = 'BSIT';
const BSIT_DEPARTMENT = 'School of Information Technology';

const normalizeCourse = (value) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const normalizeDepartment = (value) => {
  const department = String(value ?? '').trim().toLowerCase();
  return /^(college|school) of computer studies$/.test(department)
    ? BSIT_DEPARTMENT.toLowerCase()
    : department;
};

const isBSITCourse = (value) => /^bsit(?:\d+[a-z]?|[a-z])?$/.test(normalizeCourse(value));
const isBSITDepartment = (value) => {
  const department = normalizeDepartment(value);
  return department === BSIT_DEPARTMENT.toLowerCase() || department === 'information technology';
};

module.exports = {
  BSIT_COURSE,
  BSIT_DEPARTMENT,
  isBSITCourse,
  isBSITDepartment,
  normalizeCourse,
  normalizeDepartment
};

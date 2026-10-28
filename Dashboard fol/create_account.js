document.addEventListener('DOMContentLoaded', () => {
  if ((localStorage.getItem('role') || '').toLowerCase() !== 'admin') {
    window.location.href = '../Login%20part/login.html';
    return;
  }

  const form = document.getElementById('accountForm');
  const type = document.getElementById('accountType');
  const numberLabel = document.getElementById('accountNumberLabel');
  const numberText = document.getElementById('accountNumberText');
  const number = document.getElementById('accountNumber');
  const eligibleList = document.getElementById('eligibleStudentNumbers');
  const numberHint = document.getElementById('accountNumberHint');
  const username = document.getElementById('username');
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const teacherNameLabel = document.getElementById('teacherNameLabel');
  const fullNameText = document.getElementById('fullNameText');
  const teacherFullName = document.getElementById('teacherFullName');
  const message = document.getElementById('accountMessage');
  const submitButton = document.getElementById('createAccountButton');
  const api = path => window.sisApiUrl?.(path) || ((window.location.port === '5000' || window.location.port === '') ? path : `${window.location.protocol === 'https:' ? 'https:' : 'http:'}//${window.location.hostname || 'localhost'}:5000${path}`);
  const BSIT_DEPARTMENT = 'School of Information Technology';
  let validationTimer = null;
  let lastEligibility = null;

  const setMessage = (value, isError = false) => {
    message.textContent = value;
    message.className = isError ? 'error' : '';
  };

  const setHint = (value, state = '') => {
    numberHint.textContent = value;
    numberHint.className = `account-field-hint${state ? ` ${state}` : ''}`;
  };

  const updateAccountFields = () => {
    const teacher = type.value === 'teacher';
    const admin = type.value === 'admin';
    numberText.textContent = teacher ? 'Professor Number' : admin ? 'Admin ID' : 'Student Number';
    number.placeholder = teacher ? 'e.g. T-001' : admin ? 'e.g. A-001' : 'e.g. 26-00123';
    number.setAttribute('list', teacher || admin ? '' : 'eligibleStudentNumbers');
    number.required = !admin;
    eligibleList.hidden = teacher || admin;
    fullNameText.textContent = teacher ? 'Professor Full Name' : 'Full Name';
    teacherFullName.placeholder = teacher ? 'e.g. Prof. Maria Santos' : 'e.g. Maria Santos';
    teacherNameLabel.hidden = !teacher && !admin;
    teacherFullName.required = teacher || admin;
    teacherFullName.disabled = !teacher && !admin;
    if (!teacher && !admin) teacherFullName.value = '';
    lastEligibility = null;
    setHint(teacher
      ? 'Use the official professor number from the faculty records.'
      : admin
        ? 'Optional. Used only as an alternate login ID for the administrator.'
        : 'Choose a student number that is already assigned to a class list.');
  };

  const loadEligibleStudents = async () => {
    try {
      const response = await fetch(api('/api/admin/students/account-options'));
      if (!response.ok) return;
      const students = await response.json();
      const eligible = Array.isArray(students) ? students.filter(student => student.eligible) : [];
      eligibleList.innerHTML = eligible.map(student => {
        const name = `${student.first_name || ''} ${student.last_name || ''}`.trim();
        const count = Number(student.class_list_count) || 0;
        return `<option value="${escapeHtml(student.student_no)}">${escapeHtml(`${name} · ${student.course || 'Course not set'} · ${count} class list${count === 1 ? '' : 's'}`)}</option>`;
      }).join('');
    } catch (error) {
      console.warn('Unable to load eligible student accounts.', error);
    }
  };

  const validateStudentNumber = async () => {
    if (type.value === 'teacher') return true;
    const value = number.value.trim();
    if (!value) {
      lastEligibility = null;
      setHint('Enter the student number to verify class-list assignment.', 'warning');
      return false;
    }

    setHint('Checking class-list assignment...', 'checking');
    try {
      const response = await fetch(api(`/api/admin/students/eligibility/${encodeURIComponent(value)}`));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to verify this student.');
      lastEligibility = data;
      if (data.eligible) {
        setHint(`Eligible: ${data.student?.full_name || value} · ${data.class_list_count} class list${Number(data.class_list_count) === 1 ? '' : 's'}.`, 'success');
        return true;
      }
      setHint(data.message || 'This student is not eligible for an account.', 'error');
      return false;
    } catch (error) {
      lastEligibility = null;
      setHint(error.message || 'Unable to verify this student right now.', 'error');
      return false;
    }
  };

  const scheduleValidation = () => {
    window.clearTimeout(validationTimer);
    validationTimer = window.setTimeout(validateStudentNumber, 250);
  };

  type.addEventListener('change', updateAccountFields);
  number.addEventListener('input', () => {
    if (type.value === 'student') scheduleValidation();
  });
  number.addEventListener('blur', () => {
    if (type.value === 'student') validateStudentNumber();
  });

  document.getElementById('showPassword').addEventListener('click', event => {
    password.type = password.type === 'password' ? 'text' : 'password';
    event.target.textContent = password.type === 'password' ? 'Show' : 'Hide';
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    setMessage('');
    if (!form.reportValidity()) return;

    if (type.value === 'student' && !(lastEligibility?.eligible && lastEligibility.student?.student_no?.toLowerCase() === number.value.trim().toLowerCase())) {
      const eligible = await validateStudentNumber();
      if (!eligible) {
        setMessage('Create the class-list assignment before creating this student account.', true);
        return;
      }
    }

    const payload = {
      role: type.value,
      account_number: number.value.trim(),
      username: username.value.trim(),
      full_name: teacherFullName.value.trim(),
      teacher_full_name: teacherFullName.value.trim(),
      department: BSIT_DEPARTMENT,
      email: email.value.trim(),
      password: password.value
    };

    submitButton.disabled = true;
    submitButton.textContent = 'Creating...';
    try {
      const response = await fetch(api('/api/admin/create-account'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to create account.');

      form.reset();
      lastEligibility = null;
      updateAccountFields();
      setMessage('Account created successfully.');
      await loadEligibleStudents();
    } catch (error) {
      setMessage(error.message || 'Unable to create account.', true);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Create Account';
    }
  });

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[character]));
  }

  // Refresh the eligible-student list when someone imports or assigns a student.
  window.sisOnDataChange?.(() => {
    if (document.visibilityState === 'visible' && type.value === 'student') {
      loadEligibleStudents();
    }
  });

  updateAccountFields();
  loadEligibleStudents();
});

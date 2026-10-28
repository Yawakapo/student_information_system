const API_BASE = (window.location.port === '5000' || window.location.port === '') ? '' : `${window.location.protocol === 'https:' ? 'https:' : 'http:'}//${window.location.hostname || 'localhost'}:5000`;
const BSIT_COURSE = 'BSIT';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
let teacherOptions = [];

async function loadTeacherOptions() {
  const select = document.getElementById('teacherName');
  if (!select) return;
  try {
    const response = await fetch(`${API_BASE}/api/teachers`);
    if (!response.ok) throw new Error('Unable to load professors.');
    teacherOptions = await response.json();
    const activeTeachers = teacherOptions.filter(teacher => String(teacher.status || 'Active').toLowerCase() === 'active');
    select.innerHTML = activeTeachers.length
      ? '<option value="">Select the professor</option>' + activeTeachers.map(teacher => `<option value="${escapeHtml(teacher.teacher_id)}">${escapeHtml(teacher.full_name || teacher.teacher_id)} (${escapeHtml(teacher.teacher_id)})</option>`).join('')
      : '<option value="">No active professors found</option>';
    select.disabled = activeTeachers.length === 0;
  } catch (error) {
    select.innerHTML = '<option value="">Unable to load professors</option>';
    select.disabled = true;
    console.warn('Unable to load professor options:', error);
  }
}

document.addEventListener('DOMContentLoaded', loadTeacherOptions);
const liveSocket = window.sisSocket?.();
liveSocket?.on('teacher_created', loadTeacherOptions);
liveSocket?.on('teacher_deleted', loadTeacherOptions);

// Convert the user-friendly 12-hour form value to the TIME value stored by MySQL.
function convertTo24Hour(timeStr, period) {
  const match = String(timeStr || '').trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const normalizedPeriod = String(period || 'AM').toUpperCase();
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null;
  if (hours < 1 || hours > 12) return null;

  if (normalizedPeriod === 'PM' && hours !== 12) hours += 12;
  if (normalizedPeriod === 'AM' && hours === 12) hours = 0;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value).split(':').map(Number);
  return (hours * 60) + minutes;
}

async function saveSchedule(event) {
  event.preventDefault();

  const teacherSelect = document.getElementById('teacherName');
  const subjectCodeInput = document.getElementById('subjectCode');
  const roomNumberInput = document.getElementById('roomNumber');
  const classDayInput = document.getElementById('classDay');
  const rawStartInput = document.getElementById('startTime');
  const startPeriodInput = document.getElementById('startPeriod');
  const rawEndInput = document.getElementById('endTime');
  const endPeriodInput = document.getElementById('endPeriod');

  const selectedTeacher = teacherOptions.find(teacher => String(teacher.teacher_id) === String(teacherSelect?.value));
  const teacherName = selectedTeacher?.full_name?.trim() || '';
  const subjectCode = subjectCodeInput?.value.trim() || '';
  const course = BSIT_COURSE;
  const roomNumber = roomNumberInput?.value.trim() || '';
  const day = classDayInput?.value || '';
  const rawStart = rawStartInput?.value.trim() || '';
  const startPeriod = startPeriodInput?.value || 'AM';
  const rawEnd = rawEndInput?.value.trim() || '';
  const endPeriod = endPeriodInput?.value || 'PM';

  if (!subjectCode || !course || !selectedTeacher || !teacherName || !roomNumber || !day || !rawStart || !rawEnd) {
    showScheduleError('Please complete all required schedule details.', false);
    return;
  }

  const startTime24 = convertTo24Hour(rawStart, startPeriod);
  const endTime24 = convertTo24Hour(rawEnd, endPeriod);
  if (!startTime24 || !endTime24) {
    showScheduleError('Enter times as 1:00–12:00 and choose AM or PM.', false);
    return;
  }
  if (timeToMinutes(startTime24) >= timeToMinutes(endTime24)) {
    showScheduleError('End time must be later than start time.', false);
    return;
  }

  const scheduleData = {
    subject: subjectCode,
    room: roomNumber,
    day,
    startTime: startTime24,
    endTime: endTime24,
    professor_name: teacherName,
    teacher_id: selectedTeacher.teacher_id,
    course
  };

  const submitButton = document.querySelector('#createScheduleForm button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  try {
    const response = await fetch(`${API_BASE}/api/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scheduleData)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status !== 'success') {
      throw new Error(result.message || 'Failed to create schedule.');
    }

    showScheduleError('Schedule created successfully! Redirecting...', true);
    setTimeout(() => { window.location.href = '/View%20schedule/View%20schedule.html'; }, 900);
  } catch (error) {
    showScheduleError(error.message || 'Cannot reach the server. Please check backend connections.', false);
    if (submitButton) submitButton.disabled = false;
  }
}

function showScheduleError(message, isSuccess = false) {
  const errorDiv = document.getElementById('scheduleErrorMessage');
  if (!errorDiv) return;

  errorDiv.textContent = message;
  errorDiv.style.display = 'flex';
  errorDiv.style.padding = '12px 16px';
  errorDiv.style.borderRadius = '8px';
  errorDiv.style.fontSize = '14px';
  errorDiv.style.fontWeight = '600';
  errorDiv.style.marginBottom = '20px';

  if (isSuccess) {
    errorDiv.style.backgroundColor = '#dcfce7';
    errorDiv.style.border = '1px solid #4ade80';
    errorDiv.style.color = '#166534';
  } else {
    errorDiv.style.backgroundColor = '#fee2e2';
    errorDiv.style.border = '1px solid #f87171';
    errorDiv.style.color = '#991b1b';
    setTimeout(() => { errorDiv.style.display = 'none'; }, 4000);
  }
}

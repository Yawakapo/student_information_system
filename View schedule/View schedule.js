/* =====================================================================
   VIEW SCHEDULE & PROFILE FUNCTIONS (STRICT FETCH & SAFE PARSING)
   ===================================================================== */

let loadedSchedules = [];

document.addEventListener("DOMContentLoaded", () => {
  loadUserProfile();
  displaySchedules();
  // One debounced listener instead of five, so a burst of schedule changes
  // costs a single re-fetch.
  window.sisOnDataChange?.(() => {
    if (document.visibilityState === 'visible') displaySchedules();
  });
});

// Helper to resolve API base URL safely across local and server environments
function getApiUrl(endpoint) {
  return window.sisApiUrl?.(endpoint) || (window.location.port === "5000" || window.location.port === ""
    ? endpoint
    : `${window.location.protocol === "https:" ? "https:" : "http:"}//${window.location.hostname || "localhost"}:5000${endpoint}`);
}
function normalizeDepartment(value) {
  const department = String(value || '').trim();
  return /^(college|school) of computer studies$/i.test(department) ? 'School of Information Technology' : department || 'Not specified';
}

// Builds the two letters shown when the person has no uploaded picture,
// for example "KRISHA A. PADRIGON" becomes "KP".
//
// This used to download a picture of the initials from an online service.
// That meant the avatar was the one thing on the page that could not be drawn
// without a connection, so the letters are made here instead. The picture that
// a person really uploaded still loads normally, because that comes from the
// database on this machine.
function getInitials(name) {
  if (!name) return 'U';
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

// Load user profile from LocalStorage, backend database, or fallback initials
async function loadUserProfile() {
  const userNameElements = document.querySelectorAll(".user-name");
  const avatarContainer = document.querySelector(".user-avatar");

  let userName = "Prof. Professor";
  let avatarUrl = "";

  // 1. Check LocalStorage first (saved from session or Profile settings)
  const savedProfile = localStorage.getItem("sis_profile");
  if (savedProfile) {
    try {
      const parsedProfile = JSON.parse(savedProfile);
      if (parsedProfile.name) userName = parsedProfile.name;
      if (parsedProfile.avatar) avatarUrl = parsedProfile.avatar;
    } catch (e) {
      console.warn("Could not parse sis_profile from localStorage:", e);
    }
  }

  // 2. Fallback to API endpoint if no LocalStorage profile picture/name was found
  //
  // The name comes from the light endpoint, which leaves out the stored picture.
  // That picture is base64 text and can be well over a megabyte, so it is only
  // fetched when there is no local copy, and the name is painted first.
  let needsRemotePicture = false;
  if (!avatarUrl || userName === "Prof. Professor") {
    const userId = localStorage.getItem('user_id') || 'T-002';
    try {
      const response = await fetch(getApiUrl(`/api/profile/summary/${encodeURIComponent(userId)}`));
      if (response.ok) {
        const data = await response.json();
        const profile = data.data || data;
        userName = profile.name || profile.full_name || userName;
        needsRemotePicture = Boolean(profile.has_profile_picture) && !avatarUrl;
      }
    } catch (err) {
      console.warn("Backend profile API unavailable, using local fallbacks.", err);
    }
  }

  // 3. With no uploaded picture, the two letters are drawn here.
  // The name can still change while the picture is loading, so it is captured
  // once here and used for both the letters and the alt text.
  const nameForAvatar = userName;

  // Update DOM User Name elements across top bar / interface
  userNameElements.forEach((el) => {
    el.textContent = userName;
  });

  // Update Avatar Container
  if (avatarContainer) {
    if (avatarUrl) {
      avatarContainer.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(nameForAvatar)}" class="avatar-img">`;
    } else {
      avatarContainer.textContent = getInitials(nameForAvatar);
    }
  }

  // 4. The stored picture arrives on its own, so the page above is already
  //    usable while it downloads. Only asked for when one actually exists.
  if (needsRemotePicture) {
    const userId = localStorage.getItem('user_id');
    fetch(getApiUrl(`/api/profile/${encodeURIComponent(userId)}`))
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        const picture = data?.data?.profile_picture;
        if (!picture || !avatarContainer) return;
        avatarContainer.innerHTML = `<img src="${escapeHtml(picture)}" alt="${escapeHtml(nameForAvatar)}" class="avatar-img">`;
      })
      .catch(() => { /* the initials avatar already on screen stays put */ });
  }
}

// Helper to convert "13:00:00" to "01:00 PM"
function formatTime12Hr(time24) {
  return window.sisFormatTime12?.(time24) || String(time24 || '');
}

// Which professor's list is currently on screen. The page hides the table and
// only fills it when a professor is picked, so after a delete or an edit the
// table still shows the rows it was handed earlier. This remembers the choice so
// the table can be drawn again from the fresh list.
let selectedProfessorKey = '';

// Builds a short comparable key for a professor, so the same person is
// recognised again after the list is reloaded.
function professorKey(item) {
  const teacherId = String(item?.teacher_id || '').trim().toLowerCase();
  if (teacherId) return teacherId;
  return String(item?.professor_name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Display dynamic schedule rows from MySQL backend (Strictly 5 Columns)
async function displaySchedules() {
  const tableBody = document.getElementById("scheduleTableBody");
  const groupChoices = document.getElementById("scheduleGroupChoices");
  const tableContainer = document.getElementById("scheduleTableContainer");
  if (!tableBody) {
    console.error("Error: Could not find #scheduleTableBody element in HTML.");
    return;
  }

  try {
    // Schedule management shows every schedule created by the administrator.
    const baseUrl = getApiUrl("/api/schedule");
    const queryUrl = baseUrl;

    let response = await fetch(queryUrl);
    
    // Fallback attempt to plural endpoint if modular singular returns 404
    if (response.status === 404) {
      const altUrl = getApiUrl("/api/schedules");
      response = await fetch(altUrl);
    }

    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}: Failed to fetch schedules.`);
    }

    const result = await response.json();

    // Safely parse array whether returned directly or inside object wrappers
    const schedules = Array.isArray(result)
      ? result
      : (result.data || result.schedules || []);
    loadedSchedules = Array.isArray(schedules) ? schedules : [];
    const teacherResponse = await fetch(getApiUrl('/api/admin/teachers')).catch(() => null);
    const professors = teacherResponse?.ok ? await teacherResponse.json() : [];

    if (!Array.isArray(schedules) || schedules.length === 0) {
      if (!Array.isArray(professors) || professors.length === 0) {
        groupChoices.textContent = 'No schedules or professors found.';
        return;
      }
    }

    const renderRows = selectedSchedules => {
      const actualSchedules = selectedSchedules.filter(item =>
        item.id
        && item.noSchedule !== true
        && item.subject
        && !/^bsit$/i.test(String(item.subject).trim())
        && item.day
        && (item.start_time || item.class_time)
      );
      if (!actualSchedules.length) {
        tableBody.innerHTML = '<tr><td class="notice" colspan="5">No schedules assigned yet.</td></tr>';
        return;
      }
      tableBody.innerHTML = actualSchedules.map((item) => {
        const scheduleId = item.id || item.schedule_id || item._id || "";

        // Subject Code Parsing (e.g., "ITC 111 - Computer Prog" -> "ITC 111")
        let subjectCode = item.subject || item.subject_code || item.course || "";
        if (subjectCode.includes(" - ")) {
          subjectCode = subjectCode.split(" - ")[0];
        }

        const room = window.sisFormatRoom?.(item.room_lab || item.room || item.lab) || "Not set";
        const day = item.day || item.schedule_day || "Not set";

        // Format start_time and end_time if provided separately, or fall back to class_time string
        const startTimeFormatted = formatTime12Hr(item.start_time);
        const endTimeFormatted = formatTime12Hr(item.end_time);

        const classTime =
          startTimeFormatted && endTimeFormatted
            ? `${startTimeFormatted} - ${endTimeFormatted}`
            : (window.sisFormatClassTime?.(item.class_time || item.time) || item.class_time || item.time || "N/A");

        return `
          <tr>
            <td><strong>${escapeHtml(subjectCode)}</strong></td>
            <td>${escapeHtml(room)}</td>
            <td>${escapeHtml(day)}</td>
            <td>${escapeHtml(classTime)}</td>
            <td style="text-align: center;" class="schedule-action-cell">
              <button class="edit-schedule-btn" onclick="editSchedule('${escapeHtml(String(scheduleId))}')" type="button">
                <i class="fa-solid fa-pen"></i> Edit
              </button>
              <button class="delete-btn" onclick="deleteSchedule('${escapeHtml(String(scheduleId))}')" type="button">
                <i class="fa-solid fa-trash"></i> Delete
              </button>
            </td>
          </tr>
        `;
      }).join("");
    };
    const professorMap = new Map();
    const addProfessor = item => {
      const key = professorKey(item) || `unknown-${Math.random()}`;
      if (!professorMap.has(key)) professorMap.set(key, []);
      professorMap.get(key).push(item);
    };
    schedules.forEach(addProfessor);
    professors.forEach(professor => addProfessor({
      ...professor,
      id: null,
      teacher_id: professor.teacher_id,
      professor_name: professor.full_name,
      department: professor.department || 'School of Information Technology',
      course: 'BSIT',
      noSchedule: true
    }));
    const groups = [...professorMap.values()].reduce((map, professorSchedules) => {
      const first = professorSchedules[0] || {};
      const department = normalizeDepartment(first.department);
      const course = first.course || first.section_course || 'BSIT';
      const key = `${department}\u0000${course}`;
      if (!map.has(key)) map.set(key, { department, course, professors: [] });
      map.get(key).professors.push(professorSchedules);
      return map;
    }, new Map());
    const groupEntries = [...groups.entries()];
    // Custom group names are cosmetic; the real department/course stay BSIT.
    const groupLabelMap = await window.sisLoadGroupLabels?.() || {};
    groupChoices.innerHTML = groupEntries.map(([key, group], index) => {
      const professorButtons = group.professors.map((professorSchedules, professorIndex) => {
        const first = professorSchedules[0] || {};
        const professor = first.professor_name || first.teacher_id || 'Professor not assigned';
        return `<button class="schedule-group-option schedule-professor-option" data-group-index="${index}" data-professor-index="${professorIndex}">${escapeHtml(professor)}</button>`;
      }).join('');
      return `<div class="schedule-group"><button class="schedule-group-option" data-group-index="${index}">${escapeHtml(window.sisGroupLabel?.(group, groupLabelMap) || `${group.department} / ${group.course}`)}</button><div class="schedule-professor-options" data-professor-options="${index}" hidden>${professorButtons}</div></div>`;
    }).join('');
    groupChoices.onclick = event => {
      const button = event.target.closest('[data-group-index]');
      if (!button) return;
      const group = groupEntries[Number(button.dataset.groupIndex)][1];
      if (button.dataset.professorIndex !== undefined) {
        const wasSelected = button.classList.contains('selected');
        if (wasSelected) {
          button.classList.remove('selected');
          tableContainer.hidden = true;
          return;
        }
        const professorSchedules = group.professors[Number(button.dataset.professorIndex)] || [];
        tableContainer.hidden = false;
        selectedProfessorKey = professorKey(professorSchedules[0] || {});
        renderRows(professorSchedules);
        groupChoices.querySelectorAll('.schedule-professor-option').forEach(item => item.classList.toggle('selected', item === button));
        return;
      }
      const professorOptions = groupChoices.querySelector(`[data-professor-options="${button.dataset.groupIndex}"]`);
      const isOpening = professorOptions.hidden;
      groupChoices.querySelectorAll('.schedule-group-option').forEach(item => item.classList.remove('selected'));
      groupChoices.querySelectorAll('[data-professor-options]').forEach(options => { options.hidden = true; });
      professorOptions.hidden = !isOpening;
      button.classList.toggle('selected', isOpening);
      tableContainer.hidden = true;
    };

    // Put the table back the way the person left it. Without this, deleting a
    // row removes it from the database but leaves it sitting on screen, because
    // nothing redraws the table except clicking a professor again.
    if (selectedProfessorKey) {
      const stillThere = [];
      for (const [, group] of groupEntries) {
        for (const professorSchedules of group.professors) {
          if (professorKey(professorSchedules[0] || {}) === selectedProfessorKey) {
            stillThere.push(...professorSchedules.filter(item => !item.noSchedule));
          }
        }
      }
      if (stillThere.length) {
        renderRows(stillThere);
        tableContainer.hidden = false;
      } else {
        // The professor who was open no longer has any schedule.
        selectedProfessorKey = '';
        tableContainer.hidden = true;
      }
    }
  } catch (error) {
    console.error("Fetch Schedule Error:", error);
    groupChoices.textContent = 'Failed to load schedule data. Ensure the server is running.';
  }
}

function timePartsForInput(value) {
  const formatted = formatTime12Hr(value);
  const match = formatted.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  return match ? { time: `${match[1]}:${match[2]}`, period: match[3].toUpperCase() } : { time: '8:00', period: 'AM' };
}

function closeScheduleEditor() {
  const modal = document.getElementById('scheduleEditModal');
  if (modal) modal.hidden = true;
  const message = document.getElementById('scheduleEditMessage');
  if (message) message.textContent = '';
}

function editSchedule(id) {
  const schedule = loadedSchedules.find(item => String(item.id || item.schedule_id || item._id) === String(id));
  if (!schedule) return;
  const start = timePartsForInput(schedule.start_time);
  const end = timePartsForInput(schedule.end_time);
  document.getElementById('editScheduleId').value = schedule.id;
  document.getElementById('editSubject').value = schedule.subject || '';
  document.getElementById('editDepartment').value = schedule.department || '';
  document.getElementById('editProfessor').value = schedule.professor_name || '';
  document.getElementById('editCourse').value = schedule.course || schedule.section_course || '';
  // An empty box is better here than placeholder text, because whatever sits in
  // this field is what gets saved. Writing "N/A" into it would store "N/A" as a
  // real room name.
  document.getElementById('editRoom').value = schedule.room_lab || schedule.room || '';
  document.getElementById('editDay').value = schedule.day || 'Monday';
  document.getElementById('editStartTime').value = start.time;
  document.getElementById('editStartPeriod').value = start.period;
  document.getElementById('editEndTime').value = end.time;
  document.getElementById('editEndPeriod').value = end.period;
  document.getElementById('scheduleEditMessage').textContent = '';
  document.getElementById('scheduleEditModal').hidden = false;
}

function scheduleTimeTo24(time, period) {
  const match = String(time || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
}

document.getElementById('scheduleEditForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const message = document.getElementById('scheduleEditMessage');
  const id = document.getElementById('editScheduleId').value;
  const start = scheduleTimeTo24(document.getElementById('editStartTime').value, document.getElementById('editStartPeriod').value);
  const end = scheduleTimeTo24(document.getElementById('editEndTime').value, document.getElementById('editEndPeriod').value);
  if (!start || !end) {
    message.textContent = 'Enter valid times, such as 8:00 or 11:30.';
    return;
  }
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  if (startHour * 60 + startMinute >= endHour * 60 + endMinute) {
    message.textContent = 'End time must be later than start time.';
    return;
  }

  const submit = event.currentTarget.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  try {
    const response = await fetch(getApiUrl(`/api/schedule/${encodeURIComponent(id)}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: document.getElementById('editSubject').value.trim(),
        department: document.getElementById('editDepartment').value.trim(),
        professor_name: document.getElementById('editProfessor').value.trim(),
        course: document.getElementById('editCourse').value.trim(),
        room: document.getElementById('editRoom').value.trim(),
        day: document.getElementById('editDay').value,
        startTime: start,
        endTime: end
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || 'Unable to update schedule.');
    closeScheduleEditor();
    await displaySchedules();
  } catch (error) {
    message.textContent = error.message || 'Unable to update schedule.';
  } finally {
    if (submit) submit.disabled = false;
  }
});

document.getElementById('closeScheduleEdit')?.addEventListener('click', closeScheduleEditor);
document.getElementById('cancelScheduleEdit')?.addEventListener('click', closeScheduleEditor);
document.getElementById('scheduleEditModal')?.addEventListener('click', event => {
  if (event.target.id === 'scheduleEditModal') closeScheduleEditor();
});

// Delete schedule by ID directly from Database
async function deleteSchedule(id) {
  if (!id) return;

  if (!confirm("Are you sure you want to delete this schedule entry?")) {
    return;
  }

  try {
    const encodedId = encodeURIComponent(id.trim());
    const response = await fetch(getApiUrl(`/api/schedule/${encodedId}`), { method: 'DELETE' });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 404) {
        await displaySchedules();
        alert('This schedule was already removed. The list has been refreshed.');
        return;
      }
      alert(result.message || result.error || 'Failed to delete schedule.');
      return;
    }

    // Refresh table upon success
    await displaySchedules();
  } catch (error) {
    console.error("Delete Schedule Error:", error);
    alert("Cannot connect to server to delete schedule.");
  }
}

// Helper function to escape HTML special characters
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  if (typeof str !== "string") str = String(str);

  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return str.replace(/[&<>"']/g, (match) => map[match]);
}

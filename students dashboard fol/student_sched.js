const formatTime = time => window.sisFormatTime12?.(time) || String(time || '');

const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
const formatScheduleTime = schedule => {
  if (schedule.start_time && schedule.end_time) {
    return `${formatTime(schedule.start_time)} - ${formatTime(schedule.end_time)}`;
  }
  return window.sisFormatClassTime?.(schedule.class_time) || schedule.class_time || 'Time not set';
};

window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('studentLogoutLink')?.addEventListener('click', event => {
    event.preventDefault();
    window.sisLogout?.('../Login part/login.html');
  });

  const userId = localStorage.getItem('user_id');
  const role = (localStorage.getItem('role') || '').toLowerCase();
  if (!userId || role !== 'student') { window.location.href = '../Login part/login.html'; return; }

  const choices = document.getElementById('studentScheduleChoices');
  const table = document.getElementById('studentScheduleTable');
  const tbody = document.getElementById('studentScheduleBody');
  const render = schedules => {
    table.hidden = false;
    tbody.innerHTML = schedules.map(s => `<tr>
      <td class="student-schedule-subject">${safe(s.subject || 'Untitled subject')}</td>
      <td>${safe(s.professor_name || 'Professor not assigned')}</td>
      <td>${safe(s.course || 'Not specified')}</td>
      <td>${safe(window.sisFormatRoom?.(s.room_lab) ?? 'Not set')}</td>
      <td>${safe(s.day || 'Not specified')}</td>
      <td>${safe(formatScheduleTime(s))}</td>
    </tr>`).join('');
  };

  const scheduleUrl = window.sisApiUrl?.(`/api/student/schedule/${encodeURIComponent(userId)}`) || `${window.location.protocol === 'https:' ? 'https:' : 'http:'}//${window.location.hostname || 'localhost'}:5000/api/student/schedule/${encodeURIComponent(userId)}`;

  // Loads the schedule and rebuilds the grouped filter controls. Called on the
  // first paint and again whenever the data changes, so the page never has to
  // reload itself.
  const loadSchedule = async () => {
    const response = await fetch(`${scheduleUrl}${scheduleUrl.includes('?') ? '&' : '?'}updatedAt=${Date.now()}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `Unable to load schedules (${response.status}).`);
    const schedules = data.success ? data.schedules || [] : [];
    if (!schedules.length) { choices.textContent = 'No schedules found for your account.'; return; }
    // Older rows still carry the previous department name. Map it to the current
    // one so this portal shows the same heading as the admin and professor pages.
    const normalizeDepartment = value => {
      const department = String(value || '').trim();
      return /^(college|school) of computer studies$/i.test(department)
        ? 'School of Information Technology'
        : department || 'School of Information Technology';
    };
    const groups = [...schedules.reduce((map, item) => {
      // Group by the real department/course pair so a custom group name set by
      // the admin resolves with the same key used by the other portals.
      const department = normalizeDepartment(item.department);
      const course = item.course || 'Not specified';
      const key = `${department}\u0000${course}`;
      if (!map.has(key)) map.set(key, { department, course, schedules: [] });
      map.get(key).schedules.push(item);
      return map;
    }, new Map())];

    // Custom group names are cosmetic; the real department/course stay BSIT.
    const groupLabelMap = await window.sisLoadGroupLabels?.() || {};

    choices.innerHTML = groups.map(([, group], groupIndex) => {
      const professors = [...group.schedules.reduce((map, schedule) => {
        const professor = schedule.professor_name || 'Professor not assigned';
        if (!map.has(professor)) map.set(professor, []);
        map.get(professor).push(schedule);
        return map;
      }, new Map())];
      return `<div class="schedule-group"><button class="schedule-group-option" data-group="${groupIndex}">${safe(window.sisGroupLabel?.(group, groupLabelMap) || group.course)}</button><div class="schedule-professor-options" data-professors="${groupIndex}" hidden>${professors.map(([professor], professorIndex) => `<button class="schedule-group-option schedule-professor-option" data-group="${groupIndex}" data-professor="${professorIndex}">${safe(professor)}</button>`).join('')}</div></div>`;
    }).join('');

    // Show the assigned schedule immediately; the grouped controls can filter it below.
    render(schedules);

    // Re-attach the handler to the rebuilt controls, and drop the old node so
    // repeated refreshes do not stack duplicate listeners.
    choices.onclick = event => {
      const button = event.target.closest('[data-group]');
      if (!button) return;
      const group = groups[Number(button.dataset.group)][1];
      if (button.dataset.professor !== undefined) {
        const wasSelected = button.classList.contains('selected');
        if (wasSelected) {
          button.classList.remove('selected');
          table.hidden = true;
          return;
        }
        const professorGroups = [...group.schedules.reduce((map, schedule) => {
          const professor = schedule.professor_name || 'Professor not assigned';
          if (!map.has(professor)) map.set(professor, []);
          map.get(professor).push(schedule);
          return map;
        }, new Map())];
        render(professorGroups[Number(button.dataset.professor)][1]);
        choices.querySelectorAll('[data-professor]').forEach(item => item.classList.toggle('selected', item === button));
        return;
      }
      const professorOptions = choices.querySelector(`[data-professors="${button.dataset.group}"]`);
      const isOpening = professorOptions.hidden;
      choices.querySelectorAll('[data-professors]').forEach(options => { options.hidden = true; });
      choices.querySelectorAll('.schedule-group-option:not(.schedule-professor-option)').forEach(item => item.classList.remove('selected'));
      professorOptions.hidden = !isOpening;
      button.classList.toggle('selected', isOpening);
      table.hidden = true;
    };
  };

  const refreshButton = document.getElementById('refreshStudentSchedule');
  let refreshInFlight = false;
  // One refresh at a time. Several triggers can fire together (socket event,
  // tab focus, and the safety timer) and overlapping requests would fight over
  // the same DOM.
  const refreshSchedule = async () => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    if (refreshButton) refreshButton.disabled = true;
    try {
      await loadSchedule();
    } catch {
      choices.textContent = 'Unable to load your schedules. Make sure the server is running.';
    } finally {
      refreshInFlight = false;
      if (refreshButton) refreshButton.disabled = false;
    }
  };

  refreshButton?.addEventListener('click', refreshSchedule);

  try {
    await loadSchedule();
  } catch {
    choices.textContent = 'Unable to load your schedules. Make sure the server is running.';
  }

  // Refresh the data in place when an admin changes a schedule.
  window.sisOnDataChange?.(() => {
    if (document.visibilityState === 'visible') refreshSchedule();
  });

  document.addEventListener('sis:refresh', () => {
    if (document.visibilityState === 'visible') refreshSchedule();
  });
});

let schedulePageWasHidden = false;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    schedulePageWasHidden = true;
    return;
  }
  if (schedulePageWasHidden && document.getElementById('studentScheduleTable')) {
    schedulePageWasHidden = false;
    document.dispatchEvent(new CustomEvent('sis:refresh'));
  }
});

// Safety net for when the socket CDN is blocked. This re-reads the schedule
// instead of reloading the whole page.
window.setInterval(() => {
  if (document.visibilityState === 'visible' && document.getElementById('studentScheduleTable')) {
    document.dispatchEvent(new CustomEvent('sis:refresh'));
  }
}, 60000);

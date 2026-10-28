document.addEventListener('DOMContentLoaded', async () => {
  if (!requireTeacher()) return;
  setupLogout();
  // Refresh the data in place rather than reloading the page on every change.
  window.sisOnDataChange?.(() => {
    if (document.visibilityState === 'visible') document.dispatchEvent(new CustomEvent('sis:refresh'));
  });

  const body = document.getElementById('schedulesBody');
  const choices = document.getElementById('scheduleChoices');
  const format = time => window.sisFormatTime12?.(time) || String(time || '-');
  const formatRoom = room => window.sisFormatRoom?.(room) ?? 'Not set';
  const render = schedules => {
    body.innerHTML = schedules.length ? schedules.map(s => `<tr><td><strong>${escapeHtml(s.subject || '-')}</strong></td><td>${escapeHtml(s.course || s.section_course || '-')}</td><td>${escapeHtml(formatRoom(s.room_lab))}</td><td>${escapeHtml(s.day || '-')}</td><td>${escapeHtml(`${format(s.start_time)} - ${format(s.end_time)}`)}</td></tr>`).join('') : '<tr><td class="notice" colspan="5">No schedules found.</td></tr>';
  };

  const loadSchedules = async () => {
    const response = await fetch(apiUrl('/api/schedule'));
    const schedules = await response.json();
    if (!response.ok) throw new Error();
    const groups = [...schedules.reduce((map, item) => {
      // Older rows may still carry the previous department name; map it to the
      // current one so every portal shows the same heading.
      const rawDepartment = String(item.department || '').trim();
      const department = /^(college|school) of computer studies$/i.test(rawDepartment)
        ? 'School of Information Technology'
        : rawDepartment || 'Not specified';
      const course = item.course || item.section_course || 'Not specified';
      const key = `${department}\u0000${course}`;
      if (!map.has(key)) map.set(key, { department, course, schedules: [] });
      map.get(key).schedules.push(item);
      return map;
    }, new Map())];

    // Custom group names are cosmetic; the real department/course stay BSIT.
    const groupLabelMap = await window.sisLoadGroupLabels?.() || {};

    choices.innerHTML = groups.length ? groups.map(([key, group], groupIndex) => {
      const professors = [...group.schedules.reduce((map, schedule) => {
        const professor = schedule.professor_name || 'Professor not assigned';
        if (!map.has(professor)) map.set(professor, []);
        map.get(professor).push(schedule);
        return map;
      }, new Map())];
      return `<div class="teacher-department-group"><button class="teacher-department-option" data-group="${groupIndex}">${escapeHtml(window.sisGroupLabel?.(group, groupLabelMap) || `${group.department} / ${group.course}`)}</button><div class="teacher-department-subject-options" data-professors="${groupIndex}" hidden>${professors.map(([professor], professorIndex) => `<button class="teacher-subject-option" data-group="${groupIndex}" data-professor="${professorIndex}">${escapeHtml(professor)}</button>`).join('')}</div></div>`;
    }).join('') : '<p class="notice">No schedules have been created.</p>';

    // Assigned with onclick so repeated refreshes replace the handler instead of
    // stacking a new one on every rebuild.
    choices.onclick = event => {
      const button = event.target.closest('[data-group]');
      if (!button) return;
      const group = groups[Number(button.dataset.group)][1];
      if (button.dataset.professor !== undefined) {
        const wasSelected = button.classList.contains('selected');
        if (wasSelected) {
          button.classList.remove('selected');
          body.innerHTML = '<tr><td class="notice" colspan="5">Choose a professor to view schedules.</td></tr>';
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
      choices.querySelectorAll('.teacher-department-option').forEach(item => item.classList.remove('selected'));
      professorOptions.hidden = !isOpening;
      button.classList.toggle('selected', isOpening);
    };
  };

  const loadSchedulesSafely = async () => {
    try {
      await loadSchedules();
    } catch {
      choices.innerHTML = '<p class="notice error">Unable to load schedules. Make sure the server is running.</p>';
    }
  };

  document.addEventListener('sis:refresh', loadSchedulesSafely);
  await loadSchedulesSafely();
});

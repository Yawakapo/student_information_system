document.addEventListener('DOMContentLoaded', async () => {
  if (!requireTeacher()) return;
  setupLogout();
  // Refresh the class-list data in place rather than reloading the page.
  window.sisOnDataChange?.(() => {
    if (document.visibilityState === 'visible') document.dispatchEvent(new CustomEvent('sis:refresh'));
  });
  const list = document.getElementById('subjectList');
  const panel = document.getElementById('assignedStudentsPanel');
  const body = document.getElementById('assignedStudentsBody');
  const title = document.getElementById('selectedSubjectTitle');
  const exportButton = document.getElementById('teacherExportClassList');
  let availableLists = [];
  let selectedStudents = [];
  let selectedClassList = null;
  let groupLabelMap = {};
  const escape = value => escapeHtml(value ?? '');
  const normalizeDepartment = value => /^(college|school) of computer studies$/i.test(String(value || '').trim()) ? 'School of Information Technology' : (value || 'Not specified');
  const label = item => `${item.subject || 'Untitled subject'} - ${item.section_course || 'No section'} (${item.day || 'No day'} / ${window.sisFormatClassTime?.(item.class_time || item.schedule_time) || item.class_time || item.schedule_time || 'Time not set'})`;

  const loadClassLists = async () => {
    const teacherUserId = localStorage.getItem('user_id') || '';
    const response = await fetch(apiUrl(`/api/class-list-schedules?teacher_user_id=${encodeURIComponent(teacherUserId)}`));
    if (!response.ok) throw new Error();
    const lists = await response.json();
    availableLists = lists;
    const dayOrder = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    lists.sort((first, second) => {
      const subjectComparison = String(first.subject || '').localeCompare(String(second.subject || ''));
      if (subjectComparison) return subjectComparison;
      const firstDay = dayOrder.indexOf(String(first.day || '').toLowerCase());
      const secondDay = dayOrder.indexOf(String(second.day || '').toLowerCase());
      return (firstDay === -1 ? dayOrder.length : firstDay) - (secondDay === -1 ? dayOrder.length : secondDay);
    });
    const groups = [...lists.reduce((map, item) => {
      const department = normalizeDepartment(item.department);
      const course = item.course || item.section_course || 'Not specified';
      const key = `${department}\u0000${course}`;
      if (!map.has(key)) map.set(key, { department, course, lists: [] });
      map.get(key).lists.push(item);
      return map;
    }, new Map())];
    // Custom group names are cosmetic; the real department/course stay BSIT.
    groupLabelMap = await window.sisLoadGroupLabels?.() || {};
    list.innerHTML = groups.length ? groups.map(([key, group], groupIndex) => { const professors = [...group.lists.reduce((map, item) => { const professor = item.professor_name || item.teacher_id || 'Professor not assigned'; if (!map.has(professor)) map.set(professor, []); map.get(professor).push(item); return map; }, new Map())]; return `<div class="teacher-department-group"><button class="teacher-department-option" type="button" data-department-index="${groupIndex}">${escape(window.sisGroupLabel?.(group, groupLabelMap) || `${group.department} / ${group.course}`)}</button><div class="teacher-department-subject-options" data-department-group="${groupIndex}" hidden>${professors.map(([professor, professorLists], professorIndex) => { const professorKey = `${groupIndex}-${professorIndex}`; return `<div class="teacher-subject-group"><button class="teacher-subject-option" type="button" data-subject-key="${professorKey}">${escape(professor)}</button><div class="teacher-schedule-options" data-schedule-group="${professorKey}" hidden>${professorLists.map(item => `<button class="subject-option" type="button" data-list-id="${escape(item.id)}">${escape(`${item.subject} (${item.day || 'No day'} / ${window.sisFormatClassTime?.(item.class_time) || item.class_time || 'Time not set'})`)}</button>`).join('')}</div></div>`; }).join('')}</div></div>`; }).join('') : '<p class="notice">No schedules have been created yet.</p>';
  };

  const loadClassListsSafely = async () => {
    try {
      await loadClassLists();
    } catch {
      list.innerHTML = '<p class="notice error">Unable to load class list schedules. Make sure the server is running.</p>';
    }
  };

  await loadClassListsSafely();

  document.addEventListener('sis:refresh', loadClassListsSafely);

  list.addEventListener('click', async event => {
    const departmentButton = event.target.closest('[data-department-index]');
    if (departmentButton) {
      const groupIndex = departmentButton.dataset.departmentIndex;
      const subjectGroup = list.querySelector(`[data-department-group="${groupIndex}"]`);
      const isOpening = subjectGroup.hidden;
      list.querySelectorAll('.teacher-department-subject-options').forEach(group => { group.hidden = true; });
      list.querySelectorAll('.teacher-department-option').forEach(button => button.classList.remove('selected'));
      subjectGroup.hidden = !isOpening;
      departmentButton.classList.toggle('selected', isOpening);
      return;
    }
    const subjectButton = event.target.closest('[data-subject-key]');
    if (subjectButton) {
      const subjectKey = subjectButton.dataset.subjectKey;
      const scheduleGroup = list.querySelector(`[data-schedule-group="${subjectKey}"]`);
      const isOpening = scheduleGroup.hidden;
      list.querySelectorAll('.teacher-schedule-options').forEach(group => { group.hidden = true; });
      list.querySelectorAll('.teacher-subject-option').forEach(button => button.classList.remove('selected'));
      scheduleGroup.hidden = !isOpening;
      subjectButton.classList.toggle('selected', isOpening);
      return;
    }
    const button = event.target.closest('[data-list-id]');
    if (!button) return;
    if (button.classList.contains('selected')) {
      button.classList.remove('selected');
      panel.hidden = true;
      selectedStudents = [];
      selectedClassList = null;
      if (exportButton) exportButton.disabled = true;
      return;
    }
    list.querySelectorAll('[data-list-id]').forEach(item => item.classList.toggle('selected', item === button));
    panel.hidden = false;
    selectedClassList = availableLists.find(item => String(item.id) === String(button.dataset.listId)) || null;
    selectedStudents = [];
    if (exportButton) exportButton.disabled = true;
    title.textContent = button.textContent.trim();
    body.innerHTML = '<tr><td class="notice" colspan="6">Loading students...</td></tr>';
    try {
      const response = await fetch(apiUrl(`/api/class-list-schedules/${encodeURIComponent(button.dataset.listId)}/students`));
      if (!response.ok) throw new Error();
      const students = await response.json();
      selectedStudents = students;
      selectedStudents.sort((first, second) => String(first.last_name || '').localeCompare(String(second.last_name || '')) || String(first.first_name || '').localeCompare(String(second.first_name || '')));
      if (exportButton) exportButton.disabled = selectedStudents.length === 0;
      body.innerHTML = selectedStudents.length ? selectedStudents.map(student => `<tr><td>${escape(student.student_no || '-')}</td><td>${escape(`${student.last_name || ''}, ${student.first_name || ''}`.replace(/^,\s*/, '') || '-')}</td><td>${escape(student.course || student.section_course || '-')}</td><td>${escape(student.year_level || '-')}</td><td>${escape(label(student))}</td><td><span class="status">${escape(student.status || 'Active')}</span></td></tr>`).join('') : '<tr><td class="notice" colspan="6">No students are assigned to this class list.</td></tr>';
    } catch {
      selectedStudents = [];
      if (exportButton) exportButton.disabled = true;
      body.innerHTML = '<tr><td class="notice error" colspan="6">Unable to load students.</td></tr>';
    }
  });

  exportButton?.addEventListener('click', () => {
    if (!selectedStudents.length || !window.SISClassListExport) return;
    const exporter = window.SISClassListExport;
    const rows = exporter.buildNameRows(selectedStudents);
    const baseName = selectedClassList ? exporter.buildFilename(selectedClassList).replace(/^BSIT_/, 'Professor_') : 'Professor_Class_List';
    if (window.XLSX) {
      const worksheet = window.XLSX.utils.json_to_sheet(rows);
      worksheet['!cols'] = Object.keys(rows[0]).map(() => ({ wch: 22 }));
      const workbook = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Class List');
      window.XLSX.writeFile(workbook, `${baseName}.xlsx`);
      return;
    }
    const url = URL.createObjectURL(new Blob([exporter.buildCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${baseName}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  });
});

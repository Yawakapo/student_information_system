let selectedStudents = [];
let currentClassListId = null;
let availableClassLists = [];
let availableProfessors = [];
let assignmentDetails = new Map();
let initialAssignmentIds = new Set();
let selectedAssignmentIds = new Set();
let activeAssignmentStudent = null;
let exportButton = null;
let groupLabelMap = {};
const BSIT_COURSE = 'BSIT';
const BSIT_DEPARTMENT = 'School of Information Technology';
const apiUrl = path => window.sisApiUrl?.(path) || ((window.location.port === '5000' || window.location.port === '') ? path : `${window.location.protocol === 'https:' ? 'https:' : 'http:'}//${window.location.hostname || 'localhost'}:5000${path}`);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
const normalizeDepartment = value => {
  const department = String(value || '').trim();
  return /^(college|school) of computer studies$/i.test(department) ? 'School of Information Technology' : department || 'Not specified';
};
const formatClassTime = value => window.sisFormatClassTime?.(value) || value || 'Time not set';
const scheduleDisplayLabel = list => {
  const subject = list.subject || 'Untitled subject';
  const professor = list.professor_name || list.teacher_id || 'Professor not assigned';
  const day = list.day || 'Day not set';
  return `${subject} · ${professor} · ${day} / ${formatClassTime(list.class_time || list.schedule_time)}`;
};

const renderAssignedSchedules = () => {
  const container = document.getElementById('simAssignedSchedules');
  if (!container) return;
  const selected = [...selectedAssignmentIds]
    .map(id => assignmentDetails.get(String(id)) || availableClassLists.find(list => String(list.id) === String(id)))
    .filter(Boolean);
  if (!selected.length) {
    container.innerHTML = '<p class="assignment-empty">No subjects assigned yet.</p>';
    return;
  }
  container.innerHTML = selected.map(list => `<div class="assigned-schedule-item">
    <span><strong>${escapeHtml(list.subject || 'Untitled subject')}</strong><small>${escapeHtml(list.professor_name || list.teacher_id || 'Professor not assigned')} · ${escapeHtml(list.day || 'Day not set')} · ${escapeHtml(formatClassTime(list.class_time || list.schedule_time))}</small></span>
    <button type="button" class="remove-schedule-assignment" data-remove-schedule-id="${escapeHtml(list.id)}" aria-label="Remove ${escapeHtml(list.subject || 'subject')}">×</button>
  </div>`).join('');
};

const renderScheduleOptions = () => {
  const container = document.getElementById('scheduleOptions');
  if (!container) return;
  const query = String(document.getElementById('scheduleSearch')?.value || '').trim().toLowerCase();
  const visible = availableClassLists.filter(list => !query || scheduleDisplayLabel(list).toLowerCase().includes(query));
  const groups = [...visible.reduce((map, list) => {
    const professor = list.professor_name || list.teacher_id || 'Professor not assigned';
    if (!map.has(professor)) map.set(professor, []);
    map.get(professor).push(list);
    return map;
  }, new Map())];
  if (!groups.length) {
    container.innerHTML = '<p class="assignment-empty">No matching subjects found.</p>';
    return;
  }
  container.innerHTML = groups.map(([professor, lists]) => `<div class="schedule-option-group">
    <h4>${escapeHtml(professor)}</h4>
    ${lists.map(list => `<label class="schedule-option">
      <input type="checkbox" data-schedule-id="${escapeHtml(list.id)}" ${selectedAssignmentIds.has(String(list.id)) ? 'checked' : ''}>
      <span>${escapeHtml(list.subject || 'Untitled subject')}<small>${escapeHtml(list.day || 'Day not set')} · ${escapeHtml(formatClassTime(list.class_time))}</small></span>
    </label>`).join('')}
  </div>`).join('');
};

document.addEventListener('DOMContentLoaded', async () => {
  if ((localStorage.getItem('role') || '').toLowerCase() !== 'admin') { window.location.href = '../Login%20part/login.html'; return; }
  const choices = document.getElementById('classListScheduleChoices');
  exportButton = document.getElementById('exportClassListButton');
  const classListForm = document.getElementById('addClassListForm');
  const classListProfessor = document.getElementById('classListProfessor');
  const classListMessage = document.getElementById('classListFormMessage');
  const renderClassListProfessorOptions = () => {
    if (!classListProfessor) return;
    const options = availableProfessors
      .filter(professor => String(professor.status || 'Active').toLowerCase() === 'active')
      .sort((first, second) => String(first.full_name || '').localeCompare(String(second.full_name || '')));
    classListProfessor.innerHTML = options.length
      ? '<option value="">Select Professor</option>' + options.map(professor => `<option value="${escapeHtml(professor.teacher_id)}">${escapeHtml(professor.full_name || professor.teacher_id)} (${escapeHtml(professor.teacher_id)})</option>`).join('')
      : '<option value="">No active professors found</option>';
    classListProfessor.disabled = options.length === 0;
  };
  document.getElementById('showClassListForm').addEventListener('click', () => { classListForm.hidden = !classListForm.hidden; });
  document.getElementById('cancelClassListForm').addEventListener('click', () => { classListForm.reset(); classListForm.hidden = true; classListMessage.textContent = ''; });
  classListForm.addEventListener('submit', async event => {
    event.preventDefault();
    classListMessage.textContent = '';
    const selectedProfessor = availableProfessors.find(professor => String(professor.teacher_id) === String(classListProfessor.value));
    const data = { department: BSIT_DEPARTMENT, course: BSIT_COURSE, professor_name: selectedProfessor?.full_name || '', teacher_id: selectedProfessor?.teacher_id || '', subject: document.getElementById('classListSubject').value.trim(), day: document.getElementById('classListDay').value, class_time: document.getElementById('classListTime').value.trim() };
    try {
      const response = await fetch(apiUrl('/api/class-list-schedules'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to add the class list schedule.');
      classListMessage.textContent = 'Class list schedule added.';
      // Rebuild the panel in place after a short pause so the success message
      // stays readable, instead of reloading the whole page.
      setTimeout(() => document.dispatchEvent(new CustomEvent('sis:refresh')), 500);
    } catch (error) { classListMessage.textContent = error.message || 'Unable to add the class list schedule.'; }
  });

  const schedulePicker = document.getElementById('schedulePicker');
  const scheduleSearch = document.getElementById('scheduleSearch');
  document.getElementById('toggleSchedulePicker')?.addEventListener('click', () => {
    if (!schedulePicker) return;
    schedulePicker.hidden = !schedulePicker.hidden;
    if (!schedulePicker.hidden) {
      renderScheduleOptions();
      scheduleSearch?.focus();
    }
  });
  scheduleSearch?.addEventListener('input', renderScheduleOptions);
  document.getElementById('scheduleOptions')?.addEventListener('change', event => {
    const checkbox = event.target.closest('input[data-schedule-id]');
    if (!checkbox) return;
    const id = String(checkbox.dataset.scheduleId);
    if (checkbox.checked) selectedAssignmentIds.add(id);
    else selectedAssignmentIds.delete(id);
    renderAssignedSchedules();
  });
  document.getElementById('simAssignedSchedules')?.addEventListener('click', event => {
    const removeButton = event.target.closest('[data-remove-schedule-id]');
    if (!removeButton) return;
    selectedAssignmentIds.delete(String(removeButton.dataset.removeScheduleId));
    renderAssignedSchedules();
    renderScheduleOptions();
  });
  document.getElementById('selectVisibleSchedules')?.addEventListener('click', () => {
    document.querySelectorAll('#scheduleOptions input[data-schedule-id]').forEach(checkbox => {
      selectedAssignmentIds.add(String(checkbox.dataset.scheduleId));
    });
    renderAssignedSchedules();
    renderScheduleOptions();
  });
  document.getElementById('clearScheduleSelection')?.addEventListener('click', () => {
    selectedAssignmentIds.clear();
    renderAssignedSchedules();
    renderScheduleOptions();
  });

  // Remember which groups the admin had open. Without this, every refresh
  // rebuilt the panel fully collapsed, so an edit looked like it did nothing.
  const capturePanelState = () => ({
    departments: [...choices.querySelectorAll('[data-department-group]')]
      .filter(node => !node.hidden)
      .map(node => node.dataset.departmentGroup),
    schedules: [...choices.querySelectorAll('[data-schedule-group]')]
      .filter(node => !node.hidden)
      .map(node => node.dataset.scheduleGroup),
    selectedListId: currentClassListId || null
  });

  const restorePanelState = state => {
    if (!state) return;
    state.departments.forEach(key => {
      const group = choices.querySelector(`[data-department-group="${key}"]`);
      const button = choices.querySelector(`.department-course-option[data-department-index="${key}"]`);
      if (group) group.hidden = false;
      if (button) button.classList.add('selected');
    });
    state.schedules.forEach(key => {
      const group = choices.querySelector(`[data-schedule-group="${key}"]`);
      const button = choices.querySelector(`.class-list-subject-option[data-subject-key="${key}"]`);
      if (group) group.hidden = false;
      if (button) button.classList.add('selected');
    });
    // Keep the student panel open on the same class list so the edit is visible.
    if (state.selectedListId) {
      const listButton = choices.querySelector(`.admin-class-list-option[data-list-id="${state.selectedListId}"]`);
      if (listButton) {
        listButton.classList.add('selected');
        currentClassListId = state.selectedListId;
        loadStudentsForClassList(state.selectedListId).catch(() => {});
      }
    }
  };

  const loadClassListChoices = async () => {
    const panelState = capturePanelState();
    const [response, teacherResponse] = await Promise.all([
      fetch(apiUrl('/api/class-list-schedules')),
      fetch(apiUrl('/api/admin/teachers'))
    ]);
    if (!response.ok) throw new Error();
    const lists = await response.json();
    const professors = teacherResponse.ok ? await teacherResponse.json() : [];
    availableProfessors = Array.isArray(professors) ? professors : [];
    renderClassListProfessorOptions();
    availableClassLists = lists;
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    lists.sort((a, b) => String(a.subject).localeCompare(String(b.subject)) || days.indexOf(String(a.day).toLowerCase()) - days.indexOf(String(b.day).toLowerCase()));

    const professorMap = new Map();
    const professorKey = item => String(item.teacher_id || '').trim().toLowerCase() || String(item.professor_name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    const addProfessorEntry = item => {
      const key = professorKey(item) || `unknown-${Math.random()}`;
      if (!professorMap.has(key)) professorMap.set(key, []);
      professorMap.get(key).push(item);
    };
    professors.forEach(professor => addProfessorEntry({
      ...professor,
      id: null,
      teacher_id: professor.teacher_id,
      professor_name: professor.full_name,
      department: professor.department || BSIT_DEPARTMENT,
      course: BSIT_COURSE,
      noSchedule: true
    }));
    lists.forEach(list => addProfessorEntry(list));

    const groups = [...professorMap.values()].reduce((map, professorLists) => {
      const first = professorLists[0] || {};
      const department = normalizeDepartment(first.department);
      const course = first.course || first.section_course || BSIT_COURSE;
      const key = `${department}\u0000${course}`;
      if (!map.has(key)) map.set(key, { department, course, professors: [] });
      map.get(key).professors.push(professorLists);
      return map;
    }, new Map());

    // Custom names are cosmetic overrides; the real department/course stay BSIT.
    groupLabelMap = await window.sisLoadGroupLabels?.() || {};

    choices.innerHTML = groups.size ? [...groups.entries()].map(([key, group], groupIndex) => {
      const groupLabels = window.sisGroupLabel?.(group, groupLabelMap) || `${group.department} / ${group.course}`;
      const professorMarkup = group.professors.map((professorLists, professorIndex) => {
        const professorKeyValue = `${groupIndex}-${professorIndex}`;
        const first = professorLists[0] || {};
        const professorName = first.professor_name || first.teacher_id || 'Professor not assigned';
        const scheduleMarkup = professorLists.filter(list => list.id).map(list => `<div class="class-list-schedule-row"><button class="admin-class-list-option" data-list-id="${list.id}">${escapeHtml(`${list.subject} (${list.day} / ${formatClassTime(list.class_time)})`)}</button><button type="button" class="edit-class-list" data-edit-list-id="${list.id}">Edit</button><button type="button" class="delete-class-list" data-delete-list-id="${list.id}">Delete</button></div>`).join('');
        return `<div class="class-list-subject-group"><button class="class-list-subject-option" data-subject-key="${professorKeyValue}">${escapeHtml(professorName)}</button><div class="class-list-schedule-options" data-schedule-group="${professorKeyValue}" hidden>${scheduleMarkup || '<p class="no-schedule-message">No class-list schedule assigned yet.</p>'}</div></div>`;
      }).join('');
      // The group map key contains a NUL separator, which is not valid inside an
      // HTML attribute, so the department and course travel as separate values.
      return `<div class="department-course-group"><div class="department-course-row"><button class="department-course-option" data-department-index="${groupIndex}">${escapeHtml(groupLabels)}</button><button type="button" class="edit-group-label" data-edit-department="${escapeHtml(group.department)}" data-edit-course="${escapeHtml(group.course)}" title="Change this group name">Edit</button></div><div class="department-subject-options" data-department-group="${groupIndex}" hidden>${professorMarkup}</div></div>`;
    }).join('') : 'No professors or class lists have been created yet.';

    // Reopen the groups the admin was looking at, so the edited values are
    // visible immediately instead of the panel snapping shut.
    restorePanelState(panelState);
  };

  const loadClassListChoicesSafely = async () => {
    try {
      await loadClassListChoices();
    } catch (error) {
      // Log the real reason so a code mistake is not hidden behind a generic
      // message, and show it in the panel for the admin to report.
      console.error('Class list panel failed to load.', error);
      choices.textContent = `Unable to load professors and class-list schedules. (${error.message || 'unknown error'})`;
    }
  };

  await loadClassListChoicesSafely();

  document.addEventListener('sis:refresh', loadClassListChoicesSafely);

  initEditDialog();

  // Assigned with onclick so repeated refreshes replace the handler rather than
  // stacking a new one on every rebuild.
  choices.onclick = async event => {
    const deleteButton = event.target.closest('[data-delete-list-id]');
    if (deleteButton) { event.stopPropagation(); deleteClassListSchedule(deleteButton.dataset.deleteListId); return; }
    const editButton = event.target.closest('[data-edit-list-id]');
    if (editButton) { event.stopPropagation(); openClassListEditor(editButton.dataset.editListId); return; }
    const groupEditButton = event.target.closest('[data-edit-department]');
    if (groupEditButton) {
      event.stopPropagation();
      openGroupLabelEditor(groupEditButton.dataset.editDepartment, groupEditButton.dataset.editCourse);
      return;
    }
    const departmentButton = event.target.closest('[data-department-index]');
    if (departmentButton) {
      const groupIndex = departmentButton.dataset.departmentIndex;
      const subjectGroup = choices.querySelector(`[data-department-group="${groupIndex}"]`);
      const isOpening = subjectGroup.hidden;
      choices.querySelectorAll('.department-subject-options').forEach(group => { group.hidden = true; });
      choices.querySelectorAll('.department-course-option').forEach(button => button.classList.remove('selected'));
      subjectGroup.hidden = !isOpening;
      departmentButton.classList.toggle('selected', isOpening);
      return;
    }
    const subjectButton = event.target.closest('[data-subject-key]');
    if (subjectButton) {
      const subjectKey = subjectButton.dataset.subjectKey;
      const scheduleGroup = choices.querySelector(`[data-schedule-group="${subjectKey}"]`);
      const isOpening = scheduleGroup.hidden;
      choices.querySelectorAll('.class-list-schedule-options').forEach(group => { group.hidden = true; });
      choices.querySelectorAll('.class-list-subject-option').forEach(button => button.classList.remove('selected'));
      scheduleGroup.hidden = !isOpening;
      subjectButton.classList.toggle('selected', isOpening);
      return;
    }
    const button = event.target.closest('[data-list-id]'); if (!button) return;
    if (button.classList.contains('selected')) {
      button.classList.remove('selected');
      document.getElementById('adminStudentsPanel').hidden = true;
      if (exportButton) exportButton.disabled = true;
      currentClassListId = null;
      return;
    }
    currentClassListId = button.dataset.listId;
    choices.querySelectorAll('.admin-class-list-option').forEach(item => item.classList.toggle('selected', item === button));
    await loadStudentsForClassList(currentClassListId);
  };

  exportButton?.addEventListener('click', exportSelectedClassList);

  // The top-level place to send students who have no professor. The panel is
  // already visible, so a second press puts it away again.
  const unassignedButton = document.getElementById('showUnassignedButton');
  unassignedButton?.addEventListener('click', async () => {
    const panel = document.getElementById('unassignedPanel');
    if (panel && !panel.hidden) { closeUnassignedInlinePanel(); return; }
    // The class lists have to be current before the dropdowns can be built.
    // loadClassListChoicesSafely is declared inside this handler, so the
    // refresh has to happen here rather than inside openUnassignedPanel.
    await loadClassListChoicesSafely();
    openUnassignedPanel();
  });
  document.getElementById('closeUnassignedPanel')?.addEventListener('click', closeUnassignedInlinePanel);
  // Rebuild the class-list panel in place instead of reloading the page.
  window.sisOnDataChange?.(() => {
    if (document.visibilityState !== 'visible') return;
    document.dispatchEvent(new CustomEvent('sis:refresh'));
  });

  document.getElementById('studentTableBody').addEventListener('click', event => {
    const row = event.target.closest('[data-student-index]'); if (row) openStudentPreview(Number(row.dataset.studentIndex));
  });
});

// loadClassListChoicesSafely and the element it draws into are declared inside
// the page-start handler, so anything running later cannot call them directly.
// It already listens for this event, so a refresh is requested through it.
const refreshClassListChoices = () =>
  document.dispatchEvent(new CustomEvent('sis:refresh'));

// Pressing the button reveals the students who have no professor, each with a
// dropdown of the classes they could join, grouped by professor. It is a plain
// inline panel rather than a dialog, so the list simply appears under the button
// and there is no overlay or card styling that can fail to apply.
async function openUnassignedPanel() {
  const panel = document.getElementById('unassignedPanel');
  const body = document.getElementById('unassignedPanelBody');
  if (!panel || !body) return;

  // Only class lists that already have a professor are worth offering.
  const targets = availableClassLists.filter(list => String(list.teacher_id || '').trim() !== '');
  panel.hidden = false;
  body.innerHTML = '<p class="unassigned-loading">Looking for students without a professor...</p>';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    const response = await fetch(apiUrl('/api/students/unassigned'));
    if (!response.ok) throw new Error('Unable to load students without a professor.');
    const students = await response.json();

    if (!students.length) {
      body.innerHTML = '<p class="unassigned-empty">Every student already has a professor. Nothing to assign.</p>';
      return;
    }
    if (!targets.length) {
      body.innerHTML = '<p class="unassigned-warning">No class list has a professor yet. Set a professor on a class list first, then assign the students.</p>';
      return;
    }

    const grouped = targets.reduce((map, list) => {
      const key = String(list.professor_name || list.teacher_id || 'Professor not assigned');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(list);
      return map;
    }, new Map());

    // Built once and reused, so each dropdown holds the list exactly once.
    const classOptionHtml = [...grouped.entries()].map(([professor, lists]) => `
      <optgroup label="${escapeHtml(professor)}">
        ${lists.map(list => `<option value="${escapeHtml(list.id)}">${escapeHtml(list.subject || 'Untitled subject')} (${escapeHtml(list.day || 'Day not set')} / ${escapeHtml(formatClassTime(list.class_time || list.schedule_time))})</option>`).join('')}
      </optgroup>`).join('');

    const rows = students.map(student => `
      <tr data-unassigned-row="${escapeHtml(student.student_no || '')}">
        <td>${escapeHtml(student.student_no || '-')}</td>
        <td><strong>${escapeHtml(`${student.last_name || ''}, ${student.first_name || ''}`.replace(/^,\s*/, ''))}</strong></td>
        <td>${escapeHtml(student.year_level || '-')}</td>
        <td>
          <select class="unassigned-target" aria-label="Choose a class for ${escapeHtml(student.student_no || '')}">
            <option value="">Choose a class...</option>
            ${classOptionHtml}
          </select>
        </td>
        <td><span class="status-badge ${String(student.account_status || student.status || 'active').toLowerCase() === 'active' ? 'status-active' : 'status-inactive'}">${escapeHtml(student.account_status || student.status || 'Active')}</span></td>
        <td class="unassigned-action-cell">
          <button type="button" class="unassigned-assign-btn" data-assign-one="${escapeHtml(student.student_no || '')}">Assign</button>
        </td>
      </tr>`).join('');

    body.innerHTML = `
      <p class="unassigned-note">
        ${students.length} student${students.length === 1 ? '' : 's'} waiting. Choose a class for each one, then press Assign.
        Assigning also switches an account back on if it was switched off for having no class.
      </p>
      <table class="unassigned-table">
        <thead>
          <tr><th>Student ID</th><th>Student</th><th>Year</th><th>Assign to</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

    body.querySelectorAll('[data-assign-one]').forEach(button => {
      button.addEventListener('click', () => assignOneFromPanel(button));
    });
  } catch (error) {
    body.innerHTML = `<p class="unassigned-empty">${escapeHtml(error.message || 'Unable to load students without a professor.')}</p>`;
  }
}

const closeUnassignedInlinePanel = () => {
  const panel = document.getElementById('unassignedPanel');
  if (panel) panel.hidden = true;
};

async function assignOneFromPanel(button) {
  const row = button.closest('[data-unassigned-row]');
  const select = row?.querySelector('.unassigned-target');
  const studentNo = button.dataset.assignOne;
  if (!select || !select.value) {
    alert('Choose a class for this student first.');
    select?.focus();
    return;
  }

  const target = availableClassLists.find(item => String(item.id) === String(select.value));
  const where = target
    ? `${target.subject || 'this class'} under ${target.professor_name || target.teacher_id} (${target.day || ''})`
    : 'the chosen class';
  if (!window.confirm(`Assign ${studentNo} to ${where}?`)) return;

  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Assigning...';

  try {
    const response = await fetch(apiUrl(`/api/class-list-schedules/students/${encodeURIComponent(studentNo)}/assign`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ class_list_schedule_ids: [Number(select.value)], reactivate: true })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Unable to assign the student.');

    // Take the row away so it is obvious who is still left.
    row.remove();
    const left = document.querySelectorAll('#unassignedPanelBody [data-unassigned-row]').length;
    if (!left) {
      document.getElementById('unassignedPanelBody').innerHTML =
        '<p class="unassigned-empty">Every student now has a professor. Nothing left to assign.</p>';
    }
    // The class list tree is now out of date.
    refreshClassListChoices();
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    alert(error.message || 'Unable to assign the student.');
  }
}

// Puts a professor-less student under the professor of the class list on screen,
// and enrols them in it. Assigning a class also copies that professor onto the
// student record, so one action gives them both a professor and a schedule.
async function assignUnassignedStudent(button, studentNo) {
  const list = availableClassLists.find(item => String(item.id) === String(currentClassListId));
  if (!list || !list.teacher_id) {
    alert('This class list has no professor yet. Open its Edit dialog and set a professor first.');
    return;
  }

  const who = `${list.subject || 'this class'} under ${list.professor_name || list.teacher_id}`;
  if (!window.confirm(`Assign ${studentNo} to ${who}?\n\nIf their account was switched off for having no class, it will be switched back on.`)) {
    return;
  }

  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Assigning...';

  try {
    const response = await fetch(apiUrl(`/api/class-list-schedules/students/${encodeURIComponent(studentNo)}/assign`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ class_list_schedule_ids: [Number(currentClassListId)], reactivate: true })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Unable to assign the student.');

    // No separate banner on this page, so the confirmation is the refreshed
    // table itself: the student is no longer listed as having no professor.
    await loadStudentsForClassList(currentClassListId);
    if (data.account_restored) {
      alert(`${studentNo} is now under ${list.professor_name || list.teacher_id}.\n\nTheir account was switched back to Active so they can sign in again.`);
    }
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    alert(error.message || 'Unable to assign the student.');
  }
}

async function loadStudentsForClassList(id) {
  if (!id) return;
  const panel = document.getElementById('adminStudentsPanel');
  const body = document.getElementById('studentTableBody');
  if (!panel || !body) return;
  panel.hidden = false;
  selectedStudents = [];
  if (exportButton) exportButton.disabled = true;
  body.innerHTML = '<tr><td colspan="6">Loading students...</td></tr>';
  try {
    const response = await fetch(apiUrl(`/api/class-list-schedules/${encodeURIComponent(id)}/students`));
    if (!response.ok) throw new Error('Unable to load students.');
    selectedStudents = await response.json();
    selectedStudents.sort((a, b) => String(a.last_name || '').localeCompare(String(b.last_name || '')) || String(a.first_name || '').localeCompare(String(b.first_name || '')));
    if (exportButton) exportButton.disabled = selectedStudents.length === 0;
    const rosterRows = selectedStudents.map((student, index) => `<tr data-student-index="${index}"><td>${escapeHtml(student.student_no)}</td><td><strong>${escapeHtml(`${student.last_name || ''}, ${student.first_name || ''}`.replace(/^,\s*/, ''))}</strong></td><td>${escapeHtml(student.year_level)}</td><td>${escapeHtml(student.section_course || student.course || '-')}</td><td>${escapeHtml(`${student.subject} - ${student.section_course} (${student.day})`)}</td><td><span class="status-badge status-${String(student.status || 'active').toLowerCase()}">${escapeHtml(student.status || 'Active')}</span></td></tr>`).join('');

    // Students with no professor are handled once, from the toolbar button, rather
    // than repeating the same list under every class list on the page.
    body.innerHTML = rosterRows
      || '<tr><td colspan="6" class="empty-class-list-cell"><p class="unassigned-empty-line">No students are assigned to this class list.</p></td></tr>';
  } catch (error) {
    body.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message || 'Unable to load students.')}</td></tr>`;
  }
}

async function deleteClassListSchedule(id) {
  const list = availableClassLists.find(item => String(item.id) === String(id));
  if (!list) return;
  const label = `${list.subject || 'Untitled subject'} — ${list.professor_name || list.teacher_id || 'Professor not assigned'}`;
  const confirmed = window.confirm(`Delete ${label}?\n\nThe schedule will be removed from the admin and professor portals. Students are kept, but their schedule assignments will be cleared.`);
  if (!confirmed) return;
  try {
    const response = await fetch(apiUrl(`/api/class-list-schedules/${encodeURIComponent(id)}`), { method: 'DELETE' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || 'Unable to delete the schedule.');
    document.dispatchEvent(new CustomEvent('sis:refresh'));
  } catch (error) {
    alert(error.message || 'Unable to delete the schedule.');
  }
}

/* =====================================================================
   CLASS LIST EDIT DIALOG
   One form handles two jobs: renaming a department/course group, and
   editing a single schedule. Cancel always cancels cleanly.
   ===================================================================== */
const editDialog = {
  modal: null, form: null, title: null, subtitle: null, message: null,
  labelFields: null, scheduleFields: null, idField: null,
  labelInput: null, subjectInput: null, dayInput: null,
  timeInput: null, professorInput: null, saveButton: null,
  mode: 'schedule'
};

const initEditDialog = () => {
  editDialog.modal = document.getElementById('classListEditModal');
  if (!editDialog.modal) return false;
  editDialog.form = document.getElementById('classListEditForm');
  editDialog.title = document.getElementById('classListEditTitle');
  editDialog.subtitle = document.getElementById('classListEditSubtitle');
  editDialog.message = document.getElementById('classListEditMessage');
  editDialog.labelFields = document.getElementById('classListLabelFields');
  editDialog.scheduleFields = document.getElementById('classListScheduleFields');
  editDialog.idField = document.getElementById('classListEditId');
  editDialog.labelInput = document.getElementById('classListLabelInput');
  editDialog.subjectInput = document.getElementById('classListEditSubject');
  editDialog.dayInput = document.getElementById('classListEditDay');
  editDialog.timeInput = document.getElementById('classListEditTime');
  editDialog.professorInput = document.getElementById('classListEditProfessor');
  editDialog.saveButton = document.getElementById('classListEditSave');
  // Start hidden using the same inline-style mechanism the shared overlay uses.
  editDialog.modal.hidden = true;
  editDialog.modal.style.display = 'none';

  const close = () => closeEditDialog();
  document.getElementById('classListEditClose')?.addEventListener('click', close);
  document.getElementById('classListEditCancel')?.addEventListener('click', close);
  // Clicking the backdrop closes, but not a click inside the card.
  editDialog.modal.addEventListener('click', event => {
    if (event.target === editDialog.modal) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !editDialog.modal.hidden) close();
  });
  editDialog.form.addEventListener('submit', submitEditDialog);
  return true;
};

const setEditMessage = (value, isError = false) => {
  if (!editDialog.message) return;
  editDialog.message.textContent = value;
  editDialog.message.className = isError ? 'class-list-edit-message error' : 'class-list-edit-message';
};

const closeEditDialog = () => {
  if (editDialog.modal) {
    editDialog.modal.hidden = true;
    // The shared .modal-overlay rule sets display:none, so the inline style is
    // what actually shows and hides this dialog.
    editDialog.modal.style.display = 'none';
  }
  setEditMessage('');
};

const showEditDialog = (mode, values = {}) => {
  if (!editDialog.modal) return;
  editDialog.mode = mode;
  const renaming = mode === 'label';
  // Set both the attribute and the inline display, because these containers
  // have their own display rule that would otherwise defeat [hidden].
  editDialog.labelFields.hidden = !renaming;
  editDialog.labelFields.style.display = renaming ? 'block' : 'none';
  editDialog.scheduleFields.hidden = renaming;
  editDialog.scheduleFields.style.display = renaming ? 'none' : 'grid';
  // A hidden required field stays invalid and cannot be focused, which made
  // reportValidity() throw "invalid form control is not focusable". Disable the
  // fields that do not belong to the current mode so validation only checks
  // the visible ones.
  editDialog.labelInput.disabled = !renaming;
  editDialog.labelInput.required = renaming;
  [editDialog.subjectInput, editDialog.dayInput, editDialog.timeInput].forEach(input => {
    input.disabled = renaming;
    input.required = !renaming;
  });
  editDialog.subtitle.textContent = renaming ? 'GROUP NAME' : 'CLASS LIST SCHEDULE';
  editDialog.title.textContent = renaming ? 'Edit Group Name' : 'Edit Schedule';
  editDialog.idField.value = values.id || '';
  editDialog.labelInput.value = values.label || '';
  editDialog.subjectInput.value = values.subject || '';
  editDialog.dayInput.value = values.day || '';
  editDialog.timeInput.value = values.time || '';
  editDialog.professorInput.value = values.professor || '';
  setEditMessage('');
  editDialog.modal.hidden = false;
  editDialog.modal.style.display = 'flex';
  const firstField = renaming ? editDialog.labelInput : editDialog.subjectInput;
  firstField?.focus();
  firstField?.select?.();
};

/* Renames only the visible group heading. The stored department and course
   stay BSIT, so this cannot widen the system beyond BSIT. */
function openGroupLabelEditor(department, course) {
  if (!department || !course) {
    console.warn('Group label edit needs both a department and a course.', { department, course });
    return;
  }
  if (!editDialog.modal) {
    console.error('The class list edit dialog is missing from the page.');
    return;
  }
  const current = window.sisGroupLabel?.({ department, course }, groupLabelMap)
    || `${department} / ${course}`;
  showEditDialog('label', { label: current });
  editDialog.labelInput.dataset.department = department;
  editDialog.labelInput.dataset.course = course;
}

/* Edits only the fields of one schedule. */
function openClassListEditor(id) {
  const list = availableClassLists.find(item => String(item.id) === String(id));
  if (!list) {
    console.warn('No class list found for that edit button.', id);
    return;
  }
  if (!editDialog.modal) {
    console.error('The class list edit dialog is missing from the page.');
    return;
  }
  showEditDialog('schedule', {
    id: list.id,
    subject: list.subject || '',
    day: list.day || '',
    time: formatClassTime(list.class_time),
    professor: list.professor_name || list.teacher_id || ''
  });
}

async function submitEditDialog(event) {
  event.preventDefault();
  setEditMessage('');
  if (!editDialog.form.reportValidity()) return;

  editDialog.saveButton.disabled = true;
  const originalText = editDialog.saveButton.textContent;
  editDialog.saveButton.textContent = 'Saving...';
  try {
    if (editDialog.mode === 'label') {
      const displayLabel = editDialog.labelInput.value.trim();
      if (!displayLabel) throw new Error('Enter a name for this group.');
      const response = await fetch(apiUrl('/api/class-list-schedules/group-labels'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          department: editDialog.labelInput.dataset.department,
          course: editDialog.labelInput.dataset.course,
          display_label: displayLabel
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'Unable to update the group name.');
      closeEditDialog();
      document.dispatchEvent(new CustomEvent('sis:refresh'));
      return;
    }

    const id = editDialog.idField.value;
    const list = availableClassLists.find(item => String(item.id) === String(id));
    if (!list) throw new Error('This schedule is no longer available. Refresh and try again.');
    // Department and course are always the BSIT values.
    const response = await fetch(apiUrl(`/api/class-list-schedules/${encodeURIComponent(id)}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department: BSIT_DEPARTMENT,
        course: BSIT_COURSE,
        professor_name: editDialog.professorInput.value.trim(),
        subject: editDialog.subjectInput.value.trim(),
        day: editDialog.dayInput.value.trim(),
        class_time: editDialog.timeInput.value.trim()
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || 'Unable to update the class list.');
    closeEditDialog();
    document.dispatchEvent(new CustomEvent('sis:refresh'));
  } catch (error) {
    setEditMessage(error.message || 'Unable to save the changes.', true);
  } finally {
    editDialog.saveButton.disabled = false;
    editDialog.saveButton.textContent = originalText;
  }
}

function exportSelectedClassList() {
  if (!currentClassListId || !selectedStudents.length) return;
  const classInfo = availableClassLists.find(item => String(item.id) === String(currentClassListId)) || {};
  const exporter = window.SISClassListExport;
  if (!exporter) return;
  const rows = exporter.buildRows(selectedStudents, classInfo, formatClassTime);
  const filename = exporter.buildFilename(classInfo);

  if (window.XLSX) {
    const worksheet = window.XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = Object.keys(rows[0]).map(() => ({ wch: 22 }));
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Class List');
    window.XLSX.writeFile(workbook, `${filename}.xlsx`);
    return;
  }

  const url = URL.createObjectURL(new Blob([exporter.buildCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function openStudentPreview(index) {
  const student = selectedStudents[index];
  if (!student) return;
  const setText = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value || '-'; };
  activeAssignmentStudent = student;
  assignmentDetails = new Map();
  initialAssignmentIds = new Set();
  selectedAssignmentIds = new Set();
  setText('simName', `${student.last_name || ''}, ${student.first_name || ''}`.replace(/^,\s*/, ''));
  setText('simCourse', student.section_course || student.course);
  setText('simYear', student.year_level);
  setText('simId', student.student_no);
  setText('simGender', student.gender);
  setText('simBirthday', student.birthday ? String(student.birthday).split('T')[0] : '-');
  setText('simSchedule', 'Loading assigned subjects...');
  setText('simContact', student.contact_number);
  setText('simEmergencyContact', student.emergency_contact_number);
  setText('simAddress', student.address);
  const statusSelect = document.getElementById('simStatusSelect');
  statusSelect.value = student.status || 'Active';
  const schedulePicker = document.getElementById('schedulePicker');
  const scheduleSearch = document.getElementById('scheduleSearch');
  if (schedulePicker) schedulePicker.hidden = true;
  if (scheduleSearch) scheduleSearch.value = '';
  document.getElementById('simAssignedSchedules').innerHTML = '<p class="assignment-empty">Loading assigned subjects...</p>';
  document.getElementById('saveStatusBtn').onclick = () => saveStudentChanges(student, statusSelect.value);
  document.getElementById('confirmDeleteBtn').onclick = () => deleteStudent(student);
  hideDeleteConfirm();
  document.getElementById('studentPreviewModal').style.display = 'flex';

  try {
    const response = await fetch(apiUrl(`/api/class-list-schedules/students/${encodeURIComponent(student.student_no)}/assignments`));
    const result = await response.json().catch(() => ([]));
    if (!response.ok) throw new Error(result.message || 'Unable to load assigned subjects.');
    if (activeAssignmentStudent?.student_no !== student.student_no) return;
    const assignments = Array.isArray(result) ? result : [];
    assignmentDetails = new Map(assignments.map(assignment => [String(assignment.id), assignment]));
    initialAssignmentIds = new Set(assignments.map(assignment => String(assignment.id)));
    selectedAssignmentIds = new Set(initialAssignmentIds);
    renderAssignedSchedules();
    if (assignments.length > 1) {
      setText('simSchedule', `${assignments.length} subjects assigned`);
    } else if (assignments.length === 1) {
      setText('simSchedule', scheduleDisplayLabel(assignments[0]));
    } else {
      setText('simSchedule', 'No subjects assigned');
    }
  } catch (error) {
    if (activeAssignmentStudent?.student_no !== student.student_no) return;
    renderAssignedSchedules();
    setText('simSchedule', error.message || 'Unable to load assigned subjects.');
  }
}

async function saveStudentChanges(student, status) {
  try {
    const desiredIds = new Set([...selectedAssignmentIds].map(String));
    const originalIds = new Set([...initialAssignmentIds].map(String));
    const removals = [...originalIds].filter(id => !desiredIds.has(id));
    const additions = [...desiredIds].filter(id => !originalIds.has(id));

    for (const classListId of removals) {
      const response = await fetch(apiUrl(`/api/class-list-schedules/students/${encodeURIComponent(student.student_no)}/assignments/${encodeURIComponent(classListId)}`), { method: 'DELETE' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'Unable to remove a subject assignment.');
    }
    if (additions.length) {
      const response = await fetch(apiUrl(`/api/class-list-schedules/students/${encodeURIComponent(student.student_no)}/assign`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_list_schedule_ids: additions.map(Number) })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'Unable to add subject assignments.');
    }

    if (status !== student.status) await updateStatus(student, status);
    else { closeStudentPreviewDirect(); await refreshCurrentClassList(); }
  } catch (error) { alert(error.message || 'Unable to save student changes.'); }
}

async function refreshCurrentClassList() {
  if (!currentClassListId) return;
  await loadStudentsForClassList(currentClassListId);
}
async function updateStatus(student, status) {
  const response = await fetch(apiUrl(`/api/students/${encodeURIComponent(student.student_no)}/status`), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status })
  });
  if (response.ok) {
    student.status = status;
    closeStudentPreviewDirect();
    refreshCurrentClassList();
    return;
  }
  const result = await response.json().catch(() => ({}));
  alert(result.message || 'Unable to update student status.');
}
async function deleteStudent(student) { const response = await fetch(apiUrl(`/api/students/${encodeURIComponent(student.student_no)}`), { method: 'DELETE' }); if (response.ok) { closeStudentPreviewDirect(); refreshCurrentClassList(); } else alert('Unable to delete student.'); }
function closeStudentPreviewDirect() { document.getElementById('studentPreviewModal').style.display = 'none'; }
function closeStudentPreview(event) { if (event.target.id === 'studentPreviewModal') closeStudentPreviewDirect(); }
function showDeleteConfirm() { document.getElementById('defaultActions').style.display = 'none'; document.getElementById('deleteConfirmBox').style.display = 'block'; }
function hideDeleteConfirm() { document.getElementById('defaultActions').style.display = 'flex'; document.getElementById('deleteConfirmBox').style.display = 'none'; }

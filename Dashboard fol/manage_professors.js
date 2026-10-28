document.addEventListener('DOMContentLoaded', () => {
  if ((localStorage.getItem('role') || '').toLowerCase() !== 'admin') {
    window.location.href = '../Login%20part/login.html';
    return;
  }

  const api = path => window.sisApiUrl?.(path) || ((window.location.port === '5000' || window.location.port === '') ? path : `${window.location.protocol === 'https:' ? 'https:' : 'http:'}//${window.location.hostname || 'localhost'}:5000${path}`);
  const body = document.getElementById('professorsTableBody');
  const pageMessage = document.getElementById('professorsMessage');
  const formPanel = document.getElementById('professorFormPanel');
  const form = document.getElementById('professorForm');
  const formMessage = document.getElementById('professorFormMessage');
  const search = document.getElementById('professorSearch');
  const accountFilter = document.getElementById('professorAccountFilter');
  const refreshButton = document.getElementById('refreshProfessors');
  const addButton = document.getElementById('addProfessorButton');
  const closeButton = document.getElementById('closeProfessorForm');
  const cancelButton = document.getElementById('cancelProfessorForm');
  const saveButton = document.getElementById('saveProfessorButton');
  let professors = [];
  let busy = false;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));

  const setPageMessage = (value, isError = false) => {
    pageMessage.textContent = value;
    pageMessage.className = `users-message${isError ? ' error' : ''}`;
  };

  const setFormMessage = (value, isError = false) => {
    formMessage.textContent = value;
    formMessage.className = `users-message${isError ? ' error' : ''}`;
  };

  const render = () => {
    const query = search.value.trim().toLowerCase();
    const account = accountFilter.value;
    const filtered = professors.filter(professor => {
      const matchesQuery = !query || [professor.teacher_id, professor.full_name, professor.email, professor.account_username]
        .some(value => String(value || '').toLowerCase().includes(query));
      const matchesAccount = !account
        || (account === 'linked' && Boolean(professor.account_username))
        || (account === 'unlinked' && !professor.account_username);
      return matchesQuery && matchesAccount;
    });

    if (!filtered.length) {
      body.innerHTML = '<tr><td colspan="6" class="table-message">No professors match the current filters.</td></tr>';
      return;
    }

    body.innerHTML = filtered.map(professor => {
      const status = String(professor.status || 'Active');
      return `<tr>
        <td><strong>${escapeHtml(professor.teacher_id)}</strong></td>
        <td><span class="professor-name">${escapeHtml(professor.full_name)}</span><span class="professor-meta">${escapeHtml(professor.email || 'No email')}</span></td>
        <td>${professor.account_username ? `<strong>${escapeHtml(professor.account_username)}</strong><span class="professor-meta">${escapeHtml(professor.account_status || 'Unknown')}</span>` : '<span class="professor-meta">No login account</span>'}</td>
        <td>${Number(professor.schedule_count) || 0} schedule${Number(professor.schedule_count) === 1 ? '' : 's'}<span class="professor-meta">${Number(professor.class_list_count) || 0} class list${Number(professor.class_list_count) === 1 ? '' : 's'}</span></td>
        <td><span class="status-badge status-${status.toLowerCase() === 'inactive' ? 'inactive' : 'active'}">${escapeHtml(status)}</span></td>
        <td><button type="button" class="professor-delete-button" data-teacher-id="${escapeHtml(professor.id)}">Delete</button></td>
      </tr>`;
    }).join('');
  };

  const loadProfessors = async () => {
    refreshButton.disabled = true;
    body.innerHTML = '<tr><td colspan="6" class="table-message">Loading professors...</td></tr>';
    try {
      const response = await fetch(api('/api/admin/teachers'));
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.message || 'Unable to load professors.');
      professors = Array.isArray(data) ? data : [];
      setPageMessage(`${professors.length} professor${professors.length === 1 ? '' : 's'} loaded.`);
      render();
    } catch (error) {
      body.innerHTML = `<tr><td colspan="6" class="table-message">${escapeHtml(error.message || 'Unable to load professors.')}</td></tr>`;
      setPageMessage(error.message || 'Unable to load professors.', true);
    } finally {
      refreshButton.disabled = false;
    }
  };

  const closeForm = () => {
    formPanel.hidden = true;
    form.reset();
    setFormMessage('');
    saveButton.disabled = false;
    saveButton.textContent = 'Save Professor';
  };

  const openForm = () => {
    formPanel.hidden = false;
    document.getElementById('professorTeacherId')?.focus();
  };

  const createProfessor = async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const username = document.getElementById('professorUsername').value.trim();
    const password = document.getElementById('professorPassword').value;
    if ((username && !password) || (!username && password)) {
      setFormMessage('Enter both username and password, or leave both blank.', true);
      return;
    }
    const payload = {
      teacher_id: document.getElementById('professorTeacherId').value.trim(),
      first_name: document.getElementById('professorFirstName').value.trim(),
      middle_name: document.getElementById('professorMiddleName').value.trim(),
      last_name: document.getElementById('professorLastName').value.trim(),
      email: document.getElementById('professorEmail').value.trim(),
      username,
      password
    };
    busy = true;
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
    setFormMessage('Saving professor...');
    try {
      const response = await fetch(api('/api/admin/teachers'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to add professor.');
      closeForm();
      setPageMessage(data.message || 'Professor added successfully.');
      await loadProfessors();
    } catch (error) {
      setFormMessage(error.message || 'Unable to add professor.', true);
    } finally {
      busy = false;
      saveButton.disabled = false;
      saveButton.textContent = 'Save Professor';
    }
  };

  // Removing a professor used to destroy every class they held, which took those
// classes away from the students enrolled in them. The admin now chooses who
// takes over, and the students keep their enrolments.
const replaceModal = document.getElementById('replaceProfessorModal');
const replaceSelect = document.getElementById('replaceProfessorSelect');
const replaceHint = document.getElementById('replaceProfessorHint');
const replaceSummary = document.getElementById('replaceProfessorSummary');
const replaceDeleteAll = document.getElementById('replaceProfessorDeleteAll');
const replaceWarning = document.getElementById('replaceProfessorWarning');
const replaceConfirm = document.getElementById('replaceProfessorConfirm');
let professorToRemove = null;

const otherProfessors = professor =>
    professors.filter(item => String(item.id) !== String(professor.id));

const closeReplaceDialog = () => {
    if (replaceModal) replaceModal.hidden = true;
    professorToRemove = null;
    if (replaceDeleteAll) replaceDeleteAll.checked = false;
    if (replaceWarning) replaceWarning.hidden = true;
};

const updateReplaceDialogState = () => {
    if (!replaceWarning || !replaceDeleteAll || !replaceHint) return;
    if (replaceDeleteAll.checked) {
      replaceWarning.hidden = false;
      replaceWarning.textContent = professorToRemove
        ? `${professorToRemove.full_name} has ${professorToRemove.class_list_count} class(es) and ${professorToRemove.schedule_count} schedule(s). `
          + 'Deleting removes them and every student loses those classes. This cannot be undone.'
        : 'Deleting removes every class and every student loses them. This cannot be undone.';
      replaceHint.textContent = 'The replacement is ignored while the delete option is ticked.';
    } else {
      replaceWarning.hidden = true;
      replaceHint.textContent = 'The students stay enrolled. Only the professor on each class changes.';
    }
    if (replaceConfirm) {
      replaceConfirm.textContent = replaceDeleteAll.checked ? 'Delete Everything' : 'Hand Over and Remove';
    }
};

const openReplaceDialog = professor => {
    if (busy) return;
    professorToRemove = professor;
    if (!replaceModal) return;

    const classCount = Number(professor.class_list_count) || 0;
    const scheduleCount = Number(professor.schedule_count) || 0;
    if (replaceSummary) {
      replaceSummary.textContent = classCount || scheduleCount
        ? `${professor.full_name} (${professor.teacher_id}) holds ${classCount} class(es) and ${scheduleCount} schedule(s). `
          + 'Choose the professor who will take them over so no student loses a class.'
        : `${professor.full_name} (${professor.teacher_id}) holds no classes or schedules, so this only removes the professor.`;
    }

    const candidates = otherProfessors(professor);
    if (replaceSelect) {
      replaceSelect.innerHTML = '';
      if (candidates.length) {
        candidates.forEach(item => {
          const option = document.createElement('option');
          option.value = String(item.id);
          option.textContent = `${item.full_name} (${item.teacher_id})`;
          replaceSelect.appendChild(option);
        });
        replaceSelect.disabled = false;
      } else {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No other professor available';
        replaceSelect.appendChild(option);
        replaceSelect.disabled = true;
      }
    }

    // With nobody to hand over to, deleting is the only option left.
    if (replaceDeleteAll) replaceDeleteAll.checked = !candidates.length;
    updateReplaceDialogState();
    replaceModal.hidden = false;
    if (candidates.length) replaceSelect?.focus();
    else replaceDeleteAll?.focus();
  };

const deleteProfessor = async professor => {
    if (busy) return;
    busy = true;
    try {
      const deleteEverything = Boolean(replaceDeleteAll && replaceDeleteAll.checked);
      const hasReplacement = !deleteEverything && replaceSelect && replaceSelect.value;
      const response = await fetch(api(`/api/admin/teachers/${encodeURIComponent(professor.id)}`), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hasReplacement ? { reassignToTeacherId: Number(replaceSelect.value) } : {})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to delete professor.');
      setPageMessage(data.message || 'Professor deleted.');
      closeReplaceDialog();
      await loadProfessors();
    } catch (error) {
      setPageMessage(error.message || 'Unable to delete professor.', true);
    } finally {
      busy = false;
    }
  };

  addButton?.addEventListener('click', openForm);
  closeButton?.addEventListener('click', closeForm);
  cancelButton?.addEventListener('click', closeForm);
  form?.addEventListener('submit', createProfessor);
  refreshButton?.addEventListener('click', loadProfessors);
  search?.addEventListener('input', render);
  accountFilter?.addEventListener('change', render);
  body?.addEventListener('click', event => {
    const button = event.target.closest('[data-teacher-id]');
    if (!button) return;
    const professor = professors.find(item => String(item.id) === String(button.dataset.teacherId));
    if (professor) openReplaceDialog(professor);
  });

  document.getElementById('replaceProfessorClose')?.addEventListener('click', closeReplaceDialog);
  document.getElementById('replaceProfessorCancel')?.addEventListener('click', closeReplaceDialog);
  replaceDeleteAll?.addEventListener('change', updateReplaceDialogState);
  replaceConfirm?.addEventListener('click', () => {
    if (professorToRemove) deleteProfessor(professorToRemove);
  });
  replaceModal?.addEventListener('click', event => {
    if (event.target === replaceModal) closeReplaceDialog();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && replaceModal && !replaceModal.hidden) closeReplaceDialog();
  });

  // One debounced listener keeps the professor table current without reloading.
  window.sisOnDataChange?.(() => {
    if (document.visibilityState === 'visible') loadProfessors();
  });

  loadProfessors();
});

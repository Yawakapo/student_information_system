document.addEventListener('DOMContentLoaded', () => {
  if ((localStorage.getItem('role') || '').toLowerCase() !== 'admin') {
    window.location.href = '../Login%20part/login.html';
    return;
  }

  const api = path => window.sisApiUrl?.(path) || ((window.location.port === '5000' || window.location.port === '') ? path : `${window.location.protocol === 'https:' ? 'https:' : 'http:'}//${window.location.hostname || 'localhost'}:5000${path}`);
  const body = document.getElementById('usersTableBody');
  const message = document.getElementById('usersMessage');
  const search = document.getElementById('userSearch');
  const roleFilter = document.getElementById('roleFilter');
  const statusFilter = document.getElementById('statusFilter');
  const refreshButton = document.getElementById('refreshUsers');
  const editAccountModal = document.getElementById('editAccountModal');
  const editAccountForm = document.getElementById('editAccountForm');
  const editAccountId = document.getElementById('editAccountId');
  const editAccountEmail = document.getElementById('editAccountEmail');
  const editAccountPassword = document.getElementById('editAccountPassword');
  const editAccountConfirmPassword = document.getElementById('editAccountConfirmPassword');
  const editAccountDescription = document.getElementById('editAccountDescription');
  const editAccountMessage = document.getElementById('editAccountMessage');
  let editingUser = null;
  let users = [];
  let busy = false;

  const setMessage = (value, isError = false) => {
    message.textContent = value;
    message.className = `users-message${isError ? ' error' : ''}`;
  };

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));

  const roleLabel = role => ({ admin: 'Administrator', teacher: 'Professor', student: 'Student' }[role] || role || 'Unknown');
  const normalizedStatus = status => String(status || 'Active').toLowerCase() === 'inactive' ? 'Inactive' : 'Active';
  const dateLabel = value => {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
  };

  const render = () => {
    const query = search.value.trim().toLowerCase();
    const role = roleFilter.value;
    const status = statusFilter.value;
    const filtered = users.filter(user => {
      const matchesQuery = !query || [user.user_id, user.full_name, user.email, user.account_number, user.student_no, user.teacher_id]
        .some(value => String(value || '').toLowerCase().includes(query));
      return matchesQuery
        && (!role || user.role === role)
        && (!status || normalizedStatus(user.status) === status);
    });

    if (!filtered.length) {
      body.innerHTML = '<tr><td colspan="5" class="table-message">No users match the current filters.</td></tr>';
      return;
    }

    body.innerHTML = filtered.map(user => {
      const current = String(user.id) === String(localStorage.getItem('user_id'))
        || String(user.user_id) === String(localStorage.getItem('user_id'));
      const statusValue = normalizedStatus(user.status);
      const toggleLabel = statusValue === 'Active' ? 'Deactivate' : 'Activate';
      const toggleClass = statusValue === 'Active' ? 'deactivate' : 'activate';
      const activationBlocked = statusValue === 'Inactive' && user.role === 'student' && Number(user.class_list_count) === 0;
      const approval = String(user.approval_status || 'accepted').toLowerCase();
      const approvalBadge = approval === 'accepted' ? '' : `<span class="approval-badge">${escapeHtml(approval)}</span>`;
      const studentRecordButton = user.role === 'student'
        ? `<button type="button" class="user-action delete-record" data-user-id="${escapeHtml(user.id)}" data-action="delete-record" ${current ? 'disabled' : ''}>Delete Student Record</button>`
        : '';
      return `<tr>
        <td><strong>${escapeHtml(user.full_name || user.user_id)}</strong><span class="user-email">${escapeHtml(user.user_id)} · ${escapeHtml(user.email)}</span></td>
        <td><span class="role-badge role-${escapeHtml(user.role)}">${escapeHtml(roleLabel(user.role))}</span></td>
        <td>${escapeHtml(user.account_number || '-')}</td>
        <td><span class="status-badge status-${statusValue.toLowerCase()}">${statusValue}</span>${approvalBadge}</td>
        <td><div class="user-actions">
          <button type="button" class="user-action edit" data-user-id="${escapeHtml(user.id)}" data-action="edit">Edit</button>
           <button type="button" class="user-action ${toggleClass}" data-user-id="${escapeHtml(user.id)}" data-action="toggle" ${current && statusValue === 'Active' || activationBlocked ? 'disabled' : ''} title="${activationBlocked ? 'Assign the student to a class list first.' : ''}">${toggleLabel}</button>
          <button type="button" class="user-action delete" data-user-id="${escapeHtml(user.id)}" data-action="delete" ${current ? 'disabled' : ''}>Delete Account</button>
          ${studentRecordButton}
        </div></td>
      </tr>`;
    }).join('');
  };

  const loadUsers = async () => {
    refreshButton.disabled = true;
    body.innerHTML = '<tr><td colspan="5" class="table-message">Loading users...</td></tr>';
    try {
      const response = await fetch(api('/api/admin/users'));
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.message || 'Unable to load users.');
      users = Array.isArray(data) ? data : [];
      setMessage(`${users.length} user account${users.length === 1 ? '' : 's'} loaded.`);
      render();
    } catch (error) {
      body.innerHTML = `<tr><td colspan="5" class="table-message">${escapeHtml(error.message || 'Unable to load users.')}</td></tr>`;
      setMessage(error.message || 'Unable to load users.', true);
    } finally {
      refreshButton.disabled = false;
    }
  };

  const setEditMessage = (value, isError = false) => {
    editAccountMessage.textContent = value;
    editAccountMessage.className = `edit-account-message${isError ? ' error' : ''}`;
  };

  const closeEditAccount = () => {
    editingUser = null;
    editAccountModal.hidden = true;
    editAccountForm.reset();
    setEditMessage('');
  };

  const openEditAccount = user => {
    editingUser = user;
    editAccountId.value = String(user.id);
    editAccountEmail.value = user.email || '';
    editAccountDescription.textContent = `${user.full_name || user.user_id} · ${roleLabel(user.role)}`;
    editAccountPassword.value = '';
    editAccountConfirmPassword.value = '';
    setEditMessage('');
    editAccountModal.hidden = false;
    editAccountEmail.focus();
  };

  const toggleEditPassword = (inputId, button) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    button.textContent = visible ? 'Show' : 'Hide';
  };

  editAccountForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!editingUser || busy) return;
    const email = editAccountEmail.value.trim();
    const password = editAccountPassword.value;
    const confirmation = editAccountConfirmPassword.value;
    if (!email) {
      setEditMessage('Email address is required.', true);
      return;
    }
    if (password && password.length < 8) {
      setEditMessage('Password must be at least 8 characters long.', true);
      return;
    }
    if (password !== confirmation) {
      setEditMessage('Passwords do not match.', true);
      return;
    }

    busy = true;
    const saveButton = document.getElementById('saveEditAccount');
    if (saveButton) saveButton.disabled = true;
    try {
      const response = await fetch(api(`/api/admin/users/${encodeURIComponent(editingUser.id)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, newPassword: password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to update the account.');
      closeEditAccount();
      await loadUsers();
      setMessage(data.message || 'Account updated successfully.');
    } catch (error) {
      setEditMessage(error.message || 'Unable to update the account.', true);
    } finally {
      busy = false;
      if (saveButton) saveButton.disabled = false;
    }
  });

  document.getElementById('closeEditAccount')?.addEventListener('click', closeEditAccount);
  document.getElementById('cancelEditAccount')?.addEventListener('click', closeEditAccount);
  document.getElementById('toggleEditPassword')?.addEventListener('click', event => toggleEditPassword('editAccountPassword', event.currentTarget));
  document.getElementById('toggleEditConfirmPassword')?.addEventListener('click', event => toggleEditPassword('editAccountConfirmPassword', event.currentTarget));
  editAccountModal?.addEventListener('click', event => {
    if (event.target === editAccountModal) closeEditAccount();
  });

  const toggleStatus = async user => {
    if (busy) return;
    const nextStatus = normalizedStatus(user.status) === 'Active' ? 'Inactive' : 'Active';
    if (!window.confirm(`${nextStatus === 'Inactive' ? 'Deactivate' : 'Activate'} ${user.full_name || user.user_id}?`)) return;
    busy = true;
    try {
      const response = await fetch(api(`/api/admin/users/${encodeURIComponent(user.id)}/status`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to update the account.');
      setMessage(data.message || 'Account status updated.');
      await loadUsers();
    } catch (error) {
      setMessage(error.message || 'Unable to update the account.', true);
    } finally {
      busy = false;
    }
  };

  const deleteUser = async (user, deleteRecord = false) => {
    if (busy) return;
    const name = user.full_name || user.user_id;
    const confirmation = deleteRecord
      ? `Delete the account AND the student record for ${name}? This removes the student and class-list assignments.`
      : user.role === 'student'
        ? `Delete only the login account for ${name}? The student record and class-list assignments will remain.`
        : `Delete the login account for ${name}?`;
    if (!window.confirm(confirmation)) return;
    busy = true;
    try {
      const endpoint = deleteRecord
        ? `/api/admin/users/${encodeURIComponent(user.id)}/record`
        : `/api/admin/users/${encodeURIComponent(user.id)}`;
      const response = await fetch(api(endpoint), { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to delete the account.');
      setMessage(data.message || 'User account deleted.');
      await loadUsers();
    } catch (error) {
      setMessage(error.message || 'Unable to delete the account.', true);
    } finally {
      busy = false;
    }
  };

  body.addEventListener('click', event => {
    const button = event.target.closest('[data-user-id]');
    if (!button) return;
    const user = users.find(item => String(item.id) === String(button.dataset.userId));
    if (!user) return;
    if (button.dataset.action === 'edit') openEditAccount(user);
    if (button.dataset.action === 'toggle') toggleStatus(user);
    if (button.dataset.action === 'delete') deleteUser(user, false);
    if (button.dataset.action === 'delete-record') deleteUser(user, true);
  });
  search.addEventListener('input', render);
  roleFilter.addEventListener('change', render);
  statusFilter.addEventListener('change', render);
  refreshButton.addEventListener('click', loadUsers);

  // Keep the account list current in place instead of reloading the page.
  window.sisOnDataChange?.(() => {
    if (document.visibilityState === 'visible') loadUsers();
  });

  loadUsers();
});

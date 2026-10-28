function requireTeacher() {
  const userId = localStorage.getItem('user_id');
  const role = (localStorage.getItem('role') || '').toLowerCase();
  if (!userId || (role !== 'teacher' && role !== 'faculty')) {
    window.location.href = '../Login%20part/login.html';
    return null;
  }
  return userId;
}

function apiUrl(endpoint) {
  return window.sisApiUrl?.(endpoint) || ((window.location.port === '5000' || window.location.port === '') ? endpoint : `${window.location.protocol === 'https:' ? 'https:' : 'http:'}//${window.location.hostname || 'localhost'}:5000${endpoint}`);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function setupLogout() {
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    window.sisLogout?.('../Login%20part/login.html');
  });
}

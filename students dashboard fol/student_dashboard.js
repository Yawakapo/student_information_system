window.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logoutBtn');
  logoutBtn?.addEventListener('click', event => {
    event.preventDefault();
    window.sisLogout?.('../Login part/login.html');
  });

  initDashboard();
});

async function initDashboard() {
  const userId = localStorage.getItem('user_id');
  const role = localStorage.getItem('role');
  if (!userId || role !== 'student') {
    window.location.href = '../Login part/login.html';
    return;
  }

  const studentIdText = document.getElementById('studentIdText');
  if (studentIdText) studentIdText.textContent = userId;
  try {
    // Only the student number is needed here. The summary endpoint leaves out the
    // stored profile picture, which can be over two megabytes.
    const response = await fetch(window.sisApiUrl('/api/profile/summary'));
    const result = await response.json();
    if (response.ok && result.data?.immutable_id && studentIdText) {
      studentIdText.textContent = result.data.immutable_id;
    }
  } catch {
    // Keep the login username as a safe fallback when profile data is unavailable.
  }
}

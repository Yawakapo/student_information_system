document.addEventListener('DOMContentLoaded', async () => {
  const userId = localStorage.getItem('user_id');
  const role = (localStorage.getItem('role') || '').toLowerCase();

  if (!userId || (role !== 'teacher' && role !== 'faculty')) {
    window.location.href = '../Login%20part/login.html';
    return;
  }

  const teacherIdText = document.getElementById('teacherIdText');
  if (teacherIdText) teacherIdText.textContent = userId;
  try {
    // Only the professor id is needed here. The summary endpoint leaves out the
    // stored profile picture, which can be over two megabytes.
    const response = await fetch(window.sisApiUrl('/api/profile/summary'));
    const result = await response.json();
    if (response.ok && result.data?.immutable_id && teacherIdText) {
      teacherIdText.textContent = result.data.immutable_id;
    }
  } catch {
    // Keep the login username as a safe fallback.
  }

  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    window.sisLogout?.('../Login%20part/login.html');
  });
});

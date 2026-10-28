document.addEventListener('DOMContentLoaded', () => {
  const role = (localStorage.getItem('role') || '').toLowerCase();
  const homeLink = document.getElementById('aboutHomeLink');
  if (homeLink) {
    if (role === 'teacher' || role === 'faculty') homeLink.href = '/Teachers_panel/tdashboard.html';
    else if (role === 'student') homeLink.href = '/students%20dashboard%20fol/student_dashboard.html';
  }
  if (role === 'teacher' || role === 'faculty') {
    const category = document.getElementById('aboutCategoryLabel');
    const title = document.getElementById('aboutPageTitle');
    if (category) category.textContent = 'PROFESSOR PORTAL';
    if (title) title.textContent = 'Professor Support & About';
  } else if (role === 'student') {
    const category = document.getElementById('aboutCategoryLabel');
    const title = document.getElementById('aboutPageTitle');
    if (category) category.textContent = 'STUDENT PORTAL';
    if (title) title.textContent = 'Student Support & About';
  }
  if (role && role !== 'admin') {
    document.querySelectorAll('.admin-only-nav').forEach(link => link.remove());
  }

  // Global declaration variables list for dynamic accordion sections tracking
  const targetPanels = ['sec-retention', 'sec-support', 'sec-campus'];

  // Expose toggle function window globally to interact smoothly with HTML onclick parameters
  window.toggleSection = (targetPanelId) => {
    targetPanels.forEach(id => {
      const panelElement = document.getElementById(id);
      if (!panelElement) return;

      if (id === targetPanelId) {
        // Toggle the chosen panel's block visibility display state
        if (panelElement.style.display === 'grid' || panelElement.style.display === 'block') {
          panelElement.style.display = 'none';
        } else {
          // Adjust display framework layout template depending on module requirements
          panelElement.style.display = (id === 'sec-campus') ? 'grid' : 'block';
          
          // Smooth scroll animation mapping action lock
          setTimeout(() => {
            panelElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 40);
        };
      } else {
        // Close alternate open dashboard panels to avoid interface screen clutter
        panelElement.style.display = 'none';
      }
    });
  };
});

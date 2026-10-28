// =====================================================================
// PROFILE PAGE
// =====================================================================

let activeProfile = {
  user_id: '',
  username: '',
  full_name: '',
  email: '',
  role: '',
  immutable_id: '',
  immutable_label: 'Account ID',
  profile_picture: ''
};
let pendingEmailChange = '';

function profileApiUrl(path) {
  return window.sisApiUrl ? window.sisApiUrl(path) : path;
}

function dashboardPathForRole(role) {
  const normalizedRole = String(role || '').toLowerCase();
  if (normalizedRole === 'student') return '/students%20dashboard%20fol/student_dashboard.html';
  if (normalizedRole === 'teacher' || normalizedRole === 'faculty') return '/Teachers_panel/tdashboard.html';
  return '/Dashboard%20fol/Dashboard%20section.html';
}

document.addEventListener('DOMContentLoaded', () => {
  const backLink = document.getElementById('backToDashboard');
  if (backLink) backLink.href = dashboardPathForRole(localStorage.getItem('role'));
  loadProfileData();

  document.getElementById('profileSettingsForm')?.addEventListener('submit', saveProfileSettings);
  document.getElementById('requestEmailChangeBtn')?.addEventListener('click', requestEmailChange);
  document.getElementById('emailChangeOtpForm')?.addEventListener('submit', confirmEmailChange);

  document.getElementById('step-2')?.addEventListener('submit', async event => {
    event.preventDefault();
    const otp = document.getElementById('otpCode')?.value.trim() || '';
    const newPassword = document.getElementById('newPassword')?.value || '';
    const confirmPassword = document.getElementById('confirmPassword')?.value || '';
    if (!/^\d{6}$/.test(otp)) {
      showToast('Enter the 6-digit verification code.', 'error');
      return;
    }
    if (!newPassword || !confirmPassword) {
      showToast('Enter and confirm your new password.', 'error');
      return;
    }
    if (newPassword.length < 8) {
      showToast('Password must be at least 8 characters long.', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('Passwords do not match.', 'error');
      return;
    }
    const changed = await confirmPasswordChange(activeProfile.user_id, otp, newPassword);
    if (changed) {
      document.getElementById('otpCode').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmPassword').value = '';
      setTimeout(() => {
        window.location.href = dashboardPathForRole(activeProfile.role);
      }, 1000);
    }
  });
});

function getInitials(name) {
  if (!name) return 'U';
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function showToast(message, type = 'info') {
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = `custom-toast toast-${type}`;
  const icon = document.createElement('i');
  icon.className = `fa-solid ${type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info'}`;
  const messageElement = document.createElement('span');
  messageElement.textContent = message;
  toast.append(icon, messageElement);
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function toggleProfilePassword(fieldId, button) {
  const input = document.getElementById(fieldId);
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  if (button) {
    button.textContent = isHidden ? 'Hide' : 'Show';
    button.setAttribute('aria-label', `${isHidden ? 'Hide' : 'Show'} password`);
  }
}

async function loadProfileData() {
  try {
    const response = await fetch(profileApiUrl('/api/profile'), { method: 'GET' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.message || `Server status error: ${response.status}`);
    }

    const dbUser = result.data || result.user || result;
    activeProfile = {
      user_id: String(dbUser.user_id || ''),
      username: String(dbUser.username || dbUser.user_id || ''),
      full_name: String(dbUser.full_name || dbUser.name || ''),
      email: String(dbUser.email || '').trim().toLowerCase(),
      role: String(dbUser.role || '').toLowerCase(),
      immutable_id: String(dbUser.immutable_id || dbUser.student_no || dbUser.teacher_id || ''),
      immutable_label: String(dbUser.immutable_label || (String(dbUser.role).toLowerCase() === 'student' ? 'Student ID' : String(dbUser.role).toLowerCase() === 'teacher' ? 'Professor ID' : 'Account ID')),
      profile_picture: String(dbUser.profile_picture || '')
    };

    // Keep browser-side display identity in sync with the server's canonical
    // username. The server still derives permissions from its signed session.
    if (activeProfile.username) {
      localStorage.setItem('user_id', activeProfile.username);
      localStorage.setItem('userId', activeProfile.username);
    }
    renderProfileUI(activeProfile);
  } catch (error) {
    console.error('Profile fetch error:', error);
    showToast(error.message || 'Unable to load profile details.', 'error');
  }
}

function renderProfileUI(user) {
  const avatarUrl = user.profile_picture || '';
  const initials = getInitials(user.full_name);
  const roleName = user.role === 'admin' ? 'Administrator' : user.role === 'teacher' ? 'Professor' : user.role === 'student' ? 'Student' : 'User';
  const pageTitle = user.role === 'admin' ? 'Admin Profile' : `${roleName} Profile`;

  document.querySelectorAll('.user-name').forEach(element => { element.textContent = user.full_name || 'User'; });
  document.querySelectorAll('.user-sub').forEach(element => { element.textContent = user.subject_code || ''; });
  document.querySelectorAll('.user-avatar').forEach(element => {
    if (avatarUrl) {
      element.style.backgroundImage = `url('${avatarUrl}')`;
      element.style.backgroundSize = 'cover';
      element.style.backgroundPosition = 'center';
      element.textContent = '';
    } else {
      element.style.backgroundImage = 'none';
      element.textContent = initials;
    }
  });

  const usernameInput = document.getElementById('profUsername');
  const immutableInput = document.getElementById('profImmutableId');
  const nameInput = document.getElementById('profFullName');
  const emailInput = document.getElementById('profEmail');
  if (usernameInput) usernameInput.value = user.username || user.user_id || '';
  if (immutableInput) immutableInput.value = user.immutable_id || 'Not assigned';
  if (nameInput) nameInput.value = user.full_name || '';
  if (emailInput) emailInput.value = user.email || '';

  const immutableLabel = document.getElementById('profImmutableLabel');
  const cardIdLabel = document.getElementById('profCardIdLabel');
  const pageTitleElement = document.getElementById('profilePageTitle');
  const backLink = document.getElementById('backToDashboard');
  if (backLink) backLink.href = dashboardPathForRole(user.role);
  if (immutableLabel) immutableLabel.textContent = user.immutable_label || 'Account ID';
  if (cardIdLabel) cardIdLabel.textContent = (user.immutable_label || 'Account ID').toUpperCase();
  if (pageTitleElement) pageTitleElement.textContent = pageTitle;
  document.title = `${pageTitle} - Student Information System`;

  const profCardName = document.getElementById('profCardName');
  const profCardUserId = document.getElementById('profCardUserId');
  const profCardRole = document.getElementById('profCardRole');
  const avatarDisplay = document.getElementById('profileAvatarDisplay');
  if (profCardName) profCardName.textContent = user.full_name || 'User';
  if (profCardUserId) profCardUserId.textContent = user.immutable_id || user.username || user.user_id || '-';
  if (profCardRole) profCardRole.textContent = roleName;

  if (avatarDisplay) {
    if (avatarUrl) {
      avatarDisplay.style.backgroundImage = `url('${avatarUrl}')`;
      avatarDisplay.style.backgroundSize = 'cover';
      avatarDisplay.style.backgroundPosition = 'center';
      avatarDisplay.textContent = '';
    } else {
      avatarDisplay.style.backgroundImage = 'none';
      avatarDisplay.textContent = initials;
    }
  }
}

function previewProfilePhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('Image size is too large. Choose an image under 2MB.', 'error');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = loadEvent => {
    const avatarUrl = loadEvent.target.result;
    const avatarDisplay = document.getElementById('profileAvatarDisplay');
    if (avatarDisplay) {
      avatarDisplay.style.backgroundImage = `url('${avatarUrl}')`;
      avatarDisplay.style.backgroundSize = 'cover';
      avatarDisplay.style.backgroundPosition = 'center';
      avatarDisplay.textContent = '';
    }
    sessionStorage.setItem('temp_uploaded_avatar', avatarUrl);
  };
  reader.readAsDataURL(file);
}

async function saveProfileSettings(event) {
  event?.preventDefault();
  const username = document.getElementById('profUsername')?.value.trim() || '';
  const fullName = document.getElementById('profFullName')?.value.trim() || '';
  const email = (document.getElementById('profEmail')?.value || '').trim().toLowerCase();

  if (email !== activeProfile.email) {
    showToast('Use the email verification workflow to change your email address.', 'error');
    return;
  }
  if (!username || username.length < 3) {
    showToast('Enter a valid username.', 'error');
    return;
  }

  const temporaryAvatar = sessionStorage.getItem('temp_uploaded_avatar');
  try {
    const response = await fetch(profileApiUrl('/api/profile/account'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, full_name: fullName, profile_picture: temporaryAvatar })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !(result.success || result.status === 'success')) {
      throw new Error(result.message || 'Unable to update profile.');
    }

    const canonicalUsername = result.username || username;
    localStorage.setItem('user_id', canonicalUsername);
    localStorage.setItem('userId', canonicalUsername);
    sessionStorage.removeItem('temp_uploaded_avatar');
    showToast(result.message || 'Profile updated successfully.', 'success');
    await loadProfileData();
  } catch (error) {
    console.error('Profile update error:', error);
    showToast(error.message || 'Unable to update profile.', 'error');
  }
}

async function requestEmailChange() {
  const email = (document.getElementById('profEmail')?.value || '').trim().toLowerCase();
  if (!email || email === activeProfile.email) {
    showToast('Enter a new email address first.', 'error');
    return;
  }

  const button = document.getElementById('requestEmailChangeBtn');
  if (button) button.disabled = true;
  try {
    const response = await fetch(profileApiUrl('/api/profile/email-change/request'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_email: email })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !(result.success || result.status === 'success')) {
      throw new Error(result.message || 'Unable to send the verification code.');
    }
    pendingEmailChange = email;
    const form = document.getElementById('emailChangeOtpForm');
    if (form) form.style.display = 'block';
    showToast(result.message || `Verification code sent to ${email}.`, 'success');
    document.getElementById('emailChangeOtp')?.focus();
  } catch (error) {
    showToast(error.message || 'Unable to send the verification code.', 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function confirmEmailChange(event) {
  event?.preventDefault();
  const code = document.getElementById('emailChangeOtp')?.value.trim() || '';
  const newEmail = pendingEmailChange || (document.getElementById('profEmail')?.value || '').trim().toLowerCase();
  if (!/^\d{6}$/.test(code) || !newEmail) {
    showToast('Enter the 6-digit verification code.', 'error');
    return;
  }

  try {
    const response = await fetch(profileApiUrl('/api/profile/email-change/confirm'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_email: newEmail, code })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !(result.success || result.status === 'success')) {
      throw new Error(result.message || 'Unable to confirm the email address.');
    }
    activeProfile.email = newEmail;
    pendingEmailChange = '';
    const emailInput = document.getElementById('profEmail');
    if (emailInput) emailInput.value = newEmail;
    const form = document.getElementById('emailChangeOtpForm');
    if (form) form.style.display = 'none';
    const otpInput = document.getElementById('emailChangeOtp');
    if (otpInput) otpInput.value = '';
    showToast(result.message || 'Email address updated successfully.', 'success');
  } catch (error) {
    showToast(error.message || 'Unable to confirm the email address.', 'error');
  }
}

// Password-reset OTP functions are kept separate from email-change OTP.
async function requestPasswordOtp() {
  const emailToUse = activeProfile.email;
  if (!emailToUse) {
    showToast('No registered email address was found.', 'error');
    return false;
  }
  try {
    const response = await fetch(profileApiUrl('/api/request-password-otp'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailToUse })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !(result.success || result.status === 'success')) {
      throw new Error(result.message || 'Failed to send verification code.');
    }
    showToast(result.message || 'Verification code sent to your email.', 'success');
    return true;
  } catch (error) {
    showToast(error.message || 'Unable to send verification code.', 'error');
    return false;
  }
}

async function confirmPasswordChange(userId, otp, newPassword) {
  try {
    const response = await fetch(profileApiUrl('/api/confirm-password-change'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, otp, newPassword })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !(result.success || result.status === 'success')) {
      throw new Error(result.message || 'Failed to update password.');
    }
    showToast(result.message || 'Password updated successfully!', 'success');
    return true;
  } catch (error) {
    showToast(error.message || 'Unable to update password.', 'error');
    return false;
  }
}

async function resendOTP() {
  const button = document.getElementById('resendOtpBtn');
  if (button?.dataset.disabled === 'true') return;
  const sent = await requestPasswordOtp();
  if (sent && button) {
    let remaining = 30;
    button.dataset.disabled = 'true';
    button.style.pointerEvents = 'none';
    const timer = setInterval(() => {
      remaining -= 1;
      button.textContent = `Resend Code (${remaining}s)`;
      if (remaining <= 0) {
        clearInterval(timer);
        delete button.dataset.disabled;
        button.style.pointerEvents = 'auto';
        button.textContent = 'Resend Code';
      }
    }, 1000);
  }
}

async function sendOTP() {
  const sent = await requestPasswordOtp();
  if (sent) {
    const step1 = document.getElementById('step-1');
    const step2 = document.getElementById('step-2');
    if (step1) step1.style.display = 'none';
    if (step2) step2.style.display = 'block';
  }
}

function navigateToProfile() {
  window.location.href = '/Profile pic_part/Profile section.html';
}

function toggleSidebar() {
  document.querySelector('.sidebar')?.classList.toggle('active');
}

function handleLogout() {
  document.getElementById('logoutModal')?.classList.add('show');
}

function closeLogoutModal() {
  document.getElementById('logoutModal')?.classList.remove('show');
}

function confirmLogout() {
  window.sisLogout?.('/Login%20part/login.html');
}

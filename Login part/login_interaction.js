// =====================================================================
// UI UTILITIES & TOAST NOTIFICATIONS
// =====================================================================

// The result of pressing Log-in is written into the form itself, just above the
// button, rather than into a banner in the corner. The eye is already on the
// form, so the answer appears where it was asked for. An error stays up until the
// next attempt, so it can actually be read.
function showMessage(message, type = 'success') {
    const box = document.getElementById('loginMessage');
    if (!box) {
        // The form is missing, which is a page problem rather than a login
        // problem, so say so plainly instead of failing silently.
        console.warn('Login message element is missing from the page.');
        alert(message);
        return;
    }

    box.textContent = message;
    box.className = 'login-message '
      + (type === 'success' ? 'success' : type === 'warning' ? 'working' : 'error');
    box.hidden = false;
}

const clearMessage = () => {
    const box = document.getElementById('loginMessage');
    if (box) {
        box.hidden = true;
        box.textContent = '';
    }
};

// Function to toggle password field visibility
function togglePasswordVisibility(fieldId, btnElement) {
    const inputField = document.getElementById(fieldId);
    if (!inputField) return;

    const icon = btnElement ? btnElement.querySelector('i') : null;

    if (inputField.type === 'password') {
        inputField.type = 'text';
        if (icon) {
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
        }
        if (!icon && btnElement) btnElement.textContent = 'Hide';
    } else {
        inputField.type = 'password';
        if (icon) {
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
        }
        if (!icon && btnElement) btnElement.textContent = 'Show';
    }
}

// Helper to resolve backend base URL dynamically
function getApiUrl(endpoint) {
    if (window.sisApiUrl) return window.sisApiUrl(endpoint);
    if (window.location.port === '5000' || window.location.port === '') return endpoint;
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    return `${protocol}//${window.location.hostname || 'localhost'}:5000${endpoint}`;
}

// =====================================================================
// FORM SUBMISSION HANDLERS
// =====================================================================

document.addEventListener('DOMContentLoaded', () => {

    const roleSelect = document.getElementById('loginRole');
    const loginIdLabel = document.getElementById('loginIdLabel');
    const loginIdInput = document.getElementById('loginUserId');
    const updateLoginIdentifier = () => {
        if (!roleSelect || !loginIdLabel || !loginIdInput) return;
        if (roleSelect.value === 'student') {
            loginIdLabel.textContent = 'Username or Student Number';
            loginIdInput.placeholder = 'Enter your username or student number';
        } else if (roleSelect.value === 'teacher') {
            loginIdLabel.textContent = 'Username / Professor ID';
            loginIdInput.placeholder = 'Enter your username or professor ID';
        } else {
            loginIdLabel.textContent = 'Username';
            loginIdInput.placeholder = 'Enter your admin username';
        }
    };
    roleSelect?.addEventListener('change', updateLoginIdentifier);
    updateLoginIdentifier();

    // An old complaint should not sit there while the person fixes it, so any
    // edit clears the message.
    [document.getElementById('loginUserId'), document.getElementById('loginPassword'), roleSelect]
        .filter(Boolean)
        .forEach(field => field.addEventListener('input', clearMessage));

    // --- 1. HANDLE LOGIN FORM SUBMISSION ---
    const loginForm = document.getElementById('view-login') || document.getElementById('loginForm');

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            // Support multiple possible element IDs for input fields
            const roleEl = document.getElementById('loginRole') || document.getElementById('roleSelect') || document.getElementById('role');
            const userIdEl = document.getElementById('loginUserId') || document.getElementById('userId') || document.getElementById('loginId');
            const passwordEl = document.getElementById('loginPassword') || document.getElementById('password');

            const role = roleEl ? roleEl.value.trim() : 'Teacher';
            const user_id = userIdEl ? userIdEl.value.trim() : '';
            const password = passwordEl ? passwordEl.value.trim() : '';

            if (!user_id || !password) {
                showMessage('Please enter both User ID and Password.', 'error');
                return;
            }

            // Say what is happening while the server decides, so a slow answer
            // does not look like a page that has stopped working.
            showMessage('Checking your details...', 'warning');
            const submitButton = loginForm.querySelector('button[type="submit"]');
            const originalButtonText = submitButton ? submitButton.textContent : '';
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = 'Checking...';
            }

            console.log("Attempting Login:", { user_id, role, endpoint: getApiUrl('/api/login') });

            try {
                const response = await fetch(getApiUrl('/api/login'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id, password, role })
                });

                const result = await response.json();
                console.log("Server Response:", result);

                // Only pending/rejected approval responses should use the warning state.
                if (response.status === 403 && ['pending', 'rejected'].includes((result.approval_status || '').toLowerCase())) {
                    showMessage(result.message || (result.approval_status === 'rejected'
                        ? 'Your account registration was rejected.'
                        : 'Your account is pending professor approval.'), 'warning');
                    return;
                }

                if (response.status === 403) {
                    showMessage(result.message || 'This account cannot sign in yet.', 'error');
                    return;
                }

                if (response.ok && (result.success || result.status === 'success')) {
                    const savedUserId = result.user_id || result.userId || user_id;
                    const savedRole = (result.role || role).toLowerCase();

                    if (savedRole !== role.toLowerCase()) {
                        showMessage('The selected role does not match this account.', 'error');
                        return;
                    }

                    // The server also sets an HttpOnly cookie; the token is a fallback for cross-origin clients.
                    localStorage.setItem('isLoggedIn', 'true');
                    localStorage.setItem('user_id', savedUserId);
                    localStorage.setItem('userId', savedUserId);
                    if (result.student_number) localStorage.setItem('student_number', result.student_number);
                    localStorage.setItem('role', savedRole);
                    localStorage.setItem('userRole', savedRole);
                    if (result.token) localStorage.setItem('auth_token', result.token);

                    showMessage('Signed in. Opening your dashboard...', 'success');

                    // Dynamic path calculation to guarantee accurate relative routing
                    const pathParts = window.location.pathname.split('/');
                    pathParts.pop(); // Remove "login.html"
                    const currentFolder = pathParts.join('/');

                    const targetUrl = (savedRole === 'teacher' || savedRole === 'faculty')
                        ? `${currentFolder}/../Teachers_panel/tdashboard.html`
                        : savedRole === 'admin'
                            ? `${currentFolder}/../Dashboard%20fol/Dashboard%20section.html`
                            : `${currentFolder}/../students%20dashboard%20fol/student_dashboard.html`;

                    // Brief delay so the message on the form can be read before the page changes.
                    setTimeout(() => {
                        window.location.href = targetUrl;
                    }, 1000);

                } else {
                    showMessage(result.message || 'Invalid credentials. Please try again.', 'error');
                }
            } catch (err) {
                console.error('Login Fetch Error:', err);
                showMessage('Cannot reach the server. Start it with "npm.cmd start", then try again.', 'error');
            } finally {
                // Put the button back unless the page is already leaving, so a
                // failed attempt can be corrected straight away.
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.textContent = originalButtonText || 'Log-in';
                }
            }
        });
    }

});

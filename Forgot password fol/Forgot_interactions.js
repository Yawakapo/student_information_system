const API_BASE_URL = (window.location.port === '5000' || window.location.port === '') ? '' : `${window.location.protocol === 'https:' ? 'https:' : 'http:'}//${window.location.hostname || 'localhost'}:5000`;

document.addEventListener("DOMContentLoaded", function () {
    const role = document.getElementById("userRole") || document.getElementById("roleSelect");
    const label = document.getElementById("accountIDLabel") || document.getElementById("idLabel");
    const input = document.getElementById("accountID") || document.getElementById("teacherIdInput");

    if (role && label && input) {
        role.addEventListener("change", function () {
            const selectedRole = role.value.toLowerCase();
            if (selectedRole === "teacher") {
                label.textContent = "Professor ID or Username";
                input.placeholder = "Enter the professor ID or username";
            } else if (selectedRole === "admin") {
                label.textContent = "Admin ID or Username";
                input.placeholder = "Enter the admin ID or username";
            } else {
                label.textContent = "Student No. or Username";
                input.placeholder = "Enter the student number or username";
            }
            input.value = "";
        });
    }
});

function showStep(stepNumber) {
    for (let i = 1; i <= 4; i++) {
        const stepEl = document.getElementById(`step${i}`);
        if (stepEl) {
            stepEl.style.display = (i === stepNumber) ? 'block' : 'none';
        }
    }
}

function togglePassword(fieldId, btn) {
    const input = document.getElementById(fieldId);
    if (input) {
        if (input.type === "password") {
            input.type = "text";
            btn.textContent = "Hide";
        } else {
            input.type = "password";
            btn.textContent = "Show";
        }
    }
}

function clearErrors() {
    for (let i = 1; i <= 4; i++) {
        const err = document.getElementById(`error${i}`);
        if (err) err.textContent = "";
    }
    const mainError = document.getElementById("errorMessage");
    if (mainError) mainError.textContent = "";
}

// Helper: Toggle button disable/loading state
function toggleButtonState(btn, isLoading, loadingText = "Processing...") {
    if (!btn) return;
    if (isLoading) {
        btn.dataset.originalText = btn.textContent;
        btn.textContent = loadingText;
        btn.disabled = true;
    } else {
        btn.textContent = btn.dataset.originalText || btn.textContent;
        btn.disabled = false;
    }
}

// Step 1: Verify Account Credentials & Trigger OTP Email
async function verifyAccount(event) {
    if (event) event.preventDefault();
    clearErrors();

    const submitBtn = event?.target?.querySelector('button[type="submit"]') || document.querySelector('#step1 button[type="submit"]');
    const accountIDElem = document.getElementById("accountID") || document.getElementById("teacherIdInput");
    const accountEmailElem = document.getElementById("accountEmail") || document.getElementById("emailInput");
    const roleElem = document.getElementById("userRole") || document.getElementById("roleSelect");
    const errorElem = document.getElementById("error1") || document.getElementById("errorMessage");

    const userId = accountIDElem ? accountIDElem.value.trim() : "";
    const email = accountEmailElem ? accountEmailElem.value.trim() : "";
    const role = roleElem ? roleElem.value.trim() : "teacher";

    if (!userId || !email) {
        if (errorElem) errorElem.textContent = "Please fill in all required fields.";
        return;
    }

    toggleButtonState(submitBtn, true, "Verifying...");

    try {
        // 1. Verify User credentials against Database
        const response = await fetch(`${API_BASE_URL}/api/verify-account`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role, userId, email })
        });

        const data = await response.json();

        if (!response.ok || (data.status !== 'success' && !data.success)) {
            if (errorElem) errorElem.textContent = data.message || "Account verification failed.";
            toggleButtonState(submitBtn, false);
            return;
        }

        // Cache verified details for subsequent OTP/password steps
        sessionStorage.setItem("reset_user_id", userId);
        sessionStorage.setItem("reset_user_email", email);

        // 2. Dispatch the OTP Email to user
        toggleButtonState(submitBtn, true, "Sending Code...");
       const otpResponse = await fetch(`${API_BASE_URL}/api/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
});

        const otpData = await otpResponse.json();

        if (!otpResponse.ok || (otpData.status !== 'success' && !otpData.success)) {
            if (errorElem) errorElem.textContent = otpData.message || "Failed to send verification code email.";
            toggleButtonState(submitBtn, false);
            return;
        }

        const emailDisplay = document.getElementById("emailDisplay");
        if (emailDisplay) emailDisplay.textContent = email;

        // When the machine has no connection the code cannot be emailed, so the
        // server sends it back with the reply instead. Show it on the page,
        // otherwise the person waits for an email that will never arrive.
        const offlineNote = document.getElementById("offlineCodeNote");
        if (otpData.offline && otpData.code) {
            if (offlineNote) {
                offlineNote.textContent =
                    `This machine has no internet connection, so no email was sent. Your verification code is: ${otpData.code}`;
                offlineNote.hidden = false;
            }
        } else if (offlineNote) {
            offlineNote.hidden = true;
        }

        // Advance to Step 2 (OTP Input Screen)
        showStep(2);
    } catch (err) {
        console.error("[ERROR] Verify account request failed:", err);
        if (errorElem) errorElem.textContent = "Server connection error. Make sure backend server is active.";
    } finally {
        toggleButtonState(submitBtn, false);
    }
}

// Step 2: Verify OTP Code
async function verifyCode(event) {
    if (event) event.preventDefault();
    clearErrors();

    const submitBtn = event?.target?.querySelector('button[type="submit"]') || document.querySelector('#step2 button[type="submit"]');
    const codeElem = document.getElementById("verificationCode");
    const code = codeElem ? codeElem.value.trim() : "";
    const email = sessionStorage.getItem("reset_user_email") || (document.getElementById("accountEmail")?.value.trim());
    const errorElem = document.getElementById("error2");

    if (!code || code.length !== 6) {
        if (errorElem) errorElem.textContent = "Please enter a valid 6-digit verification code.";
        return;
    }

    toggleButtonState(submitBtn, true, "Verifying Code...");

    try {
        const response = await fetch(`${API_BASE_URL}/api/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code })
        });

        const data = await response.json();

        if (!response.ok || (data.status !== 'success' && !data.success)) {
            if (errorElem) errorElem.textContent = data.message || "OTP verification failed.";
            return;
        }

        // Keep the code only for this reset session; the server validates it again.
        sessionStorage.setItem("reset_otp", code);

        // Advance to Step 3 (Set New Password Screen)
        showStep(3);
    } catch (err) {
        console.error("[ERROR] Verify OTP request failed:", err);
        if (errorElem) errorElem.textContent = "Verification failed. Check server connection.";
    } finally {
        toggleButtonState(submitBtn, false);
    }
}

// Step 3: Set New Password
async function resetPassword(event) {
    if (event) event.preventDefault();
    clearErrors();

    const submitBtn = event?.target?.querySelector('button[type="submit"]') || document.querySelector('#step3 button[type="submit"]');
    const newPassElem = document.getElementById("newPassword");
    const confirmPassElem = document.getElementById("confirmPassword");
    const errorElem = document.getElementById("error3");

    const newPass = newPassElem ? newPassElem.value : "";
    const confirmPass = confirmPassElem ? confirmPassElem.value : "";
    const userId = sessionStorage.getItem("reset_user_id") || (document.getElementById("accountID")?.value.trim());
    const email = sessionStorage.getItem("reset_user_email") || (document.getElementById("accountEmail")?.value.trim());
    const otp = document.getElementById("verificationCode")?.value.trim() || sessionStorage.getItem("reset_otp") || '';

    if (!newPass || !confirmPass) {
        if (errorElem) errorElem.textContent = "Please fill in both password fields.";
        return;
    }

    if (!otp) {
        if (errorElem) errorElem.textContent = "Please verify the email code before updating your password.";
        return;
    }

    if (newPass.length < 8) {
        if (errorElem) errorElem.textContent = "Password must be at least 8 characters long.";
        return;
    }

    if (newPass !== confirmPass) {
        if (errorElem) errorElem.textContent = "Passwords do not match.";
        return;
    }

    toggleButtonState(submitBtn, true, "Updating Password...");

    try {
        const response = await fetch(`${API_BASE_URL}/api/update-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: userId,
                email,
                code: otp,
                otp,
                verificationCode: otp,
                newPassword: newPass
            })
        });

        const data = await response.json();

        if (!response.ok || (data.status !== 'success' && !data.success)) {
            if (errorElem) errorElem.textContent = data.message || "Failed to update password.";
            return;
        }

        // Clean up temporary session storage
        sessionStorage.removeItem("reset_user_id");
        sessionStorage.removeItem("reset_user_email");
        sessionStorage.removeItem("reset_otp");

        // Go to Step 4 (Success Screen)
        showStep(4);
    } catch (err) {
        console.error("[ERROR] Password update failed:", err);
        if (errorElem) errorElem.textContent = "Failed to update password. Server connection error.";
    } finally {
        toggleButtonState(submitBtn, false);
    }
}

// Resend OTP Code with Cooldown Timer
async function resendCode(btnElem) {
    clearErrors();
    const email = sessionStorage.getItem("reset_user_email") || (document.getElementById("accountEmail")?.value.trim());
    const resendBtn = btnElem || document.getElementById("resendBtn");

    if (!email) {
        alert("Email address missing. Please start verification from Step 1.");
        return;
    }

    toggleButtonState(resendBtn, true, "Resending...");

    try {
        const response = await fetch(`${API_BASE_URL}/api/resend-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        const data = await response.json();
        alert(data.message || "Verification code sent!");

        // 30 second cooldown timer
        let cooldown = 30;
        if (resendBtn) {
            resendBtn.disabled = true;
            const timer = setInterval(() => {
                resendBtn.textContent = `Resend in ${cooldown}s`;
                cooldown--;
                if (cooldown < 0) {
                    clearInterval(timer);
                    resendBtn.textContent = "Resend Code";
                    resendBtn.disabled = false;
                }
            }, 1000);
        }
    } catch (err) {
        console.error("[ERROR] Resend OTP failed:", err);
        alert("Failed to resend code. Please try again.");
        toggleButtonState(resendBtn, false);
    }
}

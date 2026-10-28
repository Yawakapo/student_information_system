/* =====================================================================
   DASHBOARD FUNCTIONS & BACKEND API INTEGRATION (STRICT FETCH & GUARD)
   ===================================================================== */

document.addEventListener("DOMContentLoaded", () => {
    // 1. Session Protection Guard Clause
    const userId = localStorage.getItem('user_id');
    const role = localStorage.getItem('role');

    if (!userId || role !== 'admin') {
        showToast("Session expired or unauthorized. Please log in first.", "error");
        setTimeout(redirectToLogin, 1500);
        return;
    }

    // 2. Display logged-in Professor/User ID in UI if element exists
    const userDisplay = document.getElementById("loggedInUser") || document.getElementById("teacherIdDisplay");
    if (userDisplay) {
        userDisplay.textContent = userId;
    }

    loadAdminWelcomeName(userId);

    // 3. Load live metrics
    loadDashboardData();
    // One debounced listener instead of seven, so a burst of changes costs a
    // single re-fetch rather than seven overlapping requests.
    window.sisOnDataChange?.(() => {
      if (document.visibilityState === 'visible') loadDashboardData();
    });
});

// Helper to reliably send users back to login page regardless of nested folder depth
function redirectToLogin() {
    window.location.href = "../Login%20part/login.html";
}

// Logout function to clear session and return to login
function logout() {
    window.sisLogout?.('../Login%20part/login.html');
}

// Helper to resolve API base URL safely across local and server environments
function getApiUrl(endpoint) {
    return window.sisApiUrl?.(endpoint) || (window.location.port === "5000" || window.location.port === ""
        ? endpoint
        : `${window.location.protocol === "https:" ? "https:" : "http:"}//${window.location.hostname || "localhost"}:5000${endpoint}`);
}

/* =====================================================================
   1. DASHBOARD METRICS & COURSES
   ===================================================================== */
async function loadDashboardData() {
  try {
    // 1. Fetch metric counts from backend route
    const countsUrl = getApiUrl('/api/students-c');
    const response = await fetch(countsUrl);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Failed to fetch dashboard metrics");
    }

    console.log("[DEBUG] Live Dashboard Counts Payload:", result);

    // 2. Multi-target helper to update cards safely
    const setMetric = (primaryId, fallbackId, val) => {
      const elem = document.getElementById(primaryId) || document.getElementById(fallbackId);
      if (elem) {
        elem.textContent = (val !== undefined && val !== null) ? val : 0;
      }
    };

    setMetric("statTotal", "totalStudents", result.totalStudents);
    setMetric("statActive", "activeStudents", result.activeStudents);
    setMetric("statShifted", "shiftedStudents", result.shiftedStudents);
    setMetric("statDropped", "droppedStudents", result.droppedStudents);

    loadClassOverview();

  } catch (error) {
    console.error("[ERROR] Dashboard fetch error:", error);
    showFallbackUI();
    // Tells a stopped server apart from a server that answered with nothing,
    // which look identical otherwise.
    if (error?.name === 'AbortError' || error instanceof TypeError) {
      window.sisReportBackendDown?.(error?.message || String(error));
    }
  }
}


function showFallbackUI() {
    const setZero = (primaryId, fallbackId) => {
        const elem = document.getElementById(primaryId) || document.getElementById(fallbackId);
        if (elem) elem.textContent = "—";
    };

    setZero("statTotal", "totalStudents");
    setZero("statActive", "activeStudents");
    setZero("statShifted", "shiftedStudents");
    setZero("statDropped", "droppedStudents");

    const container = document.getElementById("classOverviewContainer");

    if (container) {
        container.innerHTML = `<p class="empty-text" style="color: #ef4444; padding: 10px;">Unable to load metrics from server. Ensure backend port 5000 is running.</p>`;
    }
}

/* =====================================================================
   CURRENT CLASSES
   ---------------------------------------------------------------------
   The answer an administrator wants without leaving this page: which
   classes exist, who teaches each one, and when it meets. It reads the
   class lists the server already holds, so it adds no new route.
   ===================================================================== */
async function loadClassOverview() {
    const box = document.getElementById("classOverviewContainer");
    if (!box) return;

    try {
        const response = await fetch(getApiUrl("/api/class-list-schedules"));
        const payload = await response.json();

        if (!response.ok) throw new Error(payload.message || "Failed to fetch classes");

        const lists = Array.isArray(payload)
            ? payload
            : (payload.data || payload.lists || payload.classLists || []);

        renderClassOverview(box, lists);
    } catch (error) {
        console.error("[ERROR] Class overview fetch error:", error);
        box.innerHTML = `<p class="empty-text" style="color: #ef4444; padding: 10px;">Could not load classes. Ensure backend port 5000 is running.</p>`;
    }
}

function renderClassOverview(box, lists) {
    if (!lists.length) {
        box.innerHTML = `<p class="empty-text">No classes have been created yet.</p>`;
        return;
    }

    // Earliest day first, so the week reads in the order it happens.
    const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const sorted = lists.slice().sort((a, b) => {
        const d = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
        if (d !== 0) return d;
        return String(a.class_time || "").localeCompare(String(b.class_time || ""));
    });

    box.innerHTML = sorted.map(item => {
        const when = [item.day, item.class_time].filter(Boolean).join(" — ") || "Time not set";
        const who = item.professor_name || "No professor assigned";
        return `
            <div class="course-card-item" style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 8px;">
                <div style="min-width: 0;">
                    <strong style="color: #1e293b; display: block;">${escapeHtml(item.subject || "Untitled subject")}</strong>
                    <span style="color: #64748b; font-size: 13px;">${escapeHtml(who)}</span>
                </div>
                <span style="color: #1e3a8a; background: #eff6ff; border-radius: 6px; padding: 5px 10px; font-size: 12px; white-space: nowrap;">${escapeHtml(when)}</span>
            </div>`;
    }).join("");
}

/* =====================================================================
   2. PENDING STUDENT APPROVAL QUEUE SYSTEM
   ===================================================================== */
async function loadPendingStudents() {
    const tbody = document.getElementById('pending-students-tbody') 
        || document.getElementById('pendingStudentsTable') 
        || document.getElementById('pendingTableBody') 
        || document.querySelector('tbody');

    const badge = document.getElementById('pending-count-badge') 
        || document.querySelector('.pending-badge') 
        || document.querySelector('.badge') 
        || document.querySelector('span[class*="Pending"]');

    console.log("[DEBUG] Target tbody element:", tbody);
    console.log("[DEBUG] Target badge element:", badge);

    if (!tbody) {
        console.warn("[WARN] Could not find pending table body container in HTML DOM.");
        return;
    }

    try {
        const apiUrl = getApiUrl('/api/students/pending');
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const rawData = await response.json();
        const pendingList = Array.isArray(rawData) 
            ? rawData 
            : (rawData.data || rawData.students || []);

        if (badge) {
            badge.textContent = `${pendingList.length} Pending`;
        }

        if (pendingList.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; padding: 20px; color: #64748b;">
                        No pending student approvals at this time.
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = pendingList.map(student => {
            const studentId = student.user_id || student.student_no || student.id;
            const studentName = student.full_name 
                ? student.full_name 
                : (student.first_name ? `${student.first_name} ${student.last_name}` : (student.email || 'N/A'));
            
            const requestedDate = student.created_at 
                ? new Date(student.created_at).toLocaleDateString() 
                : 'N/A';

            return `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 12px; font-weight: 600; color: #334155;">${escapeHtml(studentId)}</td>
                    <td style="padding: 12px; color: #475569;">${escapeHtml(studentName)}</td>
                    <td style="padding: 12px; color: #64748b; font-size: 0.9rem;">${requestedDate}</td>
                    <td style="padding: 12px; text-align: center;">
                        <button onclick="approveStudent('${studentId}')" 
                            style="background: #22c55e; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; margin-right: 5px; font-weight: bold; transition: 0.2s;">
                            Approve
                        </button>
                        <button onclick="rejectStudent('${studentId}')" 
                            style="background: #ef4444; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: bold; transition: 0.2s;">
                            Reject
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (error) {
        console.error('[ERROR] Fetching pending queue:', error);
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 15px; color: #ef4444;">Server connection error. Ensure port 5000 is running.</td></tr>`;
    }
}

function approveStudent(studentId) {
    showConfirmModal({
        title: 'Approve Registration',
        message: `Are you sure you want to approve registration request for "${studentId}"?`,
        iconClass: 'fa-solid fa-circle-check',
        confirmBtnText: 'Approve',
        confirmBtnBg: '#22c55e',
        onConfirm: async () => {
            try {
                const apiUrl = getApiUrl('/api/students/approval');
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ studentId: studentId, status: 'approved' })
                });

                const result = await response.json();
                if (response.ok && (result.status === 'success' || result.success || result.message)) {
                    showToast(`Student "${studentId}" has been approved!`, 'success');
                    loadDashboardData();
                    loadPendingStudents();
                } else {
                    showToast(result.message || 'Failed to approve student.', 'error');
                }
            } catch (error) {
                console.error('[ERROR] Approving student:', error);
                showToast('An error occurred while approving the student.', 'error');
            }
        }
    });
}

function rejectStudent(studentId) {
    showConfirmModal({
        title: 'Reject Registration',
        message: `Are you sure you want to reject registration request for "${studentId}"?`,
        iconClass: 'fa-solid fa-circle-xmark',
        confirmBtnText: 'Reject Request',
        confirmBtnBg: '#ef4444',
        onConfirm: async () => {
            try {
                const apiUrl = getApiUrl('/api/students/approval');
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ studentId: studentId, status: 'rejected' })
                });

                const result = await response.json();
                if (response.ok && (result.status === 'success' || result.success || result.message)) {
                    showToast(`Registration request for "${studentId}" rejected.`, 'success');
                    loadDashboardData();
                    loadPendingStudents();
                } else {
                    showToast(result.message || 'Failed to reject registration request.', 'error');
                }
            } catch (error) {
                console.error('[ERROR] Rejecting student:', error);
                showToast('An error occurred while rejecting the student.', 'error');
            }
        }
    });
}

/* =====================================================================
   3. CUSTOM UI DIALOGS & NOTIFICATIONS (NO BROWSER ALERTS)
   ===================================================================== */
function showToast(message, type = 'success') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-xmark'}" style="color: ${type === 'success' ? '#22c55e' : '#ef4444'}; font-size: 1.1rem;"></i>
        <span>${escapeHtml(message)}</span>
    `;
    
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function showConfirmModal({ title, message, iconClass, confirmBtnText, confirmBtnBg, onConfirm }) {
    const modal = document.getElementById('customModal');
    if (!modal) {
        console.warn("[WARN] Custom modal element (#customModal) not found in DOM.");
        return;
    }

    const titleEl = document.getElementById('modalTitle');
    const msgEl = document.getElementById('modalMessage');
    const iconEl = document.getElementById('modalIcon');
    const cancelBtn = document.getElementById('modalCancelBtn');
    const confirmBtn = document.getElementById('modalConfirmBtn');

    if (titleEl) titleEl.textContent = title || 'Confirm Action';
    if (msgEl) msgEl.textContent = message || 'Are you sure?';
    if (iconEl) iconEl.className = iconClass || 'fa-solid fa-triangle-exclamation';
    if (confirmBtn) {
        confirmBtn.textContent = confirmBtnText || 'Confirm';
        confirmBtn.style.background = confirmBtnBg || '#2563eb';
    }

    modal.style.display = 'flex';

    const cleanup = () => {
        modal.style.display = 'none';
        if (cancelBtn) cancelBtn.onclick = null;
        if (confirmBtn) confirmBtn.onclick = null;
    };

    if (cancelBtn) cancelBtn.onclick = cleanup;
    if (confirmBtn) {
        confirmBtn.onclick = () => {
            cleanup();
            if (typeof onConfirm === 'function') onConfirm();
        };
    }
}

/* =====================================================================
   4. UTILITY FUNCTIONS
   ===================================================================== */
function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/[&<>"']/g, (m) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[m]));
}

async function loadAdminWelcomeName(userId) {
    const welcomeHeading = document.getElementById('welcomeHeading');
    if (!welcomeHeading) return;
    try {
        // The summary endpoint leaves out the stored profile picture, which is over a
    // megabyte of base64 text and is not drawn on this page.
    const response = await fetch(getApiUrl(`/api/profile/summary?user_id=${encodeURIComponent(userId)}`));
        if (!response.ok) throw new Error();
        const result = await response.json();
        const profile = result.data || result;
        const name = profile.full_name || profile.name || userId;
        welcomeHeading.textContent = `Welcome, ${name}`;
        const userDisplay = document.getElementById('loggedInUser');
        if (userDisplay) userDisplay.textContent = name;
    } catch (error) {
        welcomeHeading.textContent = `Welcome, ${userId}`;
    }
}

(function installAuthenticatedFetch() {
  if (window.__sisAuthenticatedFetchInstalled) return;
  window.__sisAuthenticatedFetchInstalled = true;

  // The API lives on the same origin as the page whenever the page was served
  // by our own server. That is true on port 5000 and also behind a tunnel or
  // reverse proxy, where the public URL has no explicit port. Only pages opened
  // from a separate dev server (a different port) need :5000 appended.
  const apiOrigin = () => {
    if (window.location.port === '5000' || window.location.port === '') return '';
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const hostname = window.location.hostname || 'localhost';
    return `${protocol}//${hostname}:5000`;
  };
  window.sisApiUrl = endpoint => `${apiOrigin()}${endpoint}`;

  
  let socketSingleton = null;

  window.sisSocket = () => {
    if (socketSingleton) return socketSingleton;
    if (typeof window.io !== 'function') return null;
    const backendOrigin = window.sisApiUrl('') || window.location.origin;
    socketSingleton = window.io(backendOrigin, {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 5000
    });
    return socketSingleton;
  };

  

  const DATA_CHANGE_EVENTS = [
    'account_created',
    'class_list_label_updated',
    'managed_user_deleted',
    'managed_user_updated',
    'new_student_registered',
    'schedule_created',
    'schedule_updated',
    'schedule_deleted',
    'student_status_updated',
    'students_imported',
    'teacher_created',
    'teacher_deleted'
  ];

  // Refresh data in place instead of reloading the page. Reloading re-downloads
  // the HTML, re-parses the CSS and re-runs every script, which is what made the
  // pages flash and stutter whenever a schedule changed.
  window.sisOnDataChange = (callback, wait = 150) => {
    if (typeof callback !== 'function') return () => {};
    const socket = window.sisSocket();
    if (!socket) return () => {};
    let timer = null;
    const handler = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        try {
          callback();
        } catch (error) {
          console.warn('Live refresh failed.', error);
        }
      }, wait);
    };
    DATA_CHANGE_EVENTS.forEach(name => socket.on(name, handler));
    return () => {
      window.clearTimeout(timer);
      DATA_CHANGE_EVENTS.forEach(name => socket.off(name, handler));
    };
  };

  // Custom display names for a department/course group. These are cosmetic only:
  // the stored department and course always stay the BSIT values.
  const text = value => String(value ?? '').trim();

  const groupLabelKey = (department, course) =>
    `${text(department)}|||${text(course)}`.toLowerCase();

  window.sisGroupLabel = (group, labels) => {
    const course = text(group.course || group.section_course);
    const custom = labels?.[groupLabelKey(group.department, course)];
    return text(custom) || `${text(group.department)} / ${course}`;
  };

  window.sisLoadGroupLabels = async () => {
    try {
      const response = await window.fetch(window.sisApiUrl('/api/class-list-schedules/group-labels'));
      if (!response.ok) return {};
      const rows = await response.json();
      if (!Array.isArray(rows)) return {};
      return Object.fromEntries(
        rows
          .filter(row => text(row.display_label))
          .map(row => [groupLabelKey(row.department, row.course), text(row.display_label)])
      );
    } catch {
      return {};
    }
  };

  const normalizeClockPart = (value) => {
    const raw = String(value ?? '').trim();
    const match = raw.match(/(\d{1,2})(?::(\d{2}))(?::(\d{2}))?\s*(AM|PM)?/i);

    if (!match) return null;

    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const period = (match[4] || '').toUpperCase();
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
    if (period) {
      if (hour < 1 || hour > 12) return null;
      if (period === 'AM' && hour === 12) hour = 0;
      if (period === 'PM' && hour !== 12) hour += 12;
    } else if (hour > 23) {
      return null;
    }
    return { hour, minute };
  };

  window.sisFormatTime12 = (value) => {
    const parsed = value && typeof value === 'object' && Number.isInteger(value.hour)
      ? value
      : normalizeClockPart(value);
    if (!parsed) return String(value ?? '').trim();
    const hour = parsed.hour % 12 || 12;
    return `${hour}:${String(parsed.minute).padStart(2, '0')} ${parsed.hour >= 12 ? 'PM' : 'AM'}`;
  };

  // Every panel shows a room through this one function, so the same room always
  // reads the same way. Two rules, and nothing else.
  //   1. Repeated and stray spaces are squeezed to single ones.
  //   2. A plain word is written with one capital and the rest small, so "LAB
  //      203" and "lab 203" both read "Lab 203".
  // A token holding a digit is left exactly as typed, because that is a code
  // rather than a word: "ITC-111B" must not become "Itc-111b".
  window.sisFormatRoom = (value) => {
    const raw = String(value ?? '').trim().replace(/\s+/g, ' ');
    // The text "N/A" used to be written into the database in place of a room.
    // Treat it as no room, so any older row reads the same as a new one.
    if (!raw || raw.toUpperCase() === 'N/A') return 'Not set';
    return raw
      .split(' ')
      .map(token => {
        if (/[0-9]/.test(token)) return token;
        return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
      })
      .join(' ');
  };

  window.sisFormatClassTime = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const parts = raw.split(/\s*(?:-|–|—|\bto\b)\s*/i);
    const start = normalizeClockPart(parts[0]);
    const end = normalizeClockPart(parts.slice(1).join(' - '));
    if (start && end) return `${window.sisFormatTime12(start)} - ${window.sisFormatTime12(end)}`;
    if (start && parts.length === 1) return window.sisFormatTime12(start);
    return raw;
  };

  // Every page calls its API through this wrapper. Without a time limit a call
  // to a backend that is not running stays pending for ever, which leaves the
  // page stuck on a spinner and keeps the browser busy. The limit turns that
  // into an ordinary failed request the page can already handle.
  const REQUEST_TIMEOUT_MS = 12000;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const requestInit = { ...init };
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    const token = localStorage.getItem('auth_token');

    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (!requestInit.credentials) requestInit.credentials = 'include';
    requestInit.headers = headers;

    const controller = new AbortController();
    const callerSignal = requestInit.signal;
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    requestInit.signal = controller.signal;

    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    return nativeFetch(input, requestInit).finally(() => clearTimeout(timer));
  };

  // Shown once when the backend cannot be reached, so a stopped server reads as
  // a stopped server instead of a page that never finishes loading.
  let backendNoticeShown = false;
  window.sisReportBackendDown = detail => {
    if (backendNoticeShown) return;
    backendNoticeShown = true;
    const message = 'Cannot reach the server. Start it with "npm.cmd start" in a terminal, then refresh this page.';
    console.warn('[SIS]', message, detail || '');
    const banner = document.createElement('div');
    banner.className = 'sis-backend-down';
    banner.setAttribute('role', 'alert');
    banner.textContent = message;
    document.body.appendChild(banner);
    
    setTimeout(() => { backendNoticeShown = false; }, 30000);
  };

  window.sisLogout = async (redirectUrl) => {
    try {
      await window.fetch(window.sisApiUrl('/api/logout'), { method: 'POST' });
    } catch {
      // Clear local state even if the API is unavailable.
    }
    localStorage.clear();
    sessionStorage.clear();
    if (redirectUrl) window.location.href = redirectUrl;
  };
})();

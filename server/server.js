const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const dotenv = require('dotenv');

// Load environment variables before importing any configuration module.
dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });
dotenv.config({ path: path.join(__dirname, 'process.env'), quiet: true });

const db = require('./config/db');
const studentController = require('./controllers/studentController');
const profileController = require('./controllers/profileController');
const scheduleController = require('./controllers/scheduleController');
const authRoutes = require('./routes/authRoutes');
const otpRoutes = require('./routes/otpRoutes');
const profileRoutes = require('./routes/profileRoutes');
const scheduleRoutes = require('./routes/scheduleRoutes');
const studentRoutes = require('./routes/studentRoutes');
const teacherRoutes = require('./routes/teacherRoutes');
const classListRoutes = require('./routes/classListRoutes');
const { optionalAuth, requireAuth, requireRole } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const rootDirectory = path.join(__dirname, '..');

const configuredOrigins = new Set(
  String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
);
const isPrivateIpv4 = (hostname) => {
  const parts = String(hostname || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
};
const isLocalDevelopmentOrigin = (origin) => {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    const privateNetworkHost = isPrivateIpv4(parsed.hostname);
    const protocolAllowed = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    return protocolAllowed
      && (localHost || (process.env.NODE_ENV !== 'production' && privateNetworkHost));
  } catch {
    return false;
  }
};
// A page served by this server always calls the API on its own origin, so the
// request's own host must be accepted. That is what allows the app to work
// behind a tunnel or reverse proxy without hard-coding that hostname, and it
// does not weaken the check because a foreign origin still cannot match the
// Host header of this server.
const isSameOrigin = (req, origin) => {
  if (!origin || !req || !req.headers) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host.toLowerCase() === String(req.headers.host || '').toLowerCase();
  } catch {
    return false;
  }
};

const corsOptions = (req, callback) => {
  const origin = req?.headers?.origin;
  const allowed = !origin
    || isSameOrigin(req, origin)
    || configuredOrigins.has(origin)
    || (process.env.NODE_ENV !== 'production' && isLocalDevelopmentOrigin(origin));
  callback(null, {
    origin: allowed,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  });
};

const io = new Server(server, { cors: corsOptions });

io.on('connection', socket => {
  console.log(`[SOCKET] Client connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`[SOCKET] Client disconnected: ${socket.id}`));
});

// A tunnel such as Cloudflare Tunnel connects to this machine from localhost and
// passes the real visitor address in a header. Trusting only loopback means those
// headers are honoured for tunnel traffic, while a direct connection from another
// machine still cannot pretend to be a different address.
app.set('trust proxy', 'loopback');

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Without the real visitor address every person using the tunnel looks like one
// caller, so the login lockout would count everybody's wrong passwords together
// and lock out the whole group at once. Express derives req.ip from this header,
// so it has to be the header that is set, not req.ip itself. Only requests that
// actually arrive from this machine are allowed to set it.
const isFromThisMachine = req => {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
};
app.use((req, _res, next) => {
  if (isFromThisMachine(req)) {
    const realAddress = String(req.headers['cf-connecting-ip'] || '').trim();
    if (realAddress) req.headers['x-forwarded-for'] = realAddress;
  }
  next();
});

app.use(optionalAuth);
app.use((req, _res, next) => {
  req.io = io;
  next();
});

// Public registration status check. It intentionally returns only a boolean.
app.get('/api/students/check/:userId', studentController.checkStudentRegistrationStatus);

app.use('/api', authRoutes);
app.use('/api', otpRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/schedule', scheduleRoutes);
app.get('/api/teachers', requireRole('admin', 'teacher'), scheduleController.getTeachers);
app.use('/api/students', studentRoutes);
app.use('/api/admin/teachers', teacherRoutes);
app.use('/api/class-list-schedules', classListRoutes);

// Backward-compatible aliases used by older pages.
app.get('/api/students-c', requireRole('admin'), studentController.getDashboardCounts);
app.post('/api/students/approval', requireRole('admin'), studentController.updateApprovalStatus);
app.get('/api/schedules', requireRole('admin', 'teacher'), scheduleController.getSchedules);
app.post('/api/schedules', requireRole('admin'), scheduleController.createSchedule);
app.put('/api/schedules/:id', requireRole('admin'), scheduleController.updateSchedule);
app.delete('/api/schedules/:id', requireRole('admin'), scheduleController.deleteSchedule);
app.get('/api/student/schedule/:id', requireRole('admin', 'teacher', 'student'), scheduleController.getStudentSchedule);
app.post('/api/update-profile', requireAuth, profileController.updateProfile);
app.put('/api/update-profile', requireAuth, profileController.updateProfile);

// Serve only known public front-end directories. Do not expose the project root,
// database files, environment files, server source, or native binaries.
const publicDirectories = [
  'About fol',
  'Add students fol',
  'Dashboard fol',
  'Forgot password fol',
  'Login part',
  'Profile pic_part',
  'schedule fol',
  'students dashboard fol',
  'Teachers_panel',
  'View schedule',
  'View students fol'
];
const publicStaticHandlers = new Map(publicDirectories.map(directory => [
  directory,
  express.static(path.join(rootDirectory, directory), { dotfiles: 'deny', index: false })
]));

app.use((req, res, next) => {
  let pathname;
  try {
    pathname = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    return next();
  }
  const directory = publicDirectories.find(candidate =>
    pathname === `/${candidate}` || pathname.startsWith(`/${candidate}/`)
  );
  if (!directory) return next();

  // A page is the entry point that names every script it needs. If a browser or
  // a tunnel edge kept an old copy, the visitor would run old code, so pages are
  // always re-checked. The reply is only a small 304 when nothing changed.
  if (pathname.toLowerCase().endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  }

  const originalUrl = req.url;
  const relativePath = pathname.slice(directory.length + 1) || '/';
  const queryIndex = req.url.indexOf('?');
  const query = queryIndex >= 0 ? req.url.slice(queryIndex) : '';
  req.url = `${relativePath.startsWith('/') ? relativePath : `/${relativePath}`}${query}`;
  return publicStaticHandlers.get(directory)(req, res, error => {
    req.url = originalUrl;
    next(error);
  });
});
app.get('/auth-client.js', (_req, res) => res.sendFile(path.join(rootDirectory, 'auth-client.js')));

// The spreadsheet library is already installed as a project dependency, so the
// import/export pages load it from this server instead of a public CDN. A user
// on a different network (for example through the tunnel) can otherwise be
// blocked from the CDN, which silently breaks importing a student list.
const spreadsheetLibrary = path.join(rootDirectory, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js');
app.get('/vendor/xlsx.full.min.js', (_req, res) => {
  res.sendFile(spreadsheetLibrary, err => {
    if (err) res.status(404).json({ error: 'Spreadsheet library is not installed. Run npm install.' });
  });
});

app.get('/api/health', (_req, res) => res.json({ status: 'success', service: 'student-information-system' }));
app.get('/', (_req, res) => res.redirect('/Login%20part/login.html'));

app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

const port = Number(process.env.PORT) || 5000;
server.listen(port, () => console.log(`Server running smoothly on http://localhost:${port}`));

module.exports = { app, server, io };

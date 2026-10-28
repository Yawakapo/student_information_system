const crypto = require('crypto');

const COOKIE_NAME = 'sis_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('SESSION_SECRET must be configured in production.');
}
const developmentSecret = crypto.randomBytes(32).toString('hex');
const sessionSecret = process.env.SESSION_SECRET || developmentSecret;

if (!process.env.SESSION_SECRET && process.env.NODE_ENV !== 'production') {
  console.warn('[AUTH WARNING] SESSION_SECRET is not set; using an ephemeral development secret.');
}

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

const signToken = (payload = {}) => {
  const body = encode({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  });
  const signature = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
};

const verifyToken = (token) => {
  if (!token || typeof token !== 'string') return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return null;
  }

  try {
    const payload = decode(body);
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
};

const parseCookies = (header = '') => header.split(';').reduce((cookies, part) => {
  const separator = part.indexOf('=');
  if (separator < 0) return cookies;
  const key = part.slice(0, separator).trim();
  const value = part.slice(separator + 1).trim();
  if (key) {
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}, {});

const getRequestToken = (req) => {
  const authorization = String(req.headers.authorization || '');
  if (authorization.startsWith('Bearer ')) return authorization.slice(7).trim();
  return parseCookies(req.headers.cookie)[COOKIE_NAME] || null;
};

const setSessionCookie = (res, token) => {
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`
  ];
  if (process.env.NODE_ENV === 'production') attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
};

const clearSessionCookie = (res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
};

const optionalAuth = (req, _res, next) => {
  req.user = verifyToken(getRequestToken(req));
  next();
};

const requireAuth = async (req, res, next) => {
  const user = verifyToken(getRequestToken(req));
  if (!user || !user.userId || !user.role) {
    return res.status(401).json({ status: 'error', message: 'Authentication required.' });
  }

  try {
    // Check the current account state so deactivating a user immediately
    // revokes previously issued bearer tokens and cookies.
    const db = require('../config/db');
const [rows] = await db.execute(
      'SELECT id, user_id, role, status, approval_status FROM users WHERE id = ? LIMIT 1',
      [user.userId]
    );
    if (!rows.length || String(rows[0].status || 'Active').toLowerCase() !== 'active') {
      return res.status(401).json({ status: 'error', message: 'This account is inactive or no longer exists.' });
    }

    req.user = {
      ...user,
      userId: rows[0].id,
      user_id: rows[0].user_id,
      role: String(rows[0].role || '').toLowerCase()
    };
    return next();
  } catch (error) {
    return next(error);
  }
};

const requireRole = (...roles) => (req, res, next) => {
  return requireAuth(req, res, () => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ status: 'error', message: 'You do not have permission to perform this action.' });
    }
    return next();
  });
};

module.exports = {
  COOKIE_NAME,
  clearSessionCookie,
  optionalAuth,
  requireAuth,
  requireRole,
  setSessionCookie,
  signToken,
  verifyToken
};

// server/config/db.js
require('./env');
const mysql = require('mysql2/promise');

const required = (name, fallbackName) => {
  const value = process.env[name] || (fallbackName ? process.env[fallbackName] : '');
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: required('DB_USER', 'SQL_USER'),
  password: required('DB_PASSWORD', 'SQL_PASS'),
  database: required('DB_NAME'),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test connection safely on startup
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log('Connected to MySQL Database!');
    connection.release();

    
  } catch (err) {
    console.error('Database connection failed:', err.message);
  }
})();

module.exports = pool;

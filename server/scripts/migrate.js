require('../config/env');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || process.env.SQL_USER,
    password: process.env.DB_PASSWORD || process.env.SQL_PASS,
    multipleStatements: true
  });

  try {
    const migration = fs.readFileSync(path.join(__dirname, '../database/001_initial_schema.sql'), 'utf8');
    await connection.query(migration);
    // Keep existing installations in sync with the profile email-change
    // challenge columns. The initial schema already contains these columns;
    // duplicate-column errors are expected when it is rerun.
    const profileColumns = [
      ['pending_email', 'VARCHAR(100) DEFAULT NULL'],
      ['email_change_otp', 'VARCHAR(6) DEFAULT NULL'],
      ['email_change_expires', 'DATETIME DEFAULT NULL']
    ];
    for (const [column, definition] of profileColumns) {
      try {
        await connection.query(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
      } catch (error) {
        if (error.code !== 'ER_DUP_FIELDNAME') throw error;
      }
    }
    console.log('Database migration completed.');
  } finally {
    await connection.end();
  }
})().catch(error => {
  console.error('Database migration failed:', error.message);
  process.exitCode = 1;
});

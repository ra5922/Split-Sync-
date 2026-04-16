const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'splitter',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'root123',
  port: process.env.DB_PORT || 5432,
});

pool.on('error', (err) => console.error('DB Pool Error:', err));

module.exports = { pool };

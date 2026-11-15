const { Pool, types } = require('pg');

// Return NUMERIC and BIGINT (COUNT/SUM) as JS numbers, DATE as 'YYYY-MM-DD'.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(1082, (v) => v);

let pool = null;

async function initPool() {
  if (pool) return;
  const p = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    max: 10
  });
  try {
    await p.query('SELECT 1'); // fail fast if the DB is unreachable
  } catch (err) {
    await p.end();
    throw err;
  }
  pool = p;
}

async function closePool() {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

function query(sql, params) {
  if (!pool) throw new Error('DB pool not initialised');
  return pool.query(sql, params);
}

// Run fn(client) inside a transaction; client.query(sql, params) like query().
async function withTransaction(fn) {
  if (!pool) throw new Error('DB pool not initialised');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

const PG_UNIQUE_VIOLATION = '23505';
const PG_FK_VIOLATION = '23503';

module.exports = { initPool, closePool, query, withTransaction, PG_UNIQUE_VIOLATION, PG_FK_VIOLATION };

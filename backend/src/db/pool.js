const oracledb = require('oracledb');

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

function safeGetPool() {
  try {
    return oracledb.getPool();
  } catch {
    return null;
  }
}

async function initPool() {
  if (safeGetPool()) return;
  await oracledb.createPool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECTION_STRING,
    poolMin: 1,
    poolMax: 10,
    poolIncrement: 1
  });
}

async function closePool() {
  const pool = safeGetPool();
  if (pool) await pool.close(0);
}

async function getConnection() {
  return oracledb.getConnection();
}

module.exports = { initPool, closePool, getConnection };

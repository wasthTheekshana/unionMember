// Shared test helpers. Auth checks the database, so tests need a real user row.
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { query } = require('../src/db/pool');

const TEST_USER = 'jest_api_user';
const TEST_PASS = 'Jest-Pass-12345';

async function createTestUser(username = TEST_USER) {
  const hash = await bcrypt.hash(TEST_PASS, 4);
  const r = await query(
    `INSERT INTO pm_users (username, password_hash) VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING user_id, username, token_version`,
    [username, hash]
  );
  const u = r.rows[0];
  return { user: u, token: tokenFor(u) };
}

function tokenFor(u) {
  return jwt.sign(
    { userId: u.user_id, username: u.username, tv: u.token_version },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

async function removeTestUser(username = TEST_USER) {
  await query(`DELETE FROM pm_users WHERE username = $1`, [username]);
  // Tests leave audit rows behind; they belong to the test user, so clean them too.
  await query(`DELETE FROM pm_audit_log WHERE username = $1`, [username]);
}

module.exports = { createTestUser, removeTestUser, tokenFor, TEST_USER, TEST_PASS };

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initPool, closePool, query } = require('../db/pool');
const { WEAK } = require('../config');

// Usage:
//   ADMIN_PASSWORD='...' node src/scripts/seed-admin.js --username <name>
//   node src/scripts/seed-admin.js --username <name> --password <pass>   (visible in shell history)
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--username') result.username = args[i + 1];
    if (args[i] === '--password') result.password = args[i + 1];
  }
  if (!result.password && process.env.ADMIN_PASSWORD) result.password = process.env.ADMIN_PASSWORD;
  return result;
}

async function run() {
  const { username, password } = parseArgs();
  if (!username || !password) {
    console.error('Usage: ADMIN_PASSWORD=<pass> node src/scripts/seed-admin.js --username <name>');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('Password must be at least 10 characters.');
    process.exit(1);
  }
  if (WEAK.has(password.toLowerCase()) || password.toLowerCase() === username.toLowerCase()) {
    console.error('That password is too easy to guess. Choose a different one.');
    process.exit(1);
  }

  await initPool();
  try {
    const existing = await query(`SELECT user_id FROM pm_users WHERE username = $1`, [username]);
    if (existing.rows.length > 0) {
      console.log(`User "${username}" already exists - skipping. Change the password in the app (Account page).`);
      return;
    }
    const hash = await bcrypt.hash(password, 12);
    await query(`INSERT INTO pm_users (username, password_hash) VALUES ($1, $2)`, [username, hash]);
    console.log(`Admin user "${username}" created.`);
  } finally {
    await closePool();
  }
}

run().catch((err) => {
  console.error('Seed admin failed:', err);
  process.exit(1);
});

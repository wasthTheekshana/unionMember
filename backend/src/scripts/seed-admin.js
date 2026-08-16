require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initPool, closePool, getConnection } = require('../db/pool');

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--username') result.username = args[i + 1];
    if (args[i] === '--password') result.password = args[i + 1];
  }
  return result;
}

async function run() {
  const { username, password } = parseArgs();
  if (!username || !password) {
    console.error('Usage: node src/scripts/seed-admin.js --username <name> --password <pass>');
    process.exit(1);
  }

  await initPool();
  const conn = await getConnection();
  try {
    const existing = await conn.execute(
      `SELECT user_id FROM users WHERE username = :u`,
      { u: username }
    );
    if (existing.rows.length > 0) {
      console.log(`User "${username}" already exists — skipping.`);
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    await conn.execute(
      `INSERT INTO users (username, password_hash) VALUES (:u, :p)`,
      { u: username, p: hash }
    );
    await conn.commit();
    console.log(`Admin user "${username}" created.`);
  } finally {
    await conn.close();
    await closePool();
  }
}

run().catch((err) => {
  console.error('Seed admin failed:', err);
  process.exit(1);
});

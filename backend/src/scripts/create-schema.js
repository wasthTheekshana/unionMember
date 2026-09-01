require('dotenv').config();
const { initPool, closePool, getConnection } = require('../db/pool');

const statements = [
  `CREATE TABLE officers (
    officer_id   NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    officer_name VARCHAR2(200) NOT NULL UNIQUE
  )`,
  // NOTE: if a `members` table already exists on this DB with member_id as NUMBER
  // (from before alphanumeric member IDs were discovered in the source CSV), this
  // script will silently skip it (see ORA_NAME_ALREADY_USED handling below) without
  // correcting the column type. member_id must be VARCHAR2(20) — if you find an
  // existing NUMBER-typed members table, drop and recreate it manually before
  // re-running this script / the CSV import.
  `CREATE TABLE members (
    member_id    VARCHAR2(20) PRIMARY KEY,
    member_name  VARCHAR2(200) NOT NULL,
    officer_id   NUMBER REFERENCES officers(officer_id),
    phone        VARCHAR2(50),
    email        VARCHAR2(200),
    address      VARCHAR2(500),
    created_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at   TIMESTAMP DEFAULT SYSTIMESTAMP
  )`,
  `CREATE TABLE users (
    user_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username      VARCHAR2(100) NOT NULL UNIQUE,
    password_hash VARCHAR2(255) NOT NULL,
    created_at    TIMESTAMP DEFAULT SYSTIMESTAMP
  )`
];

const ORA_NAME_ALREADY_USED = 955;

async function run() {
  await initPool();
  const conn = await getConnection();
  try {
    for (const sql of statements) {
      try {
        await conn.execute(sql);
        console.log('Created table OK:', sql.split('\n')[0]);
      } catch (err) {
        if (err.errorNum === ORA_NAME_ALREADY_USED) {
          console.log('Table already exists, skipping:', sql.split('\n')[0]);
        } else {
          throw err;
        }
      }
    }
    await conn.commit();
  } finally {
    await conn.close();
    await closePool();
  }
}

run().catch((err) => {
  console.error('Schema creation failed:', err);
  process.exit(1);
});

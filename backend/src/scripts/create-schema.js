require('dotenv').config();
const { initPool, closePool, getConnection } = require('../db/pool');

// Tables are prefixed pm_ because this app runs in a shared Oracle "system"
// schema alongside other applications — unprefixed names like `users` collide
// with tables those other apps already own (e.g. an existing HR/payroll
// `users` table with completely different columns).
//
// Auto-increment IDs (pm_officers.officer_id, pm_users.user_id) use a
// sequence + BEFORE INSERT trigger, matching the convention used by the
// IT-Asset-Management app sharing this schema, rather than
// GENERATED ALWAYS AS IDENTITY.

const ORA_NAME_ALREADY_USED = 955;

async function createTable(connection, sql, description) {
  try {
    await connection.execute(sql);
    console.log(`  [CREATED] ${description}`);
    return true;
  } catch (err) {
    if (err.errorNum === ORA_NAME_ALREADY_USED) {
      console.log(`  [EXISTS]  ${description}`);
      return false;
    }
    console.log(`  [ERROR]   ${description}: ${err.message.split('\n')[0]}`);
    throw err;
  }
}

async function createSequence(connection, seqName) {
  try {
    await connection.execute(`CREATE SEQUENCE ${seqName} START WITH 1 INCREMENT BY 1`);
    console.log(`  [CREATED] Sequence ${seqName}`);
  } catch (err) {
    if (err.errorNum === ORA_NAME_ALREADY_USED) {
      console.log(`  [EXISTS]  Sequence ${seqName}`);
    } else {
      console.log(`  [ERROR]   Sequence ${seqName}: ${err.message.split('\n')[0]}`);
      throw err;
    }
  }
}

async function createTrigger(connection, sql, description) {
  try {
    await connection.execute(sql);
    console.log(`  [OK]      ${description}`);
  } catch (err) {
    console.log(`  [ERROR]   ${description}: ${err.message.split('\n')[0]}`);
    throw err;
  }
}

async function run() {
  await initPool();
  const conn = await getConnection();
  try {
    console.log('Creating sequences...');
    await createSequence(conn, 'pm_officers_seq');
    await createSequence(conn, 'pm_users_seq');

    console.log('\nCreating tables...');
    await createTable(conn, `
      CREATE TABLE pm_officers (
        officer_id   NUMBER PRIMARY KEY,
        officer_name VARCHAR2(200) NOT NULL UNIQUE
      )
    `, 'Create pm_officers table');

    // NOTE: if a pm_members table already exists on this DB with member_id as
    // NUMBER (from before alphanumeric member IDs were discovered in the
    // source CSV), this script will silently skip it without correcting the
    // column type. member_id must be VARCHAR2(20) — if you find an existing
    // NUMBER-typed pm_members table, drop and recreate it manually before
    // re-running this script / the CSV import.
    await createTable(conn, `
      CREATE TABLE pm_members (
        member_id    VARCHAR2(20) PRIMARY KEY,
        member_name  VARCHAR2(200) NOT NULL,
        officer_id   NUMBER REFERENCES pm_officers(officer_id),
        phone        VARCHAR2(50),
        email        VARCHAR2(200),
        address      VARCHAR2(500),
        created_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
        updated_at   TIMESTAMP DEFAULT SYSTIMESTAMP
      )
    `, 'Create pm_members table');

    await createTable(conn, `
      CREATE TABLE pm_users (
        user_id       NUMBER PRIMARY KEY,
        username      VARCHAR2(100) NOT NULL UNIQUE,
        password_hash VARCHAR2(255) NOT NULL,
        created_at    TIMESTAMP DEFAULT SYSTIMESTAMP
      )
    `, 'Create pm_users table');

    console.log('\nCreating triggers...');
    await createTrigger(conn, `
      CREATE OR REPLACE TRIGGER trg_pm_officers_id
      BEFORE INSERT ON pm_officers FOR EACH ROW
      BEGIN IF :NEW.officer_id IS NULL THEN SELECT pm_officers_seq.NEXTVAL INTO :NEW.officer_id FROM DUAL; END IF; END;
    `, 'Create trigger trg_pm_officers_id');

    await createTrigger(conn, `
      CREATE OR REPLACE TRIGGER trg_pm_users_id
      BEFORE INSERT ON pm_users FOR EACH ROW
      BEGIN IF :NEW.user_id IS NULL THEN SELECT pm_users_seq.NEXTVAL INTO :NEW.user_id FROM DUAL; END IF; END;
    `, 'Create trigger trg_pm_users_id');

    await conn.commit();
    console.log('\nSchema setup complete.');
  } finally {
    await conn.close();
    await closePool();
  }
}

run().catch((err) => {
  console.error('Schema creation failed:', err);
  process.exit(1);
});

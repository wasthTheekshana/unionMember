require('dotenv').config();
const { initPool, closePool, query } = require('../db/pool');

// Idempotent: safe to re-run. Existing tables are left alone; later additions
// use IF NOT EXISTS.
const STATEMENTS = [
  ['pm_officers', `
    CREATE TABLE IF NOT EXISTS pm_officers (
      officer_id   SERIAL PRIMARY KEY,
      officer_name VARCHAR(200) NOT NULL UNIQUE
    )`],
  ['pm_members', `
    CREATE TABLE IF NOT EXISTS pm_members (
      member_id    VARCHAR(20) PRIMARY KEY,
      member_name  VARCHAR(200) NOT NULL,
      officer_id   INTEGER REFERENCES pm_officers(officer_id),
      phone        VARCHAR(50),
      email        VARCHAR(200),
      address      VARCHAR(500),
      created_at   TIMESTAMP NOT NULL DEFAULT now(),
      updated_at   TIMESTAMP NOT NULL DEFAULT now()
    )`],
  ['pm_members.is_active', `ALTER TABLE pm_members ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`],
  ['pm_users', `
    CREATE TABLE IF NOT EXISTS pm_users (
      user_id       SERIAL PRIMARY KEY,
      username      VARCHAR(100) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at    TIMESTAMP NOT NULL DEFAULT now()
    )`],
  ['pm_settings', `
    CREATE TABLE IF NOT EXISTS pm_settings (
      key   VARCHAR(50) PRIMARY KEY,
      value VARCHAR(200) NOT NULL
    )`],
  ['pm_settings defaults', `
    INSERT INTO pm_settings (key, value) VALUES
      ('monthly_fee', '250'), ('membership_fee', '100')
    ON CONFLICT (key) DO NOTHING`],

  ['pm_family_members', `
    CREATE TABLE IF NOT EXISTS pm_family_members (
      family_id     SERIAL PRIMARY KEY,
      member_id     VARCHAR(20) NOT NULL REFERENCES pm_members(member_id) ON DELETE CASCADE,
      name          VARCHAR(200) NOT NULL,
      relationship  VARCHAR(30) NOT NULL,
      is_dependent  BOOLEAN NOT NULL DEFAULT TRUE,
      status        VARCHAR(10) NOT NULL DEFAULT 'ALIVE' CHECK (status IN ('ALIVE','DECEASED')),
      deceased_date DATE,
      created_at    TIMESTAMP NOT NULL DEFAULT now()
    )`],
  ['pm_death_benefits', `
    CREATE TABLE IF NOT EXISTS pm_death_benefits (
      benefit_id     SERIAL PRIMARY KEY,
      member_id      VARCHAR(20) NOT NULL REFERENCES pm_members(member_id) ON DELETE RESTRICT,
      family_id      INTEGER REFERENCES pm_family_members(family_id) ON DELETE SET NULL,
      deceased_name  VARCHAR(200) NOT NULL,
      relationship   VARCHAR(30) NOT NULL,
      death_date     DATE NOT NULL,
      amount         NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
      paid_date      DATE NOT NULL,
      notes          VARCHAR(500),
      created_at     TIMESTAMP NOT NULL DEFAULT now()
    )`],

  ['pm_receipt_books', `
    CREATE TABLE IF NOT EXISTS pm_receipt_books (
      book_id    SERIAL PRIMARY KEY,
      officer_id INTEGER NOT NULL REFERENCES pm_officers(officer_id),
      start_no   INTEGER NOT NULL,
      end_no     INTEGER NOT NULL,
      next_no    INTEGER NOT NULL,
      issued_at  DATE NOT NULL DEFAULT CURRENT_DATE,
      CHECK (end_no >= start_no),
      CHECK (next_no >= start_no AND next_no <= end_no + 1)
    )`],
  ['pm_payments', `
    CREATE TABLE IF NOT EXISTS pm_payments (
      payment_id  SERIAL PRIMARY KEY,
      receipt_no  INTEGER NOT NULL UNIQUE,
      member_id   VARCHAR(20) NOT NULL REFERENCES pm_members(member_id),
      officer_id  INTEGER REFERENCES pm_officers(officer_id),
      paid_date   DATE NOT NULL,
      total       NUMERIC(12,2) NOT NULL,
      notes       VARCHAR(500),
      created_at  TIMESTAMP NOT NULL DEFAULT now()
    )`],
  ['pm_payment_items', `
    CREATE TABLE IF NOT EXISTS pm_payment_items (
      item_id    SERIAL PRIMARY KEY,
      payment_id INTEGER NOT NULL REFERENCES pm_payments(payment_id) ON DELETE CASCADE,
      member_id  VARCHAR(20) NOT NULL REFERENCES pm_members(member_id),
      item_type  VARCHAR(12) NOT NULL CHECK (item_type IN ('MEMBERSHIP','MONTHLY')),
      year       INTEGER NOT NULL,
      month      INTEGER NOT NULL DEFAULT 0 CHECK (month BETWEEN 0 AND 12),
      amount     NUMERIC(12,2) NOT NULL,
      UNIQUE (member_id, item_type, year, month)
    )`],

  ['pm_equipment', `
    CREATE TABLE IF NOT EXISTS pm_equipment (
      equipment_id  SERIAL PRIMARY KEY,
      name          VARCHAR(200) NOT NULL UNIQUE,
      total_qty     INTEGER NOT NULL CHECK (total_qty >= 0),
      member_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
      visitor_price NUMERIC(12,2) NOT NULL DEFAULT 0
    )`],
  ['pm_rentals', `
    CREATE TABLE IF NOT EXISTS pm_rentals (
      rental_id      SERIAL PRIMARY KEY,
      equipment_id   INTEGER NOT NULL REFERENCES pm_equipment(equipment_id),
      renter_type    VARCHAR(10) NOT NULL CHECK (renter_type IN ('MEMBER','VISITOR')),
      member_id      VARCHAR(20) REFERENCES pm_members(member_id),
      renter_name    VARCHAR(200) NOT NULL,
      qty            INTEGER NOT NULL CHECK (qty > 0),
      rent_date      DATE NOT NULL,
      days           INTEGER NOT NULL CHECK (days > 0),
      unit_price     NUMERIC(12,2) NOT NULL,
      amount         NUMERIC(12,2) NOT NULL,
      receipt_no     VARCHAR(30),
      returned_date  DATE,
      created_at     TIMESTAMP NOT NULL DEFAULT now()
    )`],

  ['pm_expenses', `
    CREATE TABLE IF NOT EXISTS pm_expenses (
      expense_id   SERIAL PRIMARY KEY,
      expense_date DATE NOT NULL,
      category     VARCHAR(50) NOT NULL,
      description  VARCHAR(300),
      amount       NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
      created_at   TIMESTAMP NOT NULL DEFAULT now()
    )`],

  // ---- hardening additions ----
  // Bumping token_version signs a user out everywhere (password change).
  ['pm_users.token_version', `ALTER TABLE pm_users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0`],
  ['pm_payments.recorded_by', `ALTER TABLE pm_payments ADD COLUMN IF NOT EXISTS recorded_by VARCHAR(100)`],
  // Fees in force from a given year onward, so changing a fee never rewrites past years.
  ['pm_fee_schedule', `
    CREATE TABLE IF NOT EXISTS pm_fee_schedule (
      year           INTEGER PRIMARY KEY,
      monthly_fee    NUMERIC(12,2) NOT NULL CHECK (monthly_fee > 0),
      membership_fee NUMERIC(12,2) NOT NULL CHECK (membership_fee >= 0),
      created_at     TIMESTAMP NOT NULL DEFAULT now()
    )`],
  // Who did what: every money-affecting action is recorded here.
  ['pm_audit_log', `
    CREATE TABLE IF NOT EXISTS pm_audit_log (
      audit_id  BIGSERIAL PRIMARY KEY,
      at        TIMESTAMP NOT NULL DEFAULT now(),
      user_id   INTEGER,
      username  VARCHAR(100),
      action    VARCHAR(60) NOT NULL,
      entity    VARCHAR(40) NOT NULL,
      entity_id VARCHAR(60),
      details   JSONB
    )`],
  ['pm_audit_log index', `CREATE INDEX IF NOT EXISTS pm_audit_log_at_idx ON pm_audit_log (at DESC)`],
  // Deleting a member must never silently erase death-benefit payouts.
  ['pm_death_benefits FK -> RESTRICT', `
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'pm_death_benefits_member_id_fkey' AND confdeltype = 'c') THEN
        ALTER TABLE pm_death_benefits DROP CONSTRAINT pm_death_benefits_member_id_fkey;
        ALTER TABLE pm_death_benefits ADD CONSTRAINT pm_death_benefits_member_id_fkey
          FOREIGN KEY (member_id) REFERENCES pm_members(member_id) ON DELETE RESTRICT;
      END IF;
    END $$`]
];

async function run() {
  await initPool();
  try {
    for (const [label, sql] of STATEMENTS) {
      await query(sql);
      console.log(`  [OK] ${label}`);
    }
    console.log('\nSchema setup complete.');
  } finally {
    await closePool();
  }
}

run().catch((err) => {
  console.error('Schema creation failed:', err);
  process.exit(1);
});

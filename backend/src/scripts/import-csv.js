require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { initPool, closePool, withTransaction } = require('../db/pool');

const CSV_PATH = path.join(__dirname, '..', '..', '..', 'UNION_Members.csv');

async function run() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

  await initPool();
  try {
    await withTransaction(async (db) => {
      const officerNames = [...new Set(
        records.map((r) => (r['Collecting Officer'] || '').trim()).filter((n) => n.length > 0)
      )];
      const officerIdByName = {};
      for (const name of officerNames) {
        const r = await db.query(
          `INSERT INTO pm_officers (officer_name) VALUES ($1)
           ON CONFLICT (officer_name) DO UPDATE SET officer_name = EXCLUDED.officer_name
           RETURNING officer_id`,
          [name]
        );
        officerIdByName[name] = r.rows[0].officer_id;
      }

      let imported = 0;
      let skipped = 0;
      for (const record of records) {
        const memberId = (record['Member ID'] || '').trim();
        const memberName = (record['Member Name'] || '').trim();
        const officerName = (record['Collecting Officer'] || '').trim();
        if (!memberId || !memberName) { skipped += 1; continue; }
        const r = await db.query(
          `INSERT INTO pm_members (member_id, member_name, officer_id) VALUES ($1, $2, $3)
           ON CONFLICT (member_id) DO NOTHING`,
          [memberId, memberName, officerIdByName[officerName] || null]
        );
        if (r.rowCount === 1) imported += 1; else skipped += 1;
      }
      console.log(`Officers created/matched: ${officerNames.length}`);
      console.log(`Members imported: ${imported}, skipped (duplicate or invalid): ${skipped}`);
    });
  } finally {
    await closePool();
  }
}

run().catch((err) => {
  console.error('CSV import failed:', err);
  process.exit(1);
});

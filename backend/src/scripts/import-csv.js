require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { initPool, closePool, getConnection } = require('../db/pool');

const CSV_PATH = path.join(__dirname, '..', '..', '..', 'UNION_Members.csv');

async function run() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

  await initPool();
  const conn = await getConnection();
  try {
    const officerNames = [...new Set(
      records
        .map((r) => (r['Collecting Officer'] || '').trim())
        .filter((name) => name.length > 0)
    )];

    const officerIdByName = {};
    for (const name of officerNames) {
      const existing = await conn.execute(
        `SELECT officer_id FROM officers WHERE officer_name = :n`,
        { n: name }
      );
      if (existing.rows.length > 0) {
        officerIdByName[name] = existing.rows[0].OFFICER_ID;
      } else {
        const inserted = await conn.execute(
          `INSERT INTO officers (officer_name) VALUES (:n) RETURNING officer_id INTO :id`,
          { n: name, id: { dir: require('oracledb').BIND_OUT, type: require('oracledb').NUMBER } }
        );
        officerIdByName[name] = inserted.outBinds.id[0];
      }
    }
    await conn.commit();

    let imported = 0;
    let skipped = 0;
    for (const record of records) {
      const memberId = Number(record['Member ID']);
      const memberName = (record['Member Name'] || '').trim();
      const officerName = (record['Collecting Officer'] || '').trim();
      if (!memberId || !memberName) {
        skipped += 1;
        continue;
      }

      const exists = await conn.execute(
        `SELECT member_id FROM members WHERE member_id = :id`,
        { id: memberId }
      );
      if (exists.rows.length > 0) {
        skipped += 1;
        continue;
      }

      await conn.execute(
        `INSERT INTO members (member_id, member_name, officer_id)
         VALUES (:memberId, :memberName, :officerId)`,
        {
          memberId,
          memberName,
          officerId: officerIdByName[officerName] || null
        }
      );
      imported += 1;
    }
    await conn.commit();

    console.log(`Officers created/matched: ${officerNames.length}`);
    console.log(`Members imported: ${imported}, skipped (duplicate or invalid): ${skipped}`);
  } finally {
    await conn.close();
    await closePool();
  }
}

run().catch((err) => {
  console.error('CSV import failed:', err);
  process.exit(1);
});

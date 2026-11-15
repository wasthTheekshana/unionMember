const express = require('express');
const { query, withTransaction } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { toMoney, toInt } = require('../lib/util');
const { getSettings } = require('../lib/fees');
const { audit } = require('../lib/audit');

const router = express.Router();
router.use(requireAuth);

// Fees for ?year= (default: this year) plus the schedule of past changes.
router.get('/', asyncHandler(async (req, res) => {
  const year = req.query.year ? toInt(req.query.year) : new Date().getFullYear();
  if (!(year >= 2000 && year <= 2100)) return res.status(400).json({ error: 'year is invalid' });
  const fees = await getSettings(undefined, year);
  const schedule = await query(
    `SELECT year, monthly_fee, membership_fee FROM pm_fee_schedule ORDER BY year`
  );
  res.json({
    ...fees,
    year,
    schedule: schedule.rows.map((s) => ({
      fromYear: s.year, monthlyFee: s.monthly_fee, membershipFee: s.membership_fee
    }))
  });
}));

// A fee change takes effect from `fromYear` (default: this year) onward.
// Earlier years keep the fees they had, so their paid/unpaid status never changes.
router.put('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const monthlyFee = toMoney(body.monthlyFee);
  const membershipFee = toMoney(body.membershipFee);
  const fromYear = body.fromYear === undefined || body.fromYear === '' ? new Date().getFullYear() : toInt(body.fromYear);
  if (Number.isNaN(monthlyFee) || monthlyFee <= 0) {
    return res.status(400).json({ error: 'monthlyFee must be a number > 0' });
  }
  if (Number.isNaN(membershipFee)) {
    return res.status(400).json({ error: 'membershipFee must be a number >= 0' });
  }
  if (!(fromYear >= 2000 && fromYear <= 2100)) {
    return res.status(400).json({ error: 'fromYear must be a year between 2000 and 2100' });
  }

  await withTransaction(async (db) => {
    const before = await getSettings(db, fromYear);
    const any = await db.query(`SELECT 1 FROM pm_fee_schedule LIMIT 1`);
    if (any.rows.length === 0) {
      // Pin the fees we have been using so far to all earlier years.
      const cur = await getSettings(db, 2000);
      await db.query(
        `INSERT INTO pm_fee_schedule (year, monthly_fee, membership_fee) VALUES (2000, $1, $2)
         ON CONFLICT (year) DO NOTHING`,
        [cur.monthlyFee, cur.membershipFee]
      );
    }
    await db.query(
      `INSERT INTO pm_fee_schedule (year, monthly_fee, membership_fee) VALUES ($1, $2, $3)
       ON CONFLICT (year) DO UPDATE SET monthly_fee = EXCLUDED.monthly_fee, membership_fee = EXCLUDED.membership_fee`,
      [fromYear, monthlyFee, membershipFee]
    );
    // Keep the legacy defaults in step with the newest schedule row.
    await db.query(
      `INSERT INTO pm_settings (key, value) VALUES ('monthly_fee', $1), ('membership_fee', $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(monthlyFee), String(membershipFee)]
    );
    await audit(db, req, 'update_fees', 'settings', fromYear, {
      fromYear,
      before,
      after: { monthlyFee, membershipFee }
    });
  });
  res.json({ ...(await getSettings(undefined, fromYear)), year: fromYear });
}));

module.exports = router;

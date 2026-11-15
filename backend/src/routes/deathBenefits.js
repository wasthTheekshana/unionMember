const express = require('express');
const { query, withTransaction } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { parseYear, toInt, cleanText } = require('../lib/util');
const { audit } = require('../lib/audit');

const router = express.Router();
router.use(requireAuth);

function toBenefit(d) {
  return {
    benefitId: d.benefit_id,
    memberId: d.member_id,
    memberName: d.member_name,
    officerName: d.officer_name,
    deceasedName: d.deceased_name,
    relationship: d.relationship,
    deathDate: d.death_date,
    paidDate: d.paid_date,
    amount: d.amount,
    notes: d.notes
  };
}

// All death-benefit payouts (what the samithiya gave to families), optional year / member filter.
router.get('/', asyncHandler(async (req, res) => {
  const year = parseYear(req.query.year, null);
  if (year === undefined) return res.status(400).json({ error: 'year is invalid' });
  const params = [];
  const conds = [];
  if (year) { params.push(year); conds.push(`EXTRACT(YEAR FROM d.paid_date) = $${params.length}`); }
  if (req.query.memberId) { params.push(String(req.query.memberId)); conds.push(`d.member_id = $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const r = await query(
    `SELECT d.*, m.member_name, m.officer_id, o.officer_name
     FROM pm_death_benefits d
     JOIN pm_members m ON m.member_id = d.member_id
     LEFT JOIN pm_officers o ON o.officer_id = m.officer_id
     ${where} ORDER BY d.paid_date DESC, d.benefit_id DESC LIMIT 500`,
    params
  );
  res.json(r.rows.map(toBenefit));
}));

// Reverse a death recorded by mistake: the person is marked alive/active again and
// the payout is removed. A reason is required and a copy is kept in the audit log.
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = toInt(req.params.id);
  const reason = cleanText((req.body || {}).reason, 300);
  if (reason.length < 3) {
    return res.status(400).json({ error: 'A reason (at least 3 characters) is required to reverse a death record' });
  }
  if (!(id > 0)) return res.status(404).json({ error: 'Death record not found' });

  const found = await withTransaction(async (db) => {
    const r = await db.query(`SELECT * FROM pm_death_benefits WHERE benefit_id = $1 FOR UPDATE`, [id]);
    if (r.rows.length === 0) return false;
    const b = r.rows[0];
    if (b.family_id) {
      await db.query(
        `UPDATE pm_family_members SET status = 'ALIVE', deceased_date = NULL WHERE family_id = $1`,
        [b.family_id]
      );
    } else if (b.relationship === 'SELF') {
      const other = await db.query(
        `SELECT 1 FROM pm_death_benefits WHERE member_id = $1 AND relationship = 'SELF' AND benefit_id <> $2`,
        [b.member_id, id]
      );
      if (other.rows.length === 0) {
        await db.query(`UPDATE pm_members SET is_active = TRUE, updated_at = now() WHERE member_id = $1`, [b.member_id]);
      }
    }
    await audit(db, req, 'reverse_death', 'death_benefit', id, { reason, benefit: b });
    await db.query(`DELETE FROM pm_death_benefits WHERE benefit_id = $1`, [id]);
    return true;
  });
  if (!found) return res.status(404).json({ error: 'Death record not found' });
  res.status(204).send();
}));

module.exports = router;

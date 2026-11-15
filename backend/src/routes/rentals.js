const express = require('express');
const { query, withTransaction } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { parseDate, today, toInt, cleanText } = require('../lib/util');
const { audit } = require('../lib/audit');

const router = express.Router();
router.use(requireAuth);

const SELECT = `
  SELECT r.*, e.name AS equipment_name
  FROM pm_rentals r JOIN pm_equipment e ON e.equipment_id = r.equipment_id`;

function toRental(row) {
  return {
    rentalId: row.rental_id,
    equipmentId: row.equipment_id,
    equipmentName: row.equipment_name,
    renterType: row.renter_type,
    memberId: row.member_id,
    renterName: row.renter_name,
    qty: row.qty,
    rentDate: row.rent_date,
    days: row.days,
    unitPrice: row.unit_price,
    amount: row.amount,
    receiptNo: row.receipt_no,
    returnedDate: row.returned_date,
    status: row.returned_date ? 'RETURNED' : 'OUT'
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const params = [];
  const conds = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };
  const status = (req.query.status || '').toUpperCase();
  if (status === 'OUT') conds.push('r.returned_date IS NULL');
  else if (status === 'RETURNED') conds.push('r.returned_date IS NOT NULL');
  else if (status) return res.status(400).json({ error: 'status must be OUT or RETURNED' });
  if (req.query.equipmentId) {
    const e = toInt(req.query.equipmentId);
    if (Number.isNaN(e)) return res.status(400).json({ error: 'equipmentId is invalid' });
    conds.push(`r.equipment_id = ${add(e)}`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const r = await query(`${SELECT} ${where} ORDER BY r.rent_date DESC, r.rental_id DESC LIMIT 500`, params);
  res.json(r.rows.map(toRental));
}));

// Issue equipment. Price comes from the equipment's current member / visitor
// price; amount = qty x days x price.
router.post('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const equipmentId = toInt(body.equipmentId);
  const qty = toInt(body.qty);
  const days = toInt(body.days);
  const renterType = String(body.renterType || '').toUpperCase();
  const rentDate = body.rentDate ? parseDate(body.rentDate) : today();
  if (!(equipmentId > 0)) return res.status(400).json({ error: 'equipmentId is required' });
  if (!(qty > 0 && qty <= 1000000)) return res.status(400).json({ error: 'qty must be a whole number > 0' });
  if (!(days > 0 && days <= 3650)) return res.status(400).json({ error: 'days must be a whole number > 0' });
  if (!['MEMBER', 'VISITOR'].includes(renterType)) {
    return res.status(400).json({ error: 'renterType must be MEMBER or VISITOR' });
  }
  if (rentDate === undefined) return res.status(400).json({ error: 'rentDate must be YYYY-MM-DD' });

  const out = await withTransaction(async (db) => {
    const eq = await db.query(`SELECT * FROM pm_equipment WHERE equipment_id = $1 FOR UPDATE`, [equipmentId]);
    if (eq.rows.length === 0) return { code: 404, error: 'Equipment not found' };

    let memberId = null;
    let renterName = cleanText(body.renterName, 200);
    if (renterType === 'MEMBER') {
      memberId = cleanText(String(body.memberId || ''), 20);
      const m = await db.query(`SELECT member_name FROM pm_members WHERE member_id = $1`, [memberId]);
      if (m.rows.length === 0) return { code: 400, error: 'Choose a valid member' };
      renterName = m.rows[0].member_name;
    } else if (!renterName) {
      return { code: 400, error: 'Visitor name is required' };
    }

    const outNow = await db.query(
      `SELECT COALESCE(SUM(qty), 0) AS n FROM pm_rentals WHERE equipment_id = $1 AND returned_date IS NULL`,
      [equipmentId]
    );
    const available = eq.rows[0].total_qty - outNow.rows[0].n;
    if (qty > available) {
      return { code: 400, error: `Only ${available} of ${eq.rows[0].name} available` };
    }

    const unitPrice = renterType === 'MEMBER' ? eq.rows[0].member_price : eq.rows[0].visitor_price;
    const amount = Math.round(qty * days * unitPrice * 100) / 100;
    const ins = await db.query(
      `INSERT INTO pm_rentals
         (equipment_id, renter_type, member_id, renter_name, qty, rent_date, days, unit_price, amount, receipt_no)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING rental_id`,
      [equipmentId, renterType, memberId, renterName, qty, rentDate, days, unitPrice, amount,
        cleanText(body.receiptNo, 30) || null]
    );
    const row = (await db.query(`${SELECT} WHERE r.rental_id = $1`, [ins.rows[0].rental_id])).rows[0];
    await audit(db, req, 'create_rental', 'rental', ins.rows[0].rental_id, {
      equipmentId, renterType, memberId, renterName, qty, days, unitPrice, amount, rentDate
    });
    return { code: 201, rental: toRental(row) };
  });
  if (out.error) return res.status(out.code).json({ error: out.error });
  res.status(201).json(out.rental);
}));

router.put('/:id/return', asyncHandler(async (req, res) => {
  const id = toInt(req.params.id);
  const returnedDate = req.body && req.body.returnedDate ? parseDate(req.body.returnedDate) : today();
  if (returnedDate === undefined) return res.status(400).json({ error: 'returnedDate must be YYYY-MM-DD' });
  const r = id > 0
    ? await query(
      `UPDATE pm_rentals SET returned_date = $1
       WHERE rental_id = $2 AND returned_date IS NULL AND $1::date >= rent_date RETURNING rental_id`,
      [returnedDate, id]
    )
    : { rows: [] };
  if (r.rows.length === 0) {
    return res.status(400).json({ error: 'Rental not found, already returned, or return date is before rent date' });
  }
  const row = (await query(`${SELECT} WHERE r.rental_id = $1`, [id])).rows[0];
  await audit(null, req, 'return_rental', 'rental', id, { returnedDate });
  res.json(toRental(row));
}));

// Void a rental entered by mistake. A reason is required and a copy is kept in the audit log.
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = toInt(req.params.id);
  const reason = cleanText((req.body || {}).reason, 300);
  if (reason.length < 3) {
    return res.status(400).json({ error: 'A reason (at least 3 characters) is required to void a rental' });
  }
  if (!(id > 0)) return res.status(404).json({ error: 'Rental not found' });
  const found = await withTransaction(async (db) => {
    const r = await db.query(`${SELECT} WHERE r.rental_id = $1 FOR UPDATE OF r`, [id]);
    if (r.rows.length === 0) return false;
    await audit(db, req, 'void_rental', 'rental', id, { reason, rental: toRental(r.rows[0]) });
    await db.query(`DELETE FROM pm_rentals WHERE rental_id = $1`, [id]);
    return true;
  });
  if (!found) return res.status(404).json({ error: 'Rental not found' });
  res.status(204).send();
}));

module.exports = router;

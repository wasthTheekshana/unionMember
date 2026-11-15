const express = require('express');
const { query, withTransaction, PG_UNIQUE_VIOLATION, PG_FK_VIOLATION } = require('../db/pool');
const { audit } = require('../lib/audit');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { toInt, toMoney, cleanText } = require('../lib/util');

const router = express.Router();
router.use(requireAuth);

const SELECT = `
  SELECT e.equipment_id, e.name, e.total_qty, e.member_price, e.visitor_price,
         COALESCE((SELECT SUM(r.qty) FROM pm_rentals r
                   WHERE r.equipment_id = e.equipment_id AND r.returned_date IS NULL), 0) AS rented_out
  FROM pm_equipment e`;

function toEquipment(row) {
  return {
    equipmentId: row.equipment_id,
    name: row.name,
    totalQty: row.total_qty,
    rentedOut: row.rented_out,
    available: row.total_qty - row.rented_out,
    memberPrice: row.member_price,
    visitorPrice: row.visitor_price
  };
}

function validate(body) {
  const name = cleanText(body.name, 200);
  const totalQty = toInt(body.totalQty);
  const memberPrice = toMoney(body.memberPrice);
  const visitorPrice = toMoney(body.visitorPrice);
  if (!name) return { error: 'name is required' };
  if (!(totalQty >= 0 && totalQty <= 1000000)) return { error: 'totalQty must be a whole number >= 0' };
  if (Number.isNaN(memberPrice)) return { error: 'memberPrice must be a number >= 0' };
  if (Number.isNaN(visitorPrice)) return { error: 'visitorPrice must be a number >= 0' };
  return { name, totalQty, memberPrice, visitorPrice };
}

router.get('/', asyncHandler(async (req, res) => {
  const r = await query(`${SELECT} ORDER BY e.name`);
  res.json(r.rows.map(toEquipment));
}));

router.post('/', asyncHandler(async (req, res) => {
  const v = validate(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    const r = await query(
      `INSERT INTO pm_equipment (name, total_qty, member_price, visitor_price)
       VALUES ($1, $2, $3, $4) RETURNING equipment_id`,
      [v.name, v.totalQty, v.memberPrice, v.visitorPrice]
    );
    const row = (await query(`${SELECT} WHERE e.equipment_id = $1`, [r.rows[0].equipment_id])).rows[0];
    res.status(201).json(toEquipment(row));
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      return res.status(400).json({ error: 'Equipment with this name already exists' });
    }
    throw err;
  }
}));

// Edit stock and prices (price changes apply to new rentals only).
router.put('/:id', asyncHandler(async (req, res) => {
  const id = toInt(req.params.id);
  const v = validate(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  if (!(id > 0)) return res.status(404).json({ error: 'Equipment not found' });
  try {
    // Lock the equipment row (rentals lock it too) so a rental cannot slip in
    // between the stock check and the update.
    const out = await withTransaction(async (db) => {
      await db.query(`SELECT 1 FROM pm_equipment WHERE equipment_id = $1 FOR UPDATE`, [id]);
      const cur = await db.query(`${SELECT} WHERE e.equipment_id = $1`, [id]);
      if (cur.rows.length === 0) return { code: 404, error: 'Equipment not found' };
      if (v.totalQty < cur.rows[0].rented_out) {
        return {
          code: 400,
          error: `${cur.rows[0].rented_out} are currently rented out; total cannot be lower than that`
        };
      }
      await db.query(
        `UPDATE pm_equipment SET name = $1, total_qty = $2, member_price = $3, visitor_price = $4
         WHERE equipment_id = $5`,
        [v.name, v.totalQty, v.memberPrice, v.visitorPrice, id]
      );
      await audit(db, req, 'update_equipment', 'equipment', id, {
        before: toEquipment(cur.rows[0]), after: v
      });
      const row = (await db.query(`${SELECT} WHERE e.equipment_id = $1`, [id])).rows[0];
      return { row };
    });
    if (out.error) return res.status(out.code).json({ error: out.error });
    res.json(toEquipment(out.row));
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      return res.status(400).json({ error: 'Equipment with this name already exists' });
    }
    throw err;
  }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = toInt(req.params.id);
  try {
    const r = id > 0 ? await query(`DELETE FROM pm_equipment WHERE equipment_id = $1 RETURNING *`, [id]) : { rowCount: 0 };
    if (r.rowCount === 0) return res.status(404).json({ error: 'Equipment not found' });
    await audit(null, req, 'delete_equipment', 'equipment', id, { name: r.rows[0].name, totalQty: r.rows[0].total_qty });
    res.status(204).send();
  } catch (err) {
    if (err.code === PG_FK_VIOLATION) {
      return res.status(400).json({ error: 'This equipment has rental history and cannot be deleted' });
    }
    throw err;
  }
}));

module.exports = router;

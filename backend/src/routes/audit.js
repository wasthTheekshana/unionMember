const express = require('express');
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { parseDate, toInt, cleanText } = require('../lib/util');

const router = express.Router();
router.use(requireAuth);

// Activity log, newest first. Filters: entity, action, from, to (YYYY-MM-DD), limit.
router.get('/', asyncHandler(async (req, res) => {
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);
  if (from === undefined || to === undefined) {
    return res.status(400).json({ error: 'from/to must be valid YYYY-MM-DD dates' });
  }
  const params = [];
  const conds = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };
  const entity = cleanText(req.query.entity, 40);
  const action = cleanText(req.query.action, 60);
  if (entity) conds.push(`entity = ${add(entity)}`);
  if (action) conds.push(`action = ${add(action)}`);
  if (from) conds.push(`at >= ${add(from)}::date`);
  if (to) conds.push(`at < ${add(to)}::date + INTERVAL '1 day'`);
  const limit = Math.min(Math.max(toInt(req.query.limit) || 200, 1), 1000);
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const r = await query(
    `SELECT audit_id, at, username, action, entity, entity_id, details
     FROM pm_audit_log ${where} ORDER BY audit_id DESC LIMIT ${limit}`,
    params
  );
  res.json(r.rows.map((x) => ({
    auditId: x.audit_id,
    at: x.at,
    username: x.username,
    action: x.action,
    entity: x.entity,
    entityId: x.entity_id,
    details: x.details
  })));
}));

module.exports = router;

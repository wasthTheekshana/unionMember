const express = require('express');
const { query, withTransaction, PG_UNIQUE_VIOLATION, PG_FK_VIOLATION } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { parseDate, parseYear, toInt, cleanText } = require('../lib/util');
const { getSettings, memberYearStatus, statusFor } = require('../lib/fees');
const { audit } = require('../lib/audit');

const router = express.Router();
router.use(requireAuth);

// Family ids in the URL must be plain numbers; anything else is simply "not found".
router.param('fid', (req, res, next, value) => {
  if (!/^\d{1,9}$/.test(value)) return res.status(404).json({ error: 'Family member not found' });
  return next();
});

const MEMBER_SELECT = `
  SELECT m.member_id, m.member_name, m.officer_id, o.officer_name,
         m.phone, m.email, m.address, m.is_active, m.updated_at
  FROM pm_members m
  LEFT JOIN pm_officers o ON o.officer_id = m.officer_id`;

function toMember(row) {
  return {
    memberId: row.member_id,
    memberName: row.member_name,
    officerId: row.officer_id,
    officerName: row.officer_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    isActive: row.is_active,
    updatedAt: row.updated_at
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const search = (req.query.search || '').trim();
  const dateFrom = parseDate(req.query.dateFrom);
  const dateTo = parseDate(req.query.dateTo);
  if (dateFrom === undefined || dateTo === undefined) {
    return res.status(400).json({ error: 'dateFrom/dateTo must be valid YYYY-MM-DD dates' });
  }
  const year = parseYear(req.query.year, new Date().getFullYear());
  if (year === undefined) return res.status(400).json({ error: 'year is invalid' });
  const statusFilter = (req.query.status || '').toUpperCase();
  if (statusFilter && !['PAID', 'PARTIAL', 'UNPAID'].includes(statusFilter)) {
    return res.status(400).json({ error: 'status must be PAID, PARTIAL or UNPAID' });
  }
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);
  const offset = (page - 1) * pageSize;

  // IDs look like "364" or "014A": a number with an optional trailing letter.
  const sort = (req.query.sort || 'name').toLowerCase();
  if (!['name', 'id_asc', 'id_desc'].includes(sort)) {
    return res.status(400).json({ error: 'sort must be name, id_asc or id_desc' });
  }
  const suffix = (req.query.suffix || '').trim();
  if (suffix && suffix.toLowerCase() !== 'none' && !/^[A-Za-z]{1,3}$/.test(suffix)) {
    return res.status(400).json({ error: 'suffix must be letters or "none"' });
  }

  const { monthlyFee, membershipFee } = await getSettings(undefined, year);
  const yearlyTotal = membershipFee + 12 * monthlyFee;

  const conditions = [];
  const params = [year];
  const add = (v) => { params.push(v); return `$${params.length}`; };

  if (search) {
    const p = add(`%${search.toLowerCase()}%`);
    conditions.push(`(LOWER(m.member_name) LIKE ${p} OR LOWER(m.member_id) LIKE ${p})`);
  }
  if (dateFrom) conditions.push(`m.updated_at >= ${add(dateFrom)}::date`);
  if (dateTo) conditions.push(`m.updated_at < ${add(dateTo)}::date + INTERVAL '1 day'`);
  if (req.query.officerId) {
    const oid = parseInt(req.query.officerId, 10);
    if (Number.isNaN(oid)) return res.status(400).json({ error: 'officerId is invalid' });
    conditions.push(`m.officer_id = ${add(oid)}`);
  }
  if (suffix) {
    if (suffix.toLowerCase() === 'none') conditions.push(`m.member_id ~ '^[0-9]+$'`);
    else conditions.push(`UPPER(substring(m.member_id from '[A-Za-z]+$')) = ${add(suffix.toUpperCase())}`);
  }
  if (statusFilter === 'PAID') conditions.push(`COALESCE(py.paid, 0) >= ${add(yearlyTotal)}`);
  if (statusFilter === 'PARTIAL') {
    conditions.push(`COALESCE(py.paid, 0) > 0 AND COALESCE(py.paid, 0) < ${add(yearlyTotal)}`);
  }
  if (statusFilter === 'UNPAID') conditions.push(`COALESCE(py.paid, 0) = 0`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const base = `
    FROM pm_members m
    LEFT JOIN pm_officers o ON o.officer_id = m.officer_id
    LEFT JOIN (SELECT member_id, SUM(amount) AS paid FROM pm_payment_items
               WHERE year = $1 GROUP BY member_id) py ON py.member_id = m.member_id
    ${where}`;

  // Natural ID order: by the number first, then the letter (so 12 < 100 < 100A).
  const idKey = `COALESCE(NULLIF(regexp_replace(m.member_id, '[^0-9]', '', 'g'), '')::numeric, 0)`;
  const orderBy = sort === 'id_asc' ? `${idKey} ASC, m.member_id ASC`
    : sort === 'id_desc' ? `${idKey} DESC, m.member_id DESC`
      : 'm.member_name';

  const total = (await query(`SELECT COUNT(*) AS total ${base}`, params)).rows[0].total;
  const list = await query(
    `SELECT m.member_id, m.member_name, m.officer_id, o.officer_name, m.phone, m.email,
            m.address, m.is_active, m.updated_at, COALESCE(py.paid, 0) AS paid
     ${base}
     ORDER BY ${orderBy}
     LIMIT ${add(pageSize)} OFFSET ${add(offset)}`,
    params
  );
  const suffixRows = await query(
    `SELECT UPPER(substring(member_id from '[A-Za-z]+$')) AS s FROM pm_members GROUP BY 1 ORDER BY 1 NULLS FIRST`
  );
  const idSuffixes = suffixRows.rows.map((r) => r.s || 'none');

  res.json({
    items: list.rows.map((r) => ({
      ...toMember(r),
      yearPaid: r.paid,
      yearDue: Math.max(yearlyTotal - r.paid, 0),
      yearStatus: statusFor(r.paid, yearlyTotal)
    })),
    total,
    page,
    pageSize,
    year,
    yearlyTotal,
    idSuffixes
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const year = parseYear(req.query.year, new Date().getFullYear());
  if (year === undefined) return res.status(400).json({ error: 'year is invalid' });
  const result = await query(`${MEMBER_SELECT} WHERE m.member_id = $1`, [req.params.id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Member not found' });
  }
  const member = toMember(result.rows[0]);
  member.yearStatus = await memberYearStatus(member.memberId, year);
  res.json(member);
}));

// Validates and cleans a member body. Every field must be the right type and
// within its column length, so bad input becomes a 400 and never a database error.
function cleanMember(body, { requireMemberId }) {
  const optional = (value, max, label) => {
    if (value === undefined || value === null || value === '') return { value: null };
    if (typeof value !== 'string') return { error: `${label} must be text` };
    const v = value.trim();
    if (v.length > max) return { error: `${label} must be ${max} characters or fewer` };
    return { value: v || null };
  };

  let memberId;
  if (requireMemberId) {
    const raw = typeof body.memberId === 'number' ? String(body.memberId) : body.memberId;
    if (typeof raw !== 'string' || !raw.trim()) return { error: 'memberId is required' };
    memberId = raw.trim();
    if (memberId.length > 20) return { error: 'memberId must be 20 characters or fewer' };
    if (!/^[A-Za-z0-9._\-/]+$/.test(memberId)) {
      return { error: 'memberId may only contain letters, numbers and . _ - /' };
    }
  }
  if (typeof body.memberName !== 'string' || !body.memberName.trim()) {
    return { error: 'memberName is required' };
  }
  const memberName = body.memberName.trim();
  if (memberName.length > 200) return { error: 'memberName must be 200 characters or fewer' };

  const phone = optional(body.phone, 50, 'phone');
  const email = optional(body.email, 200, 'email');
  const address = optional(body.address, 500, 'address');
  for (const f of [phone, email, address]) if (f.error) return { error: f.error };
  if (email.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
    return { error: 'email is not a valid email address' };
  }

  let officerId = null;
  if (body.officerId !== undefined && body.officerId !== null && body.officerId !== '') {
    officerId = toInt(body.officerId);
    if (!(officerId > 0)) return { error: 'officerId is invalid' };
  }
  return {
    memberId,
    memberName,
    phone: phone.value,
    email: email.value,
    address: address.value,
    officerId,
    isActive: typeof body.isActive === 'boolean' ? body.isActive : null
  };
}

async function officerExists(officerId) {
  if (!officerId) return true;
  const r = await query(`SELECT 1 FROM pm_officers WHERE officer_id = $1`, [officerId]);
  return r.rows.length > 0;
}

router.post('/', asyncHandler(async (req, res) => {
  const m = cleanMember(req.body || {}, { requireMemberId: true });
  if (m.error) return res.status(400).json({ error: m.error });

  if (!(await officerExists(m.officerId))) {
    return res.status(400).json({ error: 'officerId does not reference an existing officer' });
  }
  const memberId = m.memberId;
  try {
    await query(
      `INSERT INTO pm_members (member_id, member_name, officer_id, phone, email, address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [memberId, m.memberName, m.officerId, m.phone, m.email, m.address]
    );
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      return res.status(400).json({ error: 'memberId already exists' });
    }
    throw err;
  }
  const created = await query(`${MEMBER_SELECT} WHERE m.member_id = $1`, [memberId]);
  res.status(201).json(toMember(created.rows[0]));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const m = cleanMember(req.body || {}, { requireMemberId: false });
  if (m.error) return res.status(400).json({ error: m.error });

  if (!(await officerExists(m.officerId))) {
    return res.status(400).json({ error: 'officerId does not reference an existing officer' });
  }
  const result = await query(
    `UPDATE pm_members
     SET member_name = $1, officer_id = $2, phone = $3, email = $4, address = $5,
         is_active = COALESCE($6, is_active), updated_at = now()
     WHERE member_id = $7`,
    [m.memberName, m.officerId, m.phone, m.email, m.address, m.isActive, req.params.id]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Member not found' });
  }
  const updated = await query(`${MEMBER_SELECT} WHERE m.member_id = $1`, [req.params.id]);
  res.json(toMember(updated.rows[0]));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  try {
    const found = await withTransaction(async (db) => {
      const snap = await db.query(`${MEMBER_SELECT} WHERE m.member_id = $1`, [req.params.id]);
      if (snap.rows.length === 0) return false;
      await audit(db, req, 'delete_member', 'member', req.params.id, { member: toMember(snap.rows[0]) });
      await db.query(`DELETE FROM pm_members WHERE member_id = $1`, [req.params.id]);
      return true;
    });
    if (!found) return res.status(404).json({ error: 'Member not found' });
    res.status(204).send();
  } catch (err) {
    if (err.code === PG_FK_VIOLATION) {
      return res.status(400).json({
        error: 'Member has payments, rentals or death-benefit records and cannot be deleted. Mark them inactive instead.'
      });
    }
    throw err;
  }
}));

// ---------------- Family members ----------------

const RELATIONSHIPS = ['SPOUSE', 'CHILD', 'PARENT', 'OTHER'];

function toFamily(row) {
  return {
    familyId: row.family_id,
    memberId: row.member_id,
    name: row.name,
    relationship: row.relationship,
    isDependent: row.is_dependent,
    status: row.status,
    deceasedDate: row.deceased_date
  };
}

function validateFamily(body) {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
  if (!name) return { error: 'name is required' };
  const relationship = String(body.relationship || '').toUpperCase();
  if (!RELATIONSHIPS.includes(relationship)) {
    return { error: `relationship must be one of ${RELATIONSHIPS.join(', ')}` };
  }
  return { name, relationship, isDependent: body.isDependent !== false };
}

async function memberExists(id) {
  const r = await query(`SELECT 1 FROM pm_members WHERE member_id = $1`, [id]);
  return r.rows.length > 0;
}

router.get('/:id/family', asyncHandler(async (req, res) => {
  if (!(await memberExists(req.params.id))) {
    return res.status(404).json({ error: 'Member not found' });
  }
  const r = await query(
    `SELECT * FROM pm_family_members WHERE member_id = $1 ORDER BY family_id`,
    [req.params.id]
  );
  res.json(r.rows.map(toFamily));
}));

router.post('/:id/family', asyncHandler(async (req, res) => {
  const v = validateFamily(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  if (!(await memberExists(req.params.id))) {
    return res.status(404).json({ error: 'Member not found' });
  }
  const r = await query(
    `INSERT INTO pm_family_members (member_id, name, relationship, is_dependent)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.params.id, v.name, v.relationship, v.isDependent]
  );
  res.status(201).json(toFamily(r.rows[0]));
}));

router.put('/:id/family/:fid', asyncHandler(async (req, res) => {
  const v = validateFamily(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  const r = await query(
    `UPDATE pm_family_members SET name = $1, relationship = $2, is_dependent = $3
     WHERE family_id = $4 AND member_id = $5 RETURNING *`,
    [v.name, v.relationship, v.isDependent, req.params.fid, req.params.id]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Family member not found' });
  res.json(toFamily(r.rows[0]));
}));

router.delete('/:id/family/:fid', asyncHandler(async (req, res) => {
  const r = await query(
    `DELETE FROM pm_family_members WHERE family_id = $1 AND member_id = $2`,
    [req.params.fid, req.params.id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'Family member not found' });
  res.status(204).send();
}));

// ---------------- Deaths & benefit payouts ----------------

function validateDeath(body) {
  const deathDate = parseDate(body.deathDate);
  const paidDate = parseDate(body.paidDate) || deathDate;
  const amount = Number(body.amount);
  if (!deathDate) return { error: 'deathDate is required (YYYY-MM-DD)' };
  if (paidDate === undefined) return { error: 'paidDate must be YYYY-MM-DD' };
  if (!Number.isFinite(amount) || amount < 0) return { error: 'amount must be a number >= 0' };
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : null;
  return { deathDate, paidDate, amount: Math.round(amount * 100) / 100, notes: notes || null };
}

// A family member passed away: mark them deceased and record what was given.
router.post('/:id/family/:fid/death', asyncHandler(async (req, res) => {
  const v = validateDeath(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });

  const outcome = await withTransaction(async (db) => {
    const f = await db.query(
      `SELECT * FROM pm_family_members WHERE family_id = $1 AND member_id = $2 FOR UPDATE`,
      [req.params.fid, req.params.id]
    );
    if (f.rows.length === 0) return { code: 404, error: 'Family member not found' };
    if (f.rows[0].status === 'DECEASED') {
      return { code: 400, error: 'This family member is already marked deceased' };
    }
    await db.query(
      `UPDATE pm_family_members SET status = 'DECEASED', deceased_date = $1 WHERE family_id = $2`,
      [v.deathDate, req.params.fid]
    );
    const b = await db.query(
      `INSERT INTO pm_death_benefits
         (member_id, family_id, deceased_name, relationship, death_date, amount, paid_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING benefit_id`,
      [req.params.id, req.params.fid, f.rows[0].name, f.rows[0].relationship,
        v.deathDate, v.amount, v.paidDate, v.notes]
    );
    await audit(db, req, 'record_death', 'death_benefit', b.rows[0].benefit_id, {
      memberId: req.params.id, familyId: req.params.fid, deceased: f.rows[0].name,
      relationship: f.rows[0].relationship, deathDate: v.deathDate, amount: v.amount, paidDate: v.paidDate
    });
    return { code: 201, benefitId: b.rows[0].benefit_id };
  });
  if (outcome.error) return res.status(outcome.code).json({ error: outcome.error });
  res.status(201).json({ benefitId: outcome.benefitId });
}));

// The member themself passed away: mark inactive and record the payout.
router.post('/:id/death', asyncHandler(async (req, res) => {
  const v = validateDeath(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });

  const outcome = await withTransaction(async (db) => {
    const m = await db.query(
      `SELECT member_name, is_active FROM pm_members WHERE member_id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (m.rows.length === 0) return { code: 404, error: 'Member not found' };
    if (!m.rows[0].is_active) return { code: 400, error: 'Member is already inactive' };
    await db.query(
      `UPDATE pm_members SET is_active = FALSE, updated_at = now() WHERE member_id = $1`,
      [req.params.id]
    );
    const b = await db.query(
      `INSERT INTO pm_death_benefits
         (member_id, family_id, deceased_name, relationship, death_date, amount, paid_date, notes)
       VALUES ($1, NULL, $2, 'SELF', $3, $4, $5, $6) RETURNING benefit_id`,
      [req.params.id, m.rows[0].member_name, v.deathDate, v.amount, v.paidDate, v.notes]
    );
    await audit(db, req, 'record_death', 'death_benefit', b.rows[0].benefit_id, {
      memberId: req.params.id, deceased: m.rows[0].member_name, relationship: 'SELF',
      deathDate: v.deathDate, amount: v.amount, paidDate: v.paidDate
    });
    return { code: 201, benefitId: b.rows[0].benefit_id };
  });
  if (outcome.error) return res.status(outcome.code).json({ error: outcome.error });
  res.status(201).json({ benefitId: outcome.benefitId });
}));

module.exports = router;

const express = require('express');
const { getConnection } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requireAuth);

function toMember(row) {
  return {
    memberId: row.MEMBER_ID,
    memberName: row.MEMBER_NAME,
    officerId: row.OFFICER_ID,
    officerName: row.OFFICER_NAME,
    phone: row.PHONE,
    email: row.EMAIL,
    address: row.ADDRESS
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const search = (req.query.search || '').trim();
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);
  const offset = (page - 1) * pageSize;

  const conn = await getConnection();
  try {
    const whereClause = search ? `WHERE LOWER(m.member_name) LIKE :search` : '';
    const binds = search ? { search: `%${search.toLowerCase()}%` } : {};

    const countResult = await conn.execute(
      `SELECT COUNT(*) AS total FROM members m ${whereClause}`,
      binds
    );
    const total = countResult.rows[0].TOTAL;

    const listResult = await conn.execute(
      `SELECT m.member_id, m.member_name, m.officer_id, o.officer_name,
              m.phone, m.email, m.address
       FROM members m
       LEFT JOIN officers o ON o.officer_id = m.officer_id
       ${whereClause}
       ORDER BY m.member_name
       OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
      { ...binds, offset, pageSize }
    );

    res.json({
      items: listResult.rows.map(toMember),
      total,
      page,
      pageSize
    });
  } finally {
    await conn.close();
  }
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ error: 'id is required' });
  }
  const conn = await getConnection();
  try {
    const result = await conn.execute(
      `SELECT m.member_id, m.member_name, m.officer_id, o.officer_name,
              m.phone, m.email, m.address
       FROM members m
       LEFT JOIN officers o ON o.officer_id = m.officer_id
       WHERE m.member_id = :id`,
      { id }
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    res.json(toMember(result.rows[0]));
  } finally {
    await conn.close();
  }
}));

function validateBody(body, { requireMemberId }) {
  if (requireMemberId && (!body.memberId || !String(body.memberId).trim())) {
    return 'memberId is required';
  }
  if (!body.memberName || !body.memberName.trim()) {
    return 'memberName is required';
  }
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return 'email is not a valid email address';
  }
  return null;
}

router.post('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const error = validateBody(body, { requireMemberId: true });
  if (error) return res.status(400).json({ error });

  const conn = await getConnection();
  try {
    if (body.officerId) {
      const officerCheck = await conn.execute(
        `SELECT officer_id FROM officers WHERE officer_id = :officerId`,
        { officerId: body.officerId }
      );
      if (officerCheck.rows.length === 0) {
        return res.status(400).json({ error: 'officerId does not reference an existing officer' });
      }
    }

    await conn.execute(
      `INSERT INTO members (member_id, member_name, officer_id, phone, email, address)
       VALUES (:memberId, :memberName, :officerId, :phone, :email, :address)`,
      {
        memberId: body.memberId,
        memberName: body.memberName,
        officerId: body.officerId || null,
        phone: body.phone || null,
        email: body.email || null,
        address: body.address || null
      }
    );
    await conn.commit();

    const created = await conn.execute(
      `SELECT m.member_id, m.member_name, m.officer_id, o.officer_name,
              m.phone, m.email, m.address
       FROM members m
       LEFT JOIN officers o ON o.officer_id = m.officer_id
       WHERE m.member_id = :id`,
      { id: body.memberId }
    );
    res.status(201).json(toMember(created.rows[0]));
  } catch (err) {
    if (err.errorNum === 1) {
      return res.status(400).json({ error: 'memberId already exists' });
    }
    throw err;
  } finally {
    await conn.close();
  }
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ error: 'id is required' });
  }
  const body = req.body || {};
  const error = validateBody(body, { requireMemberId: false });
  if (error) return res.status(400).json({ error });

  const conn = await getConnection();
  try {
    if (body.officerId) {
      const officerCheck = await conn.execute(
        `SELECT officer_id FROM officers WHERE officer_id = :officerId`,
        { officerId: body.officerId }
      );
      if (officerCheck.rows.length === 0) {
        return res.status(400).json({ error: 'officerId does not reference an existing officer' });
      }
    }

    const result = await conn.execute(
      `UPDATE members
       SET member_name = :memberName,
           officer_id = :officerId,
           phone = :phone,
           email = :email,
           address = :address,
           updated_at = SYSTIMESTAMP
       WHERE member_id = :id`,
      {
        memberName: body.memberName,
        officerId: body.officerId || null,
        phone: body.phone || null,
        email: body.email || null,
        address: body.address || null,
        id
      }
    );
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    await conn.commit();

    const updated = await conn.execute(
      `SELECT m.member_id, m.member_name, m.officer_id, o.officer_name,
              m.phone, m.email, m.address
       FROM members m
       LEFT JOIN officers o ON o.officer_id = m.officer_id
       WHERE m.member_id = :id`,
      { id }
    );
    res.json(toMember(updated.rows[0]));
  } finally {
    await conn.close();
  }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ error: 'id is required' });
  }
  const conn = await getConnection();
  try {
    const result = await conn.execute(`DELETE FROM members WHERE member_id = :id`, { id });
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    await conn.commit();
    res.status(204).send();
  } finally {
    await conn.close();
  }
}));

module.exports = router;

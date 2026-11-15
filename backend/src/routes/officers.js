const express = require('express');
const { query, withTransaction, PG_UNIQUE_VIOLATION } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { parseDate, toInt } = require('../lib/util');
const { audit } = require('../lib/audit');

const router = express.Router();
router.use(requireAuth);

function toOfficer(row) {
  return {
    officerId: row.officer_id,
    officerName: row.officer_name,
    memberCount: row.member_count,
    receiptsRemaining: row.receipts_remaining,
    collectedTotal: row.collected_total
  };
}

function cleanName(body) {
  const name = body && typeof body.officerName === 'string' ? body.officerName.trim() : '';
  return name.slice(0, 200);
}

router.get('/', asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT o.officer_id, o.officer_name,
            (SELECT COUNT(*) FROM pm_members m WHERE m.officer_id = o.officer_id) AS member_count,
            (SELECT COALESCE(SUM(b.end_no - b.next_no + 1), 0) FROM pm_receipt_books b
              WHERE b.officer_id = o.officer_id) AS receipts_remaining,
            (SELECT COALESCE(SUM(p.total), 0) FROM pm_payments p
              WHERE p.officer_id = o.officer_id) AS collected_total
     FROM pm_officers o
     ORDER BY o.officer_name`
  );
  res.json(result.rows.map(toOfficer));
}));

router.post('/', asyncHandler(async (req, res) => {
  const officerName = cleanName(req.body);
  if (!officerName) {
    return res.status(400).json({ error: 'officerName is required' });
  }
  try {
    const result = await query(
      `INSERT INTO pm_officers (officer_name) VALUES ($1) RETURNING officer_id`,
      [officerName]
    );
    res.status(201).json({
      officerId: result.rows[0].officer_id,
      officerName,
      memberCount: 0
    });
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      return res.status(400).json({ error: 'An officer with this name already exists' });
    }
    throw err;
  }
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const officerName = cleanName(req.body);
  if (!officerName) {
    return res.status(400).json({ error: 'officerName is required' });
  }
  const id = toInt(req.params.id);
  if (!(id > 0)) return res.status(404).json({ error: 'Officer not found' });
  try {
    const result = await query(
      `UPDATE pm_officers SET officer_name = $1 WHERE officer_id = $2`,
      [officerName, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Officer not found' });
    }
    res.json({ officerId: id, officerName });
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      return res.status(400).json({ error: 'An officer with this name already exists' });
    }
    throw err;
  }
}));

// ---------------- Receipt books (e.g. 1000-1100) ----------------

function toBook(row) {
  return {
    bookId: row.book_id,
    officerId: row.officer_id,
    startNo: row.start_no,
    endNo: row.end_no,
    nextNo: row.next_no,
    used: row.next_no - row.start_no,
    remaining: row.end_no - row.next_no + 1,
    issuedAt: row.issued_at
  };
}

router.get('/:id/books', asyncHandler(async (req, res) => {
  const id = toInt(req.params.id);
  if (!(id > 0)) return res.json([]);
  const r = await query(
    `SELECT * FROM pm_receipt_books WHERE officer_id = $1 ORDER BY start_no`,
    [id]
  );
  res.json(r.rows.map(toBook));
}));

router.post('/:id/books', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const officerId = toInt(req.params.id);
  const startNo = toInt(body.startNo);
  const endNo = toInt(body.endNo);
  const issuedAt = parseDate(body.issuedAt);
  if (!(startNo > 0) || !(endNo >= startNo) || endNo > 2000000000) {
    return res.status(400).json({ error: 'startNo and endNo must be positive integers with endNo >= startNo' });
  }
  if (issuedAt === undefined) return res.status(400).json({ error: 'issuedAt must be YYYY-MM-DD' });
  if (!(officerId > 0)) return res.status(404).json({ error: 'Officer not found' });

  const out = await withTransaction(async (db) => {
    const o = await db.query(`SELECT 1 FROM pm_officers WHERE officer_id = $1`, [officerId]);
    if (o.rows.length === 0) return { code: 404, error: 'Officer not found' };
    // Receipt numbers must be unique across the whole samithiya.
    await db.query(`LOCK TABLE pm_receipt_books IN SHARE ROW EXCLUSIVE MODE`);
    const overlap = await db.query(
      `SELECT b.start_no, b.end_no, o.officer_name
       FROM pm_receipt_books b JOIN pm_officers o ON o.officer_id = b.officer_id
       WHERE b.start_no <= $2 AND b.end_no >= $1 LIMIT 1`,
      [startNo, endNo]
    );
    if (overlap.rows.length > 0) {
      const x = overlap.rows[0];
      return {
        code: 400,
        error: `Range overlaps ${x.officer_name}'s book (${x.start_no}-${x.end_no})`
      };
    }
    const ins = await db.query(
      `INSERT INTO pm_receipt_books (officer_id, start_no, end_no, next_no, issued_at)
       VALUES ($1, $2, $3, $2, COALESCE($4::date, CURRENT_DATE)) RETURNING *`,
      [officerId, startNo, endNo, issuedAt]
    );
    await audit(db, req, 'create_receipt_book', 'receipt_book', ins.rows[0].book_id, {
      officerId, startNo, endNo
    });
    return { code: 201, book: toBook(ins.rows[0]) };
  });
  if (out.error) return res.status(out.code).json({ error: out.error });
  res.status(201).json(out.book);
}));

router.delete('/:id/books/:bookId', asyncHandler(async (req, res) => {
  const officerId = toInt(req.params.id);
  const bookId = toInt(req.params.bookId);
  if (!(officerId > 0) || !(bookId > 0)) return res.status(404).json({ error: 'Book not found' });
  const used = await query(
    `SELECT 1 FROM pm_payments p JOIN pm_receipt_books b
       ON p.receipt_no BETWEEN b.start_no AND b.end_no
     WHERE b.book_id = $1 AND b.officer_id = $2 LIMIT 1`,
    [bookId, officerId]
  );
  if (used.rows.length > 0) {
    return res.status(400).json({ error: 'This book already has receipts issued and cannot be deleted' });
  }
  const r = await query(
    `DELETE FROM pm_receipt_books WHERE book_id = $1 AND officer_id = $2`,
    [bookId, officerId]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'Book not found' });
  await audit(null, req, 'delete_receipt_book', 'receipt_book', bookId, { officerId });
  res.status(204).send();
}));

// What this officer has collected (receipts issued), optional date range.
router.get('/:id/collections', asyncHandler(async (req, res) => {
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);
  if (from === undefined || to === undefined) {
    return res.status(400).json({ error: 'from/to must be valid YYYY-MM-DD dates' });
  }
  const id = toInt(req.params.id);
  if (!(id > 0)) return res.status(404).json({ error: 'Officer not found' });
  const o = await query(`SELECT officer_id, officer_name FROM pm_officers WHERE officer_id = $1`, [id]);
  if (o.rows.length === 0) return res.status(404).json({ error: 'Officer not found' });

  const params = [id];
  let where = 'p.officer_id = $1';
  if (from) { params.push(from); where += ` AND p.paid_date >= $${params.length}::date`; }
  if (to) { params.push(to); where += ` AND p.paid_date <= $${params.length}::date`; }

  const r = await query(
    `SELECT p.payment_id, p.receipt_no, p.paid_date, p.total, p.member_id, m.member_name
     FROM pm_payments p JOIN pm_members m ON m.member_id = p.member_id
     WHERE ${where} ORDER BY p.receipt_no`,
    params
  );
  const books = await query(
    `SELECT * FROM pm_receipt_books WHERE officer_id = $1 ORDER BY start_no`,
    [id]
  );
  res.json({
    officerId: o.rows[0].officer_id,
    officerName: o.rows[0].officer_name,
    receiptCount: r.rows.length,
    total: r.rows.reduce((s, x) => s + x.total, 0),
    books: books.rows.map(toBook),
    receipts: r.rows.map((x) => ({
      paymentId: x.payment_id,
      receiptNo: x.receipt_no,
      paidDate: x.paid_date,
      total: x.total,
      memberId: x.member_id,
      memberName: x.member_name
    }))
  });
}));

module.exports = router;

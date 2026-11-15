const express = require('express');
const { query, withTransaction } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { parseDate, today, toInt, cleanText } = require('../lib/util');
const { getSettings } = require('../lib/fees');
const { audit } = require('../lib/audit');

const router = express.Router();
router.use(requireAuth);

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// All payment writes take this lock first, so two people recording payments at
// the same moment queue up instead of racing for receipt numbers or months.
const PAYMENT_LOCK = 7001;

function toPayment(row, items) {
  return {
    paymentId: row.payment_id,
    receiptNo: row.receipt_no,
    memberId: row.member_id,
    memberName: row.member_name,
    officerId: row.officer_id,
    officerName: row.officer_name,
    paidDate: row.paid_date,
    total: row.total,
    notes: row.notes,
    recordedBy: row.recorded_by,
    items: items.map((i) => ({
      itemType: i.item_type,
      year: i.year,
      month: i.month,
      label: i.item_type === 'MEMBERSHIP' ? `${i.year} Membership` : `${MONTH_NAMES[i.month]} ${i.year}`,
      amount: i.amount
    }))
  };
}

const PAYMENT_SELECT = `
  SELECT p.*, m.member_name, o.officer_name
  FROM pm_payments p
  JOIN pm_members m ON m.member_id = p.member_id
  LEFT JOIN pm_officers o ON o.officer_id = p.officer_id`;

async function loadItems(db, paymentIds) {
  if (paymentIds.length === 0) return {};
  const r = await db.query(
    `SELECT * FROM pm_payment_items WHERE payment_id = ANY($1) ORDER BY year, item_type, month`,
    [paymentIds]
  );
  const map = {};
  for (const i of r.rows) (map[i.payment_id] = map[i.payment_id] || []).push(i);
  return map;
}

// Take the next free number from one of the officer's books. Numbers that were
// already used by hand (written ahead of the sequence) are skipped, not reissued.
async function takeNextReceipt(db, officerId) {
  for (let i = 0; i < 1000; i += 1) {
    const r = await db.query(
      `UPDATE pm_receipt_books SET next_no = next_no + 1
       WHERE book_id = (
         SELECT book_id FROM pm_receipt_books
         WHERE officer_id = $1 AND next_no <= end_no
         ORDER BY start_no LIMIT 1 FOR UPDATE)
       RETURNING next_no - 1 AS receipt_no`,
      [officerId]
    );
    if (r.rows.length === 0) return null;
    const no = r.rows[0].receipt_no;
    const used = await db.query(`SELECT 1 FROM pm_payments WHERE receipt_no = $1`, [no]);
    if (used.rows.length === 0) return no;
  }
  return null;
}

// Use a manually typed receipt number: must sit inside one of this officer's books.
// The book's counter only moves when the number is the very next one, so typing a
// number further ahead never burns the numbers in between.
async function claimManualReceipt(db, officerId, receiptNo) {
  const book = await db.query(
    `SELECT book_id, next_no FROM pm_receipt_books
     WHERE officer_id = $1 AND $2 BETWEEN start_no AND end_no FOR UPDATE`,
    [officerId, receiptNo]
  );
  if (book.rows.length === 0) return false;
  if (receiptNo === book.rows[0].next_no) {
    await db.query(`UPDATE pm_receipt_books SET next_no = next_no + 1 WHERE book_id = $1`,
      [book.rows[0].book_id]);
  }
  return true;
}

// Preview the receipt number that will be used next for an officer.
router.get('/next-receipt', asyncHandler(async (req, res) => {
  const officerId = toInt(req.query.officerId);
  if (!(officerId > 0)) return res.status(400).json({ error: 'officerId is required' });
  const r = await query(
    `SELECT b.next_no, b.end_no FROM pm_receipt_books b
     WHERE b.officer_id = $1 AND b.next_no <= b.end_no ORDER BY b.start_no LIMIT 1`,
    [officerId]
  );
  let next = r.rows.length ? r.rows[0].next_no : null;
  // Skip numbers already used by hand so the preview matches what will be issued.
  while (next !== null && next <= r.rows[0].end_no) {
    const used = await query(`SELECT 1 FROM pm_payments WHERE receipt_no = $1`, [next]);
    if (used.rows.length === 0) break;
    next += 1;
  }
  if (next !== null && next > r.rows[0].end_no) next = null;
  res.json({ nextReceiptNo: next });
}));

router.post('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const year = toInt(body.year);
  if (!(year >= 2000 && year <= 2100)) return res.status(400).json({ error: 'year is required' });
  const months = Array.isArray(body.months) ? body.months.map(toInt) : [];
  if (months.some((m) => !(m >= 1 && m <= 12)) || new Set(months).size !== months.length) {
    return res.status(400).json({ error: 'months must be unique numbers between 1 and 12' });
  }
  const membership = body.membership === true;
  if (!membership && months.length === 0) {
    return res.status(400).json({ error: 'Select the membership fee and/or at least one month' });
  }
  const paidDate = body.paidDate ? parseDate(body.paidDate) : today();
  if (paidDate === undefined) return res.status(400).json({ error: 'paidDate must be YYYY-MM-DD' });
  const manualNo = body.receiptNo === undefined || body.receiptNo === null || body.receiptNo === ''
    ? null : toInt(body.receiptNo);
  if (manualNo !== null && !(manualNo > 0 && manualNo <= 2000000000)) {
    return res.status(400).json({ error: 'receiptNo must be a positive whole number' });
  }
  const memberId = cleanText(String(body.memberId || ''), 20);
  if (!memberId) return res.status(400).json({ error: 'memberId is required' });

  const out = await withTransaction(async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock($1)`, [PAYMENT_LOCK]);

    const m = await db.query(
      `SELECT member_id, officer_id, is_active FROM pm_members WHERE member_id = $1`, [memberId]);
    if (m.rows.length === 0) return { code: 404, error: 'Member not found' };
    if (!m.rows[0].is_active) {
      return { code: 400, error: 'This member is inactive (passed away or left). Mark them active before recording a payment.' };
    }
    const officerId = body.officerId ? toInt(body.officerId) : m.rows[0].officer_id;
    if (!(officerId > 0)) {
      return { code: 400, error: 'No collecting officer — choose one for this payment' };
    }
    const off = await db.query(`SELECT 1 FROM pm_officers WHERE officer_id = $1`, [officerId]);
    if (off.rows.length === 0) return { code: 400, error: 'officerId does not reference an existing officer' };

    // Fees in force for the year being paid for.
    const settings = await getSettings(db, year);
    const items = [];
    if (membership) {
      items.push({ type: 'MEMBERSHIP', month: 0, amount: settings.membershipFee });
    }
    for (const mo of [...months].sort((a, b) => a - b)) {
      items.push({ type: 'MONTHLY', month: mo, amount: settings.monthlyFee });
    }

    // Reject anything already paid, naming it.
    const dup = await db.query(
      `SELECT item_type, month FROM pm_payment_items
       WHERE member_id = $1 AND year = $2
         AND ((item_type = 'MEMBERSHIP' AND $3::boolean) OR (item_type = 'MONTHLY' AND month = ANY($4::int[])))`,
      [memberId, year, membership, months]
    );
    if (dup.rows.length > 0) {
      const names = dup.rows.map((d) => (d.item_type === 'MEMBERSHIP' ? 'Membership' : MONTH_NAMES[d.month]));
      return { code: 400, error: `Already paid for ${year}: ${names.join(', ')}` };
    }

    let receiptNo;
    if (manualNo !== null) {
      const used = await db.query(`SELECT 1 FROM pm_payments WHERE receipt_no = $1`, [manualNo]);
      if (used.rows.length > 0) return { code: 400, error: `Receipt ${manualNo} has already been used` };
      const ok = await claimManualReceipt(db, officerId, manualNo);
      if (!ok) return { code: 400, error: `Receipt ${manualNo} is not in this officer's receipt book` };
      receiptNo = manualNo;
    } else {
      receiptNo = await takeNextReceipt(db, officerId);
      if (receiptNo === null) {
        return { code: 400, error: 'This officer has no receipt numbers left — add a new receipt book' };
      }
    }

    const total = items.reduce((s, i) => s + i.amount, 0);
    const p = await db.query(
      `INSERT INTO pm_payments (receipt_no, member_id, officer_id, paid_date, total, notes, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING payment_id`,
      [receiptNo, memberId, officerId, paidDate, total, cleanText(body.notes, 500) || null,
        req.user.username]
    );
    for (const i of items) {
      await db.query(
        `INSERT INTO pm_payment_items (payment_id, member_id, item_type, year, month, amount)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [p.rows[0].payment_id, memberId, i.type, year, i.month, i.amount]
      );
    }
    await audit(db, req, 'create_payment', 'payment', p.rows[0].payment_id, {
      receiptNo, memberId, officerId, year, membership, months, total, paidDate
    });
    const row = (await db.query(`${PAYMENT_SELECT} WHERE p.payment_id = $1`, [p.rows[0].payment_id])).rows[0];
    const map = await loadItems(db, [row.payment_id]);
    return { code: 201, payment: toPayment(row, map[row.payment_id] || []) };
  });
  if (out.error) return res.status(out.code).json({ error: out.error });
  res.status(201).json(out.payment);
}));

router.get('/', asyncHandler(async (req, res) => {
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);
  if (from === undefined || to === undefined) {
    return res.status(400).json({ error: 'from/to must be valid YYYY-MM-DD dates' });
  }
  const params = [];
  const conds = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };
  if (req.query.memberId) conds.push(`p.member_id = ${add(String(req.query.memberId))}`);
  if (req.query.officerId) {
    const o = toInt(req.query.officerId);
    if (Number.isNaN(o)) return res.status(400).json({ error: 'officerId is invalid' });
    conds.push(`p.officer_id = ${add(o)}`);
  }
  if (from) conds.push(`p.paid_date >= ${add(from)}::date`);
  if (to) conds.push(`p.paid_date <= ${add(to)}::date`);
  if (req.query.receiptNo) {
    const n = toInt(req.query.receiptNo);
    if (Number.isNaN(n)) return res.status(400).json({ error: 'receiptNo is invalid' });
    conds.push(`p.receipt_no = ${add(n)}`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const limit = Math.min(Math.max(toInt(req.query.limit) || 100, 1), 500);

  const r = await query(
    `${PAYMENT_SELECT} ${where} ORDER BY p.paid_date DESC, p.receipt_no DESC LIMIT ${limit}`, params);
  const map = await loadItems({ query }, r.rows.map((x) => x.payment_id));
  res.json(r.rows.map((x) => toPayment(x, map[x.payment_id] || [])));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = toInt(req.params.id);
  if (!(id > 0)) return res.status(404).json({ error: 'Payment not found' });
  const r = await query(`${PAYMENT_SELECT} WHERE p.payment_id = $1`, [id]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
  const map = await loadItems({ query }, [id]);
  res.json(toPayment(r.rows[0], map[id] || []));
}));

// Void a payment (e.g. entered by mistake). A reason is required, a full copy of
// the payment is kept in the audit log, and the receipt number is NOT reused.
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = toInt(req.params.id);
  const reason = cleanText((req.body || {}).reason, 300);
  if (reason.length < 3) {
    return res.status(400).json({ error: 'A reason (at least 3 characters) is required to void a payment' });
  }
  if (!(id > 0)) return res.status(404).json({ error: 'Payment not found' });

  const out = await withTransaction(async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock($1)`, [PAYMENT_LOCK]);
    const r = await db.query(`${PAYMENT_SELECT} WHERE p.payment_id = $1`, [id]);
    if (r.rows.length === 0) return { code: 404, error: 'Payment not found' };
    const map = await loadItems(db, [id]);
    await audit(db, req, 'void_payment', 'payment', id, {
      reason,
      payment: toPayment(r.rows[0], map[id] || [])
    });
    await db.query(`DELETE FROM pm_payments WHERE payment_id = $1`, [id]);
    return { code: 204 };
  });
  if (out.error) return res.status(out.code).json({ error: out.error });
  res.status(204).send();
}));

module.exports = router;

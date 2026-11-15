const express = require('express');
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { parseDate, today, toInt, toMoney, cleanText, parseYear } = require('../lib/util');
const { audit } = require('../lib/audit');

const router = express.Router();
router.use(requireAuth);

function toExpense(row) {
  return {
    expenseId: row.expense_id,
    expenseDate: row.expense_date,
    category: row.category,
    description: row.description,
    amount: row.amount
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const year = parseYear(req.query.year, null);
  if (year === undefined) return res.status(400).json({ error: 'year is invalid' });
  const r = year
    ? await query(
      `SELECT * FROM pm_expenses WHERE EXTRACT(YEAR FROM expense_date) = $1
       ORDER BY expense_date DESC, expense_id DESC`, [year])
    : await query(`SELECT * FROM pm_expenses ORDER BY expense_date DESC, expense_id DESC LIMIT 500`);
  res.json(r.rows.map(toExpense));
}));

router.post('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const category = cleanText(body.category, 50);
  const amount = toMoney(body.amount);
  const expenseDate = body.expenseDate ? parseDate(body.expenseDate) : today();
  if (!category) return res.status(400).json({ error: 'category is required' });
  if (Number.isNaN(amount)) return res.status(400).json({ error: 'amount must be a number >= 0' });
  if (expenseDate === undefined) return res.status(400).json({ error: 'expenseDate must be YYYY-MM-DD' });
  const r = await query(
    `INSERT INTO pm_expenses (expense_date, category, description, amount)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [expenseDate, category, cleanText(body.description, 300) || null, amount]
  );
  await audit(null, req, 'create_expense', 'expense', r.rows[0].expense_id, toExpense(r.rows[0]));
  res.status(201).json(toExpense(r.rows[0]));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = toInt(req.params.id);
  const r = id > 0 ? await query(`DELETE FROM pm_expenses WHERE expense_id = $1 RETURNING *`, [id]) : { rowCount: 0 };
  if (r.rowCount === 0) return res.status(404).json({ error: 'Expense not found' });
  await audit(null, req, 'delete_expense', 'expense', id, toExpense(r.rows[0]));
  res.status(204).send();
}));

module.exports = router;

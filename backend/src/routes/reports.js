const express = require('express');
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { getSettings } = require('../lib/fees');
const { parseYear } = require('../lib/util');

const router = express.Router();
router.use(requireAuth);

// Yearly money in / out, by calendar year of the date money actually moved.
//   income:   membership fees + monthly contributions + equipment rentals
//   expenses: death benefits paid + other expenses (equipment purchases etc.)
//   profit:   income - expenses
router.get('/yearly', asyncHandler(async (req, res) => {
  const [fees, rentals, deaths, expenses] = await Promise.all([
    query(
      `SELECT EXTRACT(YEAR FROM p.paid_date)::int AS year, i.item_type, SUM(i.amount) AS total
       FROM pm_payment_items i JOIN pm_payments p ON p.payment_id = i.payment_id
       GROUP BY 1, 2`),
    query(`SELECT EXTRACT(YEAR FROM rent_date)::int AS year, SUM(amount) AS total
           FROM pm_rentals GROUP BY 1`),
    query(`SELECT EXTRACT(YEAR FROM paid_date)::int AS year, SUM(amount) AS total
           FROM pm_death_benefits GROUP BY 1`),
    query(`SELECT EXTRACT(YEAR FROM expense_date)::int AS year, category, SUM(amount) AS total
           FROM pm_expenses GROUP BY 1, 2`)
  ]);

  const years = {};
  const row = (y) => (years[y] = years[y] || {
    year: y, membershipFees: 0, monthlyContributions: 0, rentalIncome: 0,
    deathBenefits: 0, otherExpenses: 0, expenseBreakdown: {}
  });
  for (const f of fees.rows) {
    if (f.item_type === 'MEMBERSHIP') row(f.year).membershipFees += f.total;
    else row(f.year).monthlyContributions += f.total;
  }
  for (const r of rentals.rows) row(r.year).rentalIncome += r.total;
  for (const d of deaths.rows) row(d.year).deathBenefits += d.total;
  for (const e of expenses.rows) {
    row(e.year).otherExpenses += e.total;
    row(e.year).expenseBreakdown[e.category] = e.total;
  }

  const list = Object.values(years)
    .sort((a, b) => b.year - a.year)
    .map((y) => {
      const totalIncome = y.membershipFees + y.monthlyContributions + y.rentalIncome;
      const totalExpenses = y.deathBenefits + y.otherExpenses;
      return { ...y, totalIncome, totalExpenses, profit: totalIncome - totalExpenses };
    });
  res.json(list);
}));

// Operational dashboard for one year: how much is collected vs expected,
// who still owes, which officers are running out of receipts, stock on hand.
router.get('/dashboard', asyncHandler(async (req, res) => {
  const year = parseYear(req.query.year, new Date().getFullYear());
  if (!year) return res.status(400).json({ error: 'Invalid year' });
  const settings = await getSettings(undefined, year);
  const yearlyFee = settings.membershipFee + 12 * settings.monthlyFee;

  const [members, paid, byStatus, officers, books, stock, recent, benefits, rentalsOut, monthly] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active FROM pm_members`),
    query(
      `SELECT COALESCE(SUM(i.amount), 0) AS total,
              COALESCE(SUM(i.amount) FILTER (WHERE m.is_active), 0) AS active_total
       FROM pm_payment_items i JOIN pm_members m ON m.member_id = i.member_id
       WHERE i.year = $1`, [year]),
    query(
      `SELECT CASE WHEN s.paid >= $2 THEN 'PAID' WHEN s.paid > 0 THEN 'PARTIAL' ELSE 'UNPAID' END AS status,
              COUNT(*)::int AS n
       FROM (SELECT m.member_id,
                    COALESCE((SELECT SUM(i.amount) FROM pm_payment_items i
                              WHERE i.member_id = m.member_id AND i.year = $1), 0) AS paid
             FROM pm_members m WHERE m.is_active) s
       GROUP BY 1`, [year, yearlyFee]),
    query(
      `SELECT o.officer_id, o.officer_name,
              (SELECT COUNT(*)::int FROM pm_members m WHERE m.officer_id = o.officer_id AND m.is_active) AS members,
              COALESCE((SELECT SUM(i.amount) FROM pm_payment_items i
                        JOIN pm_payments p ON p.payment_id = i.payment_id
                        WHERE p.officer_id = o.officer_id AND i.year = $1), 0) AS collected
       FROM pm_officers o
       ORDER BY collected DESC, o.officer_name`, [year]),
    query(
      `SELECT officer_id, SUM(end_no - next_no + 1)::int AS left_no
       FROM pm_receipt_books GROUP BY officer_id`),
    query(
      `SELECT e.equipment_id, e.name, e.total_qty,
              (e.total_qty - COALESCE(SUM(r.qty) FILTER (WHERE r.returned_date IS NULL), 0))::int AS available
       FROM pm_equipment e LEFT JOIN pm_rentals r ON r.equipment_id = e.equipment_id
       GROUP BY e.equipment_id, e.name, e.total_qty ORDER BY e.name`),
    query(
      `SELECT p.payment_id, p.receipt_no, p.paid_date, p.total, m.member_id, m.member_name
       FROM pm_payments p JOIN pm_members m ON m.member_id = p.member_id
       ORDER BY p.paid_date DESC, p.payment_id DESC LIMIT 8`),
    query(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*)::int AS n
       FROM pm_death_benefits WHERE EXTRACT(YEAR FROM paid_date) = $1`, [year]),
    query(`SELECT COUNT(*)::int AS n FROM pm_rentals WHERE returned_date IS NULL`),
    query(
      `SELECT i.month, SUM(i.amount) AS total
       FROM pm_payment_items i WHERE i.year = $1 AND i.item_type = 'MONTHLY'
       GROUP BY i.month ORDER BY i.month`, [year])
  ]);

  const statusCount = { PAID: 0, PARTIAL: 0, UNPAID: 0 };
  for (const r of byStatus.rows) statusCount[r.status] = r.n;
  const activeMembers = members.rows[0].active;
  const expected = activeMembers * yearlyFee;
  const collected = paid.rows[0].total;
  const left = Object.fromEntries(books.rows.map((b) => [b.officer_id, b.left_no]));
  const monthlyTotals = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0 }));
  for (const m of monthly.rows) monthlyTotals[m.month - 1].total = m.total;

  // ---- Analytics ----
  const now = new Date();
  const monthsElapsed = year < now.getFullYear() ? 12 : year > now.getFullYear() ? 0 : now.getMonth() + 1;
  const years = [year, year - 1];
  const [fin, cash, behind] = await Promise.all([
    Promise.all([
      query(
        `SELECT EXTRACT(YEAR FROM p.paid_date)::int AS y, i.item_type, SUM(i.amount) AS total
         FROM pm_payment_items i JOIN pm_payments p ON p.payment_id = i.payment_id
         WHERE EXTRACT(YEAR FROM p.paid_date) = ANY($1) GROUP BY 1, 2`, [years]),
      query(`SELECT EXTRACT(YEAR FROM rent_date)::int AS y, SUM(amount) AS total
             FROM pm_rentals WHERE EXTRACT(YEAR FROM rent_date) = ANY($1) GROUP BY 1`, [years]),
      query(`SELECT EXTRACT(YEAR FROM paid_date)::int AS y, SUM(amount) AS total
             FROM pm_death_benefits WHERE EXTRACT(YEAR FROM paid_date) = ANY($1) GROUP BY 1`, [years]),
      query(`SELECT EXTRACT(YEAR FROM expense_date)::int AS y, SUM(amount) AS total
             FROM pm_expenses WHERE EXTRACT(YEAR FROM expense_date) = ANY($1) GROUP BY 1`, [years])
    ]),
    Promise.all([
      query(`SELECT EXTRACT(MONTH FROM paid_date)::int AS m, SUM(total) AS total
             FROM pm_payments WHERE EXTRACT(YEAR FROM paid_date) = $1 GROUP BY 1`, [year]),
      query(`SELECT EXTRACT(MONTH FROM rent_date)::int AS m, SUM(amount) AS total
             FROM pm_rentals WHERE EXTRACT(YEAR FROM rent_date) = $1 GROUP BY 1`, [year])
    ]),
    query(
      `SELECT m.member_id, m.member_name, o.officer_name,
              $2::int - COALESCE((SELECT COUNT(*) FROM pm_payment_items i
                                  WHERE i.member_id = m.member_id AND i.year = $1
                                    AND i.item_type = 'MONTHLY' AND i.month <= $2), 0)::int AS months_behind
       FROM pm_members m LEFT JOIN pm_officers o ON o.officer_id = m.officer_id
       WHERE m.is_active
       ORDER BY months_behind DESC, m.member_name LIMIT 8`, [year, monthsElapsed])
  ]);

  const totals = (y) => {
    const [fees, rentals, deaths, exps] = fin;
    const t = { membershipFees: 0, monthlyContributions: 0, rentalIncome: 0, deathBenefits: 0, otherExpenses: 0 };
    for (const f of fees.rows) if (f.y === y) t[f.item_type === 'MEMBERSHIP' ? 'membershipFees' : 'monthlyContributions'] += f.total;
    for (const r of rentals.rows) if (r.y === y) t.rentalIncome += r.total;
    for (const r of deaths.rows) if (r.y === y) t.deathBenefits += r.total;
    for (const r of exps.rows) if (r.y === y) t.otherExpenses += r.total;
    t.income = t.membershipFees + t.monthlyContributions + t.rentalIncome;
    t.expenses = t.deathBenefits + t.otherExpenses;
    t.profit = t.income - t.expenses;
    return t;
  };
  const cur = totals(year);
  const prev = totals(year - 1);
  const cashByMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0 }));
  for (const c of cash) for (const r of c.rows) cashByMonth[r.m - 1].total += r.total;
  const projectedIncome = monthsElapsed > 0 ? Math.round((cur.income / monthsElapsed) * 12) : 0;

  res.json({
    analytics: {
      monthsElapsed,
      monthlyTarget: activeMembers * settings.monthlyFee,
      current: cur,
      previous: prev,
      cashByMonth,
      projectedIncome,
      behindMembers: behind.rows
        .filter((b) => b.months_behind > 0)
        .map((b) => ({
          memberId: b.member_id, memberName: b.member_name, officerName: b.officer_name,
          monthsBehind: b.months_behind, owes: b.months_behind * settings.monthlyFee
        }))
    },
    year,
    yearlyFee,
    totalMembers: members.rows[0].total,
    activeMembers,
    expected,
    collected,
    // "Expected" is what the active members owe, so the rate and the amount still to
    // collect only count what active members have paid (inactive payers would push it past 100%).
    outstanding: Math.max(expected - paid.rows[0].active_total, 0),
    collectionRate: expected > 0 ? Math.min(Math.round((paid.rows[0].active_total / expected) * 1000) / 10, 100) : 0,
    statusCount,
    deathBenefits: { total: benefits.rows[0].total, count: benefits.rows[0].n },
    rentalsOut: rentalsOut.rows[0].n,
    monthly: monthlyTotals,
    officers: officers.rows.map((o) => ({
      officerId: o.officer_id,
      officerName: o.officer_name,
      members: o.members,
      collected: o.collected,
      receiptsLeft: left[o.officer_id] || 0
    })),
    stock: stock.rows.map((s) => ({
      equipmentId: s.equipment_id, name: s.name, totalQty: s.total_qty, available: s.available
    })),
    recentPayments: recent.rows.map((p) => ({
      paymentId: p.payment_id, receiptNo: p.receipt_no, paidDate: p.paid_date,
      total: p.total, memberId: p.member_id, memberName: p.member_name
    }))
  });
}));

module.exports = router;

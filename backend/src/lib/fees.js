const { query } = require('../db/pool');

// Fees in force for a given year. pm_fee_schedule holds "from this year onward"
// rows, so changing a fee never rewrites what earlier years cost. Falls back to
// the pm_settings defaults when no schedule exists yet.
async function getSettings(db = { query }, year) {
  const r = await db.query(`SELECT key, value FROM pm_settings`);
  const map = Object.fromEntries(r.rows.map((x) => [x.key, parseFloat(x.value)]));
  let monthlyFee = Number.isFinite(map.monthly_fee) ? map.monthly_fee : 250;
  let membershipFee = Number.isFinite(map.membership_fee) ? map.membership_fee : 100;

  const y = Number.isInteger(year) ? year : new Date().getFullYear();
  const s = await db.query(
    `SELECT monthly_fee, membership_fee FROM pm_fee_schedule WHERE year <= $1 ORDER BY year DESC LIMIT 1`,
    [y]
  );
  if (s.rows.length > 0) {
    monthlyFee = s.rows[0].monthly_fee;
    membershipFee = s.rows[0].membership_fee;
  }
  return { monthlyFee, membershipFee };
}

function statusFor(paid, yearlyTotal) {
  if (paid >= yearlyTotal && yearlyTotal > 0) return 'PAID';
  if (paid > 0) return 'PARTIAL';
  return 'UNPAID';
}

// Full payment picture for one member in one year:
// membership fee (once a year) + 12 monthly contributions.
async function memberYearStatus(memberId, year, db = { query }) {
  const settings = await getSettings(db, year);
  const r = await db.query(
    `SELECT i.item_type, i.month, i.amount, p.receipt_no, p.paid_date
     FROM pm_payment_items i
     JOIN pm_payments p ON p.payment_id = i.payment_id
     WHERE i.member_id = $1 AND i.year = $2`,
    [memberId, year]
  );
  const membership = r.rows.find((x) => x.item_type === 'MEMBERSHIP');
  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    const row = r.rows.find((x) => x.item_type === 'MONTHLY' && x.month === m);
    months.push({
      month: m,
      paid: Boolean(row),
      amount: row ? row.amount : settings.monthlyFee,
      receiptNo: row ? row.receipt_no : null,
      paidDate: row ? row.paid_date : null
    });
  }
  const yearlyTotal = settings.membershipFee + 12 * settings.monthlyFee;
  const paidAmount = r.rows.reduce((s, x) => s + x.amount, 0);
  return {
    year,
    monthlyFee: settings.monthlyFee,
    membershipFee: settings.membershipFee,
    yearlyTotal,
    membership: {
      paid: Boolean(membership),
      amount: membership ? membership.amount : settings.membershipFee,
      receiptNo: membership ? membership.receipt_no : null,
      paidDate: membership ? membership.paid_date : null
    },
    months,
    paidAmount,
    dueAmount: Math.max(yearlyTotal - paidAmount, 0),
    status: statusFor(paidAmount, yearlyTotal)
  };
}

module.exports = { getSettings, memberYearStatus, statusFor };

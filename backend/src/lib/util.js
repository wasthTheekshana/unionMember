// Shared validation / parsing helpers.

// Returns the value if it's a real YYYY-MM-DD date, null if empty, undefined if invalid.
function parseDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return undefined;
  return value;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toInt(value) {
  if (value === undefined || value === null || value === '') return NaN;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

// Non-negative money amount with at most 2 decimals; returns NaN if invalid.
function toMoney(value) {
  if (value === undefined || value === null || value === '') return NaN;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000000) return NaN;
  return Math.round(n * 100) / 100;
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function parseYear(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = toInt(value);
  return n >= 2000 && n <= 2100 ? n : undefined;
}

module.exports = { parseDate, today, toInt, toMoney, cleanText, parseYear };

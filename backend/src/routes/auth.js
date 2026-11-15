const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { createLimiter } = require('../lib/rateLimit');
const { audit } = require('../lib/audit');
const { WEAK } = require('../config');

const router = express.Router();

const MAX_USER_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS, 10) || 5;
const userLimiter = createLimiter({ max: MAX_USER_ATTEMPTS });   // per username + IP
const ipLimiter = createLimiter({ max: MAX_USER_ATTEMPTS * 6 }); // per IP, any username
// Per username from ANY address. A client address can be faked by something that reaches
// the app container directly, so this caps guessing against one account regardless of IP.
const nameLimiter = createLimiter({ max: MAX_USER_ATTEMPTS * 5 });
const passwordLimiter = createLimiter({ max: MAX_USER_ATTEMPTS }); // wrong current password

// Compared against when the user does not exist, so response time does not
// reveal which usernames are real.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

function sign(user) {
  return jwt.sign(
    { userId: user.user_id, username: user.username, tv: user.token_version || 0 },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '8h' }
  );
}

function tooMany(res, seconds) {
  res.set('Retry-After', String(seconds));
  return res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).` });
}

router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  if (username.length > 100 || password.length > 200) {
    return res.status(400).json({ error: 'username or password is too long' });
  }

  const userKey = `${username.toLowerCase()}|${req.ip}`;
  const ipKey = req.ip;
  const nameKey = username.toLowerCase();
  // 1) Check every limiter. A refused attempt is NOT counted anywhere, so someone who is
  //    locked out on one limiter cannot use up the shared per-address allowance of others.
  const wait = Math.max(
    userLimiter.retryAfter(userKey), ipLimiter.retryAfter(ipKey), nameLimiter.retryAfter(nameKey)
  );
  if (wait > 0) return tooMany(res, wait);
  // 2) Count the attempt NOW, in the same synchronous step and before any await, so parallel
  //    guesses cannot slip past the limit while earlier ones wait on the database / bcrypt.
  userLimiter.fail(userKey);
  ipLimiter.fail(ipKey);
  nameLimiter.fail(nameKey);

  const result = await query(
    `SELECT user_id, username, password_hash, token_version FROM pm_users WHERE username = $1`,
    [username]
  );
  const user = result.rows[0];
  const match = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !match) {
    console.warn(`Failed login for "${username.slice(0, 40)}" from ${req.ip}`);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  // A correct password clears this username's counters; the shared per-address counter
  // only gets this one attempt back (so a valid login cannot be used to reset it).
  userLimiter.reset(userKey);
  nameLimiter.reset(nameKey);
  ipLimiter.refund(ipKey);
  await audit(null, { user: { userId: user.user_id, username: user.username } }, 'login', 'user', user.user_id);
  res.json({ token: sign(user) });
}));

// Change your own password. Signs out every other session and returns a fresh token.
router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 10 || newPassword.length > 200) {
    return res.status(400).json({ error: 'New password must be 10 to 200 characters' });
  }
  if (WEAK.has(newPassword.toLowerCase()) || newPassword.toLowerCase() === req.user.username.toLowerCase()) {
    return res.status(400).json({ error: 'That password is too easy to guess' });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'New password must be different from the current one' });
  }

  const key = String(req.user.userId);
  const wait = passwordLimiter.consume(key); // counted before any await (see /login)
  if (wait > 0) return tooMany(res, wait);

  const r = await query(`SELECT password_hash FROM pm_users WHERE user_id = $1`, [req.user.userId]);
  if (r.rows.length === 0 || !(await bcrypt.compare(currentPassword, r.rows[0].password_hash))) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  passwordLimiter.reset(key);

  const hash = await bcrypt.hash(newPassword, 12);
  const upd = await query(
    `UPDATE pm_users SET password_hash = $1, token_version = token_version + 1
     WHERE user_id = $2 RETURNING user_id, username, token_version`,
    [hash, req.user.userId]
  );
  await audit(null, req, 'change_password', 'user', req.user.userId);
  res.json({ token: sign(upd.rows[0]) });
}));

module.exports = router;

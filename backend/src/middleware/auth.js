const jwt = require('jsonwebtoken');
const { query } = require('../db/pool');

// Verifies the bearer token (HS256 only) and that the user still exists and the
// token has not been revoked (token_version changes on password change).
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const r = await query(
      `SELECT user_id, username, token_version FROM pm_users WHERE user_id = $1`,
      [payload.userId]
    );
    const user = r.rows[0];
    if (!user || user.token_version !== (payload.tv || 0)) {
      return res.status(401).json({ error: 'Session is no longer valid. Please log in again.' });
    }
    req.user = { userId: user.user_id, username: user.username };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireAuth };

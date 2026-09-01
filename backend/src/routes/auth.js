const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getConnection } = require('../db/pool');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const conn = await getConnection();
  try {
    const result = await conn.execute(
      `SELECT user_id, username, password_hash FROM pm_users WHERE username = :username`,
      { username }
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const match = await bcrypt.compare(password, user.PASSWORD_HASH);
    if (!match) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { userId: user.USER_ID, username: user.USERNAME },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token });
  } finally {
    await conn.close();
  }
}));

module.exports = router;

const express = require('express');
const { getConnection } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const conn = await getConnection();
  try {
    const result = await conn.execute(
      `SELECT officer_id, officer_name FROM officers ORDER BY officer_name`
    );
    const officers = result.rows.map((row) => ({
      officerId: row.OFFICER_ID,
      officerName: row.OFFICER_NAME
    }));
    res.json(officers);
  } finally {
    await conn.close();
  }
}));

module.exports = router;

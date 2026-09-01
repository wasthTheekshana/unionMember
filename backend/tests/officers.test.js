const request = require('supertest');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const createApp = require('../src/app');
const { initPool, closePool, getConnection } = require('../src/db/pool');

const TEST_OFFICER = 'Test Officer For Jest';

function tokenFor(userId, username) {
  return jwt.sign({ userId, username }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

describe('GET /api/officers', () => {
  let app;
  const token = tokenFor(1, 'tester');

  beforeAll(async () => {
    await initPool();
    app = createApp();
    const conn = await getConnection();
    try {
      await conn.execute(
        `INSERT INTO pm_officers (officer_name) VALUES (:n)`,
        { n: TEST_OFFICER }
      );
      await conn.commit();
    } finally {
      await conn.close();
    }
  });

  afterAll(async () => {
    const conn = await getConnection();
    try {
      await conn.execute(`DELETE FROM pm_officers WHERE officer_name = :n`, { n: TEST_OFFICER });
      await conn.commit();
    } finally {
      await conn.close();
    }
    await closePool();
  });

  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/officers');
    expect(res.status).toBe(401);
  });

  it('returns officers sorted by name when authenticated', async () => {
    const res = await request(app)
      .get('/api/officers')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.some((o) => o.officerName === TEST_OFFICER)).toBe(true);
    expect(res.body[0]).toHaveProperty('officerId');
  });
});

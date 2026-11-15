const request = require('supertest');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const createApp = require('../src/app');
const { initPool, closePool, query } = require('../src/db/pool');

const TEST_USERNAME = 'test_auth_user';
const TEST_PASSWORD = 'Test1234!';

describe('POST /api/auth/login', () => {
  let app;

  beforeAll(async () => {
    await initPool();
    app = createApp();
    const hash = await bcrypt.hash(TEST_PASSWORD, 10);
    await query(`INSERT INTO pm_users (username, password_hash) VALUES ($1, $2)`, [TEST_USERNAME, hash]);
  });

  afterAll(async () => {
    await query(`DELETE FROM pm_users WHERE username = $1`, [TEST_USERNAME]);
    await query(`DELETE FROM pm_audit_log WHERE username = $1`, [TEST_USERNAME]);
    await closePool();
  });

  it('returns a token for correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });

  it('rejects incorrect password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USERNAME, password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('rejects missing fields', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });
});

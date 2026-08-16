const request = require('supertest');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const createApp = require('../src/app');
const { initPool, closePool, getConnection } = require('../src/db/pool');

const TEST_USERNAME = 'test_auth_user';
const TEST_PASSWORD = 'Test1234!';

describe('POST /api/auth/login', () => {
  let app;

  beforeAll(async () => {
    await initPool();
    app = createApp();
    const conn = await getConnection();
    try {
      const hash = await bcrypt.hash(TEST_PASSWORD, 10);
      await conn.execute(
        `INSERT INTO users (username, password_hash) VALUES (:u, :p)`,
        { u: TEST_USERNAME, p: hash }
      );
      await conn.commit();
    } finally {
      await conn.close();
    }
  });

  afterAll(async () => {
    const conn = await getConnection();
    try {
      await conn.execute(`DELETE FROM users WHERE username = :u`, { u: TEST_USERNAME });
      await conn.commit();
    } finally {
      await conn.close();
    }
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

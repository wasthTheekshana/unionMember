const request = require('supertest');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const createApp = require('../src/app');
const { initPool, closePool, getConnection } = require('../src/db/pool');

function tokenFor() {
  return jwt.sign({ userId: 1, username: 'tester' }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

const TEST_ID = '999001';

describe('/api/members CRUD', () => {
  let app;
  const token = tokenFor();

  beforeAll(async () => {
    await initPool();
    app = createApp();
  });

  afterEach(async () => {
    const conn = await getConnection();
    try {
      await conn.execute(`DELETE FROM members WHERE member_id = :id`, { id: TEST_ID });
      await conn.commit();
    } finally {
      await conn.close();
    }
  });

  afterAll(async () => {
    await closePool();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/members');
    expect(res.status).toBe(401);
  });

  it('creates, reads, updates, and deletes a member', async () => {
    const createRes = await request(app)
      .post('/api/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ memberId: TEST_ID, memberName: 'Jest Test Member', phone: '0710000000' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.memberId).toBe(TEST_ID);

    const getRes = await request(app)
      .get(`/api/members/${TEST_ID}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.memberName).toBe('Jest Test Member');

    const updateRes = await request(app)
      .put(`/api/members/${TEST_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ memberName: 'Jest Test Member Updated', phone: '0720000000' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.memberName).toBe('Jest Test Member Updated');

    const deleteRes = await request(app)
      .delete(`/api/members/${TEST_ID}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleteRes.status).toBe(204);

    const getAfterDelete = await request(app)
      .get(`/api/members/${TEST_ID}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getAfterDelete.status).toBe(404);
  });

  it('rejects create with missing memberName', async () => {
    const res = await request(app)
      .post('/api/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ memberId: TEST_ID });
    expect(res.status).toBe(400);
  });

  it('rejects create with invalid email', async () => {
    const res = await request(app)
      .post('/api/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ memberId: TEST_ID, memberName: 'Bad Email', email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});

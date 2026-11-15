const request = require('supertest');
require('dotenv').config();
const createApp = require('../src/app');
const { initPool, closePool, query } = require('../src/db/pool');
const { createTestUser, removeTestUser } = require('./helpers');

const TEST_ID = '999001';

describe('/api/members CRUD', () => {
  let app;
  let token;

  beforeAll(async () => {
    await initPool();
    app = createApp();
    ({ token } = await createTestUser());
  });

  afterEach(async () => {
    await query(`DELETE FROM pm_members WHERE member_id = $1`, [TEST_ID]);
  });

  afterAll(async () => {
    await removeTestUser();
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

  it('filters the list by updated date range and searches by id', async () => {
    await request(app)
      .post('/api/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ memberId: TEST_ID, memberName: 'Date Filter Member' });

    const today = new Date().toISOString().slice(0, 10);
    const list = (qs) =>
      request(app).get(`/api/members?${qs}`).set('Authorization', `Bearer ${token}`);

    const inRange = await list(`search=${TEST_ID}&dateFrom=${today}&dateTo=${today}`);
    expect(inRange.status).toBe(200);
    expect(inRange.body.items.map((m) => m.memberId)).toContain(TEST_ID);

    const onlyFrom = await list(`search=${TEST_ID}&dateFrom=${today}`);
    expect(onlyFrom.body.items.map((m) => m.memberId)).toContain(TEST_ID);

    const past = await list(`search=${TEST_ID}&dateTo=2000-01-01`);
    expect(past.body.items).toHaveLength(0);

    const future = await list(`search=${TEST_ID}&dateFrom=2999-01-01`);
    expect(future.body.items).toHaveLength(0);
  });

  it('rejects an invalid date filter', async () => {
    const res = await request(app)
      .get('/api/members?dateFrom=not-a-date')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
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

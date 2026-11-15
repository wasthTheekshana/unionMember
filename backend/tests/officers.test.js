const request = require('supertest');
require('dotenv').config();
const createApp = require('../src/app');
const { initPool, closePool, query } = require('../src/db/pool');
const { createTestUser, removeTestUser } = require('./helpers');

const TEST_OFFICER = 'Test Officer For Jest';

describe('GET /api/officers', () => {
  let app;
  let token;

  beforeAll(async () => {
    await initPool();
    app = createApp();
    ({ token } = await createTestUser());
    await query(`INSERT INTO pm_officers (officer_name) VALUES ($1)`, [TEST_OFFICER]);
  });

  afterAll(async () => {
    await query(`DELETE FROM pm_officers WHERE officer_name = $1`, [TEST_OFFICER]);
    await removeTestUser();
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
    expect(res.body[0]).toHaveProperty('memberCount');
  });

  describe('create and rename', () => {
    const NEW_NAME = 'Jest Created Officer';
    const RENAMED = 'Jest Renamed Officer';
    const auth = () => ({ Authorization: `Bearer ${token}` });

    afterEach(async () => {
      await query(`DELETE FROM pm_officers WHERE officer_name = ANY($1)`, [[NEW_NAME, RENAMED]]);
    });

    it('creates an officer, rejects duplicates and empty names, and renames', async () => {
      const created = await request(app).post('/api/officers').set(auth()).send({ officerName: NEW_NAME });
      expect(created.status).toBe(201);
      expect(created.body.officerName).toBe(NEW_NAME);
      expect(created.body.officerId).toBeDefined();

      const dup = await request(app).post('/api/officers').set(auth()).send({ officerName: NEW_NAME });
      expect(dup.status).toBe(400);

      const empty = await request(app).post('/api/officers').set(auth()).send({ officerName: '   ' });
      expect(empty.status).toBe(400);

      const renamed = await request(app)
        .put(`/api/officers/${created.body.officerId}`)
        .set(auth())
        .send({ officerName: RENAMED });
      expect(renamed.status).toBe(200);
      expect(renamed.body.officerName).toBe(RENAMED);

      const clash = await request(app)
        .put(`/api/officers/${created.body.officerId}`)
        .set(auth())
        .send({ officerName: TEST_OFFICER });
      expect(clash.status).toBe(400);
    });

    it('returns 404 when renaming a missing officer', async () => {
      const res = await request(app).put('/api/officers/999999999').set(auth()).send({ officerName: 'Nobody' });
      expect(res.status).toBe(404);
    });
  });
});

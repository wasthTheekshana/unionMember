const request = require('supertest');
require('dotenv').config();
const createApp = require('../src/app');
const { initPool, closePool, query } = require('../src/db/pool');
const { checkConfig } = require('../src/config');
const { createLimiter } = require('../src/lib/rateLimit');
const { createTestUser, removeTestUser, TEST_PASS } = require('./helpers');

const OFFICER = 'Jest Sec Officer';
const EQUIP = 'Jest Sec Chair';
const M1 = 'T-SEC-1';
const M2 = 'T-SEC-2';
const M3 = 'T-SEC-3';
const M4 = 'T-SEC-4';
const MEMBERS = [M1, M2, M3, M4];

describe('startup config check', () => {
  const good = { NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), DB_PASSWORD: 'a-real-password' };

  it('accepts a strong production config', () => {
    expect(checkConfig(good)).toEqual([]);
  });
  it('rejects placeholder or short secrets in production', () => {
    expect(checkConfig({ ...good, JWT_SECRET: 'change-this-secret' }).length).toBe(1);
    expect(checkConfig({ ...good, JWT_SECRET: 'short' }).length).toBe(1);
    expect(checkConfig({ ...good, DB_PASSWORD: 'changeme' }).length).toBe(1);
    expect(checkConfig({ ...good, DB_PASSWORD: '' }).length).toBe(1);
  });
  it('always requires a JWT secret, but allows weak ones outside production', () => {
    expect(checkConfig({ NODE_ENV: 'development' }).length).toBe(1);
    expect(checkConfig({ NODE_ENV: 'development', JWT_SECRET: 'dev' })).toEqual([]);
  });
});

describe('failure limiter', () => {
  it('blocks after max failures and recovers after the window', () => {
    let t = 0;
    const l = createLimiter({ windowMs: 1000, max: 3, now: () => t });
    expect(l.retryAfter('k')).toBe(0);
    l.fail('k'); l.fail('k');
    expect(l.retryAfter('k')).toBe(0);
    l.fail('k');
    expect(l.retryAfter('k')).toBeGreaterThan(0);
    expect(l.retryAfter('other')).toBe(0);
    t = 1001;
    expect(l.retryAfter('k')).toBe(0);
  });
  it('consume counts the attempt immediately and refund gives it back', () => {
    const l = createLimiter({ max: 2 });
    expect(l.consume('k')).toBe(0);
    expect(l.consume('k')).toBe(0);
    expect(l.consume('k')).toBeGreaterThan(0); // third attempt refused
    l.refund('k');
    expect(l.consume('k')).toBe(0); // one slot is free again
  });
  it('reset clears the count', () => {
    const l = createLimiter({ max: 1 });
    l.fail('k');
    expect(l.retryAfter('k')).toBeGreaterThan(0);
    l.reset('k');
    expect(l.retryAfter('k')).toBe(0);
  });
});

describe('hardening (API)', () => {
  let app;
  let token;
  let officerId;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const api = {
    get: (u) => request(app).get(u).set(auth()),
    post: (u, b) => request(app).post(u).set(auth()).send(b),
    put: (u, b) => request(app).put(u).set(auth()).send(b),
    del: (u, b) => request(app).delete(u).set(auth()).send(b || {})
  };

  async function cleanup() {
    await query(`DELETE FROM pm_rentals WHERE renter_name LIKE 'Jest Sec%' OR member_id = ANY($1)`, [MEMBERS]);
    await query(`DELETE FROM pm_equipment WHERE name = $1`, [EQUIP]);
    await query(`DELETE FROM pm_payments WHERE member_id = ANY($1)`, [MEMBERS]);
    await query(`DELETE FROM pm_death_benefits WHERE member_id = ANY($1)`, [MEMBERS]);
    await query(`DELETE FROM pm_members WHERE member_id = ANY($1)`, [MEMBERS]);
    await query(`DELETE FROM pm_receipt_books WHERE officer_id IN
                 (SELECT officer_id FROM pm_officers WHERE officer_name = $1)`, [OFFICER]);
    await query(`DELETE FROM pm_officers WHERE officer_name = $1`, [OFFICER]);
  }

  let feeBefore;

  beforeAll(async () => {
    await initPool();
    app = createApp();
    ({ token } = await createTestUser());
    await cleanup();
    feeBefore = {
      schedule: (await query(`SELECT COUNT(*) AS n FROM pm_fee_schedule`)).rows[0].n,
      settings: (await query(`SELECT key, value FROM pm_settings`)).rows
    };
    officerId = (await api.post('/api/officers', { officerName: OFFICER })).body.officerId;
    await api.post(`/api/officers/${officerId}/books`, { startNo: 9100000, endNo: 9100100 });
    for (const id of MEMBERS) {
      await api.post('/api/members', { memberId: id, memberName: `Jest Sec ${id}`, officerId });
    }
  });

  afterAll(async () => {
    await cleanup();
    if (feeBefore.schedule === 0) await query(`DELETE FROM pm_fee_schedule`);
    else await query(`DELETE FROM pm_fee_schedule WHERE year = 2034`);
    for (const s of feeBefore.settings) {
      await query(`UPDATE pm_settings SET value = $1 WHERE key = $2`, [s.value, s.key]);
    }
    await removeTestUser();
    await closePool();
  });

  describe('transport and errors', () => {
    it('hides the framework and does not allow cross-origin requests', async () => {
      const res = await request(app).get('/api/health').set('Origin', 'http://evil.example');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
    it('answers malformed JSON with 400, not 500', async () => {
      const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad');
      expect(res.status).toBe(400);
    });
    it('answers unknown API routes with a JSON 404', async () => {
      const res = await api.get('/api/nope');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
    });
  });

  describe('login protection', () => {
    it('locks a username out after repeated failures', async () => {
      const attempt = () => request(app).post('/api/auth/login').send({ username: 'jest_lockout_probe', password: 'nope' });
      for (let i = 0; i < 5; i += 1) expect((await attempt()).status).toBe(401);
      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    });
    it('does not count refused attempts against the shared per-address allowance', async () => {
      const from = (name) => request(app).post('/api/auth/login')
        .set('X-Forwarded-For', '203.0.113.77')
        .send({ username: name, password: 'nope' });
      for (let i = 0; i < 5; i += 1) expect((await from('jest_refused_probe')).status).toBe(401);
      // Keep hammering the locked-out name: every one of these is refused.
      let last;
      for (let i = 0; i < 40; i += 1) last = await from('jest_refused_probe');
      expect(last.status).toBe(429);
      // Someone else behind the same address must not have been locked out by that.
      expect((await from('jest_other_user_probe')).status).toBe(401);
    });
    it('cannot be beaten by firing many guesses at the same moment', async () => {
      const attempt = () => request(app).post('/api/auth/login')
        .send({ username: 'jest_parallel_probe', password: 'nope' });
      const results = await Promise.all(Array.from({ length: 12 }, attempt));
      const codes = results.map((r) => r.status);
      expect(codes.filter((c) => c === 401)).toHaveLength(5); // only the allowed guesses got checked
      expect(codes.filter((c) => c === 429)).toHaveLength(7);
    });
    it('still caps guessing when every request pretends to come from a new address', async () => {
      // Tests connect from loopback, so X-Forwarded-For is trusted here, like a proxy hop.
      const attempt = (n) => request(app).post('/api/auth/login')
        .set('X-Forwarded-For', `198.51.100.${n}`)
        .send({ username: 'jest_spoof_probe', password: 'nope' });
      for (let i = 1; i <= 25; i += 1) expect((await attempt(i)).status).toBe(401);
      expect((await attempt(26)).status).toBe(429);
    });
    it('rejects non-string credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({ username: { $ne: 1 }, password: 'x' });
      expect(res.status).toBe(400);
    });
  });

  describe('sessions', () => {
    it('signs out old tokens when the password changes', async () => {
      const { token: oldToken } = await createTestUser('jest_pw_user');
      const asUser = (t) => ({ Authorization: `Bearer ${t}` });

      const wrong = await request(app).post('/api/auth/change-password').set(asUser(oldToken))
        .send({ currentPassword: 'not-it', newPassword: 'Brand-New-Pass-77' });
      expect(wrong.status).toBe(400);
      const weak = await request(app).post('/api/auth/change-password').set(asUser(oldToken))
        .send({ currentPassword: TEST_PASS, newPassword: 'short' });
      expect(weak.status).toBe(400);

      const ok = await request(app).post('/api/auth/change-password').set(asUser(oldToken))
        .send({ currentPassword: TEST_PASS, newPassword: 'Brand-New-Pass-77' });
      expect(ok.status).toBe(200);

      const stale = await request(app).get('/api/officers').set(asUser(oldToken));
      expect(stale.status).toBe(401);
      const fresh = await request(app).get('/api/officers').set(asUser(ok.body.token));
      expect(fresh.status).toBe(200);
      await removeTestUser('jest_pw_user');
    });
    it('rejects tokens of users that no longer exist', async () => {
      const { token: ghost } = await createTestUser('jest_gone_user');
      await removeTestUser('jest_gone_user');
      const res = await request(app).get('/api/officers').set({ Authorization: `Bearer ${ghost}` });
      expect(res.status).toBe(401);
    });
  });

  describe('input validation', () => {
    it('returns 400 for wrong types and over-long values', async () => {
      expect((await api.put('/api/members/NOPE', { memberName: 123 })).status).toBe(400);
      expect((await api.post('/api/members', { memberId: 'X'.repeat(40), memberName: 'Probe' })).status).toBe(400);
      expect((await api.post('/api/members', { memberId: 'has space', memberName: 'Probe' })).status).toBe(400);
      expect((await api.post('/api/members', { memberId: 'T-SEC-9', memberName: 'Probe', phone: 'p'.repeat(80) })).status).toBe(400);
    });
    it('treats a non-numeric family id as not found', async () => {
      const res = await api.put(`/api/members/${M1}/family/abc`, { name: 'x', relationship: 'SPOUSE' });
      expect(res.status).toBe(404);
    });
  });

  describe('payments', () => {
    it('does not burn receipt numbers when one is typed ahead of the sequence', async () => {
      const manual = await api.post('/api/payments', { memberId: M1, year: 2032, months: [1], receiptNo: 9100003 });
      expect(manual.status).toBe(201);
      const got = [];
      for (const month of [2, 3, 4, 5]) {
        const r = await api.post('/api/payments', { memberId: M1, year: 2032, months: [month] });
        expect(r.status).toBe(201);
        got.push(r.body.receiptNo);
      }
      expect(got).toEqual([9100000, 9100001, 9100002, 9100004]);
    });

    it('records who took the payment and writes an audit entry', async () => {
      const r = await api.post('/api/payments', { memberId: M1, year: 2032, months: [6] });
      expect(r.body.recordedBy).toBe('jest_api_user');
      const log = await query(
        `SELECT username, details FROM pm_audit_log WHERE action = 'create_payment' AND entity_id = $1`,
        [String(r.body.paymentId)]
      );
      expect(log.rows).toHaveLength(1);
      expect(log.rows[0].username).toBe('jest_api_user');
      expect(log.rows[0].details.receiptNo).toBe(r.body.receiptNo);
    });

    it('refuses payments for inactive members', async () => {
      await api.put(`/api/members/${M2}`, { memberName: 'Jest Sec T-SEC-2', isActive: false });
      const r = await api.post('/api/payments', { memberId: M2, year: 2032, months: [1] });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/inactive/);
    });

    it('needs a reason to void and keeps a full copy in the audit log', async () => {
      const p = await api.post('/api/payments', { memberId: M1, year: 2032, months: [7] });
      const id = p.body.paymentId;
      expect((await api.del(`/api/payments/${id}`)).status).toBe(400);
      expect((await api.del(`/api/payments/${id}`, { reason: 'ok' })).status).toBe(400);
      expect((await api.del(`/api/payments/${id}`, { reason: 'Entered twice by mistake' })).status).toBe(204);
      expect((await api.get(`/api/payments/${id}`)).status).toBe(404);
      const log = await query(
        `SELECT details FROM pm_audit_log WHERE action = 'void_payment' AND entity_id = $1`, [String(id)]);
      expect(log.rows).toHaveLength(1);
      expect(log.rows[0].details.reason).toBe('Entered twice by mistake');
      expect(log.rows[0].details.payment.receiptNo).toBe(p.body.receiptNo);
      expect(log.rows[0].details.payment.total).toBe(250);
    });

    it('lists the activity log', async () => {
      const res = await api.get('/api/audit?entity=payment&limit=5');
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toHaveProperty('username');
    });
  });

  describe('fee history', () => {
    it('keeps earlier years unchanged when a fee changes', async () => {
      const full = await api.post('/api/payments', {
        memberId: M3, year: 2033, membership: true, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
      });
      expect(full.status).toBe(201);
      const paid = full.body.total;

      const bad = await api.put('/api/settings', { monthlyFee: 300, membershipFee: 100, fromYear: 1999 });
      expect(bad.status).toBe(400);
      const change = await api.put('/api/settings', { monthlyFee: 300, membershipFee: 100, fromYear: 2034 });
      expect(change.status).toBe(200);

      const before = (await api.get(`/api/members/${M3}?year=2033`)).body.yearStatus;
      expect(before.status).toBe('PAID');
      expect(before.yearlyTotal).toBe(paid);
      const after = (await api.get(`/api/members/${M3}?year=2034`)).body.yearStatus;
      expect(after.yearlyTotal).toBe(100 + 12 * 300);
      expect(after.status).toBe('UNPAID');

      const newPay = await api.post('/api/payments', { memberId: M3, year: 2034, months: [1] });
      expect(newPay.body.total).toBe(300);
    });
  });

  describe('protected history', () => {
    it('will not delete a member that has a death payout, and death can be reversed', async () => {
      const death = await api.post(`/api/members/${M4}/death`, { deathDate: '2031-05-01', amount: 1000 });
      expect(death.status).toBe(201);
      const benefitId = death.body.benefitId;

      const blocked = await api.del(`/api/members/${M4}`);
      expect(blocked.status).toBe(400);
      expect(blocked.body.error).toMatch(/death-benefit/);
      const still = await query(`SELECT COUNT(*) AS n FROM pm_death_benefits WHERE benefit_id = $1`, [benefitId]);
      expect(still.rows[0].n).toBe(1);

      expect((await api.del(`/api/death-benefits/${benefitId}`)).status).toBe(400);
      expect((await api.del(`/api/death-benefits/${benefitId}`, { reason: 'Recorded for wrong member' })).status).toBe(204);
      const member = (await api.get(`/api/members/${M4}`)).body;
      expect(member.isActive).toBe(true);
      expect((await api.del(`/api/members/${M4}`)).status).toBe(204);
    });
  });

  describe('rentals', () => {
    it('lets a rental be voided with a reason, returning the stock', async () => {
      const eq = (await api.post('/api/equipment', { name: EQUIP, totalQty: 10, memberPrice: 10, visitorPrice: 20 })).body;
      const rent = await api.post('/api/rentals', {
        equipmentId: eq.equipmentId, renterType: 'VISITOR', renterName: 'Jest Sec Visitor', qty: 4, days: 1
      });
      expect(rent.status).toBe(201);
      expect((await api.get('/api/equipment')).body.find((e) => e.name === EQUIP).available).toBe(6);

      expect((await api.del(`/api/rentals/${rent.body.rentalId}`)).status).toBe(400);
      expect((await api.del(`/api/rentals/${rent.body.rentalId}`, { reason: 'Customer cancelled' })).status).toBe(204);
      expect((await api.get('/api/equipment')).body.find((e) => e.name === EQUIP).available).toBe(10);
    });
  });
});

const request = require('supertest');
require('dotenv').config();
const createApp = require('../src/app');
const { initPool, closePool, query } = require('../src/db/pool');
const { createTestUser, removeTestUser } = require('./helpers');

const MEMBER = 'T-FEAT-1';
const MEMBER2 = 'T-FEAT-2';
const OFFICER = 'Jest Feature Officer';
const OFFICER2 = 'Jest Feature Officer 2';
const EQUIP = 'Jest Chair';
const YEAR = 2031;

describe('samithiya features', () => {
  let app;
  let officerId;
  let officer2Id;
  let testToken;
  const auth = () => ({ Authorization: `Bearer ${testToken}` });
  const api = {
    get: (u) => request(app).get(u).set(auth()),
    post: (u, b) => request(app).post(u).set(auth()).send(b),
    put: (u, b) => request(app).put(u).set(auth()).send(b),
    del: (u) => request(app).delete(u).set(auth())
  };

  async function cleanup() {
    await query(`DELETE FROM pm_rentals WHERE renter_name LIKE 'Jest %' OR member_id = ANY($1)`, [[MEMBER, MEMBER2]]);
    await query(`DELETE FROM pm_equipment WHERE name = $1`, [EQUIP]);
    await query(`DELETE FROM pm_payments WHERE member_id = ANY($1)`, [[MEMBER, MEMBER2]]);
    await query(`DELETE FROM pm_death_benefits WHERE member_id = ANY($1)`, [[MEMBER, MEMBER2]]);
    await query(`DELETE FROM pm_members WHERE member_id = ANY($1)`, [[MEMBER, MEMBER2]]);
    await query(`DELETE FROM pm_receipt_books WHERE officer_id IN
                 (SELECT officer_id FROM pm_officers WHERE officer_name = ANY($1))`, [[OFFICER, OFFICER2]]);
    await query(`DELETE FROM pm_officers WHERE officer_name = ANY($1)`, [[OFFICER, OFFICER2]]);
    await query(`DELETE FROM pm_expenses WHERE category = 'Jest'`);
  }

  beforeAll(async () => {
    await initPool();
    app = createApp();
    ({ token: testToken } = await createTestUser());
    await cleanup();
    officerId = (await api.post('/api/officers', { officerName: OFFICER })).body.officerId;
    officer2Id = (await api.post('/api/officers', { officerName: OFFICER2 })).body.officerId;
    await api.post('/api/members', { memberId: MEMBER, memberName: 'Jest Member One', officerId });
    await api.post('/api/members', { memberId: MEMBER2, memberName: 'Jest Member Two', officerId });
  });

  afterAll(async () => {
    await cleanup();
    await removeTestUser();
    await closePool();
  });

  describe('receipt books', () => {
    it('creates a book, rejects overlaps and bad ranges', async () => {
      const ok = await api.post(`/api/officers/${officerId}/books`, { startNo: 9000000, endNo: 9000100 });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ startNo: 9000000, endNo: 9000100, nextNo: 9000000, remaining: 101 });

      const overlap = await api.post(`/api/officers/${officer2Id}/books`, { startNo: 9000050, endNo: 9000200 });
      expect(overlap.status).toBe(400);
      expect(overlap.body.error).toMatch(/overlaps/);

      const bad = await api.post(`/api/officers/${officer2Id}/books`, { startNo: 20, endNo: 10 });
      expect(bad.status).toBe(400);

      const second = await api.post(`/api/officers/${officer2Id}/books`, { startNo: 9000101, endNo: 9000110 });
      expect(second.status).toBe(201);
    });
  });

  describe('payments', () => {
    it('shows UNPAID before any payment', async () => {
      const res = await api.get(`/api/members/${MEMBER}?year=${YEAR}`);
      expect(res.status).toBe(200);
      expect(res.body.yearStatus).toMatchObject({
        status: 'UNPAID', paidAmount: 0, dueAmount: 3100, yearlyTotal: 3100
      });
    });

    it('records membership + months, auto-assigns receipts in order, and updates status', async () => {
      const first = await api.post('/api/payments', { memberId: MEMBER, year: YEAR, membership: true, months: [1, 2] });
      expect(first.status).toBe(201);
      expect(first.body.receiptNo).toBe(9000000);
      expect(first.body.total).toBe(600); // 100 + 2 x 250
      expect(first.body.items.map((i) => i.label)).toEqual([`${YEAR} Membership`, `Jan ${YEAR}`, `Feb ${YEAR}`]);

      const second = await api.post('/api/payments', { memberId: MEMBER2, year: YEAR, months: [3] });
      expect(second.body.receiptNo).toBe(9000001);

      const status = (await api.get(`/api/members/${MEMBER}?year=${YEAR}`)).body.yearStatus;
      expect(status).toMatchObject({ status: 'PARTIAL', paidAmount: 600, dueAmount: 2500 });
      expect(status.membership.paid).toBe(true);
      expect(status.months[0]).toMatchObject({ month: 1, paid: true, receiptNo: 9000000 });
      expect(status.months[2].paid).toBe(false);
    });

    it('rejects paying the same month twice and names it', async () => {
      const res = await api.post('/api/payments', { memberId: MEMBER, year: YEAR, months: [2, 4] });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Feb/);
      const status = (await api.get(`/api/members/${MEMBER}?year=${YEAR}`)).body.yearStatus;
      expect(status.months[3].paid).toBe(false);
    });

    it('validates manual receipt numbers', async () => {
      const used = await api.post('/api/payments', { memberId: MEMBER, year: YEAR, months: [5], receiptNo: 9000000 });
      expect(used.status).toBe(400);
      expect(used.body.error).toMatch(/already been used/);

      const outside = await api.post('/api/payments', { memberId: MEMBER, year: YEAR, months: [5], receiptNo: 5 });
      expect(outside.status).toBe(400);
      expect(outside.body.error).toMatch(/not in this officer/);

      // Writing a receipt further ahead must not burn the numbers in between.
      const manual = await api.post('/api/payments', { memberId: MEMBER, year: YEAR, months: [5], receiptNo: 9000010 });
      expect(manual.status).toBe(201);
      const next = await api.get(`/api/payments/next-receipt?officerId=${officerId}`);
      expect(next.body.nextReceiptNo).toBe(9000002);
    });

    it('can pay the full year to reach PAID', async () => {
      const rest = [3, 4, 6, 7, 8, 9, 10, 11, 12];
      const res = await api.post('/api/payments', { memberId: MEMBER, year: YEAR, months: rest });
      expect(res.status).toBe(201);
      const status = (await api.get(`/api/members/${MEMBER}?year=${YEAR}`)).body.yearStatus;
      expect(status).toMatchObject({ status: 'PAID', paidAmount: 3100, dueAmount: 0 });
    });

    it('filters the member list by yearly status', async () => {
      const paid = await api.get(`/api/members?year=${YEAR}&status=PAID&search=T-FEAT`);
      expect(paid.body.items.map((m) => m.memberId)).toEqual([MEMBER]);
      const partial = await api.get(`/api/members?year=${YEAR}&status=PARTIAL&search=T-FEAT`);
      expect(partial.body.items.map((m) => m.memberId)).toEqual([MEMBER2]);
    });

    it("lists an officer's collections by receipt", async () => {
      const res = await api.get(`/api/officers/${officerId}/collections`);
      expect(res.status).toBe(200);
      expect(res.body.receiptCount).toBeGreaterThanOrEqual(4);
      const nos = res.body.receipts.map((r) => r.receiptNo);
      expect(nos).toEqual([...nos].sort((a, b) => a - b));
    });

    it('refuses when the member has no officer / receipt book', async () => {
      await api.post('/api/members', { memberId: 'T-FEAT-3', memberName: 'Jest Orphan' });
      const res = await api.post('/api/payments', { memberId: 'T-FEAT-3', year: YEAR, months: [1] });
      expect(res.status).toBe(400);
      await query(`DELETE FROM pm_members WHERE member_id = 'T-FEAT-3'`);
    });
  });

  describe('family and deaths', () => {
    it('adds family, marks one deceased with a payout, and logs it', async () => {
      const spouse = await api.post(`/api/members/${MEMBER}/family`, { name: 'Jest Spouse', relationship: 'spouse' });
      expect(spouse.status).toBe(201);
      const bad = await api.post(`/api/members/${MEMBER}/family`, { name: 'X', relationship: 'cousin' });
      expect(bad.status).toBe(400);

      const death = await api.post(`/api/members/${MEMBER}/family/${spouse.body.familyId}/death`, {
        deathDate: `${YEAR}-02-10`, amount: 25000, notes: 'funeral'
      });
      expect(death.status).toBe(201);

      const again = await api.post(`/api/members/${MEMBER}/family/${spouse.body.familyId}/death`, {
        deathDate: `${YEAR}-02-11`, amount: 1
      });
      expect(again.status).toBe(400);

      const fam = (await api.get(`/api/members/${MEMBER}/family`)).body;
      expect(fam[0]).toMatchObject({ status: 'DECEASED', deceasedDate: `${YEAR}-02-10` });

      const list = (await api.get(`/api/death-benefits?year=${YEAR}&memberId=${MEMBER}`)).body;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ amount: 25000, relationship: 'SPOUSE', deceasedName: 'Jest Spouse' });
    });

    it('marks the member inactive when the member dies', async () => {
      const res = await api.post(`/api/members/${MEMBER2}/death`, { deathDate: `${YEAR}-06-01`, amount: 50000 });
      expect(res.status).toBe(201);
      const m = (await api.get(`/api/members/${MEMBER2}`)).body;
      expect(m.isActive).toBe(false);
      const dup = await api.post(`/api/members/${MEMBER2}/death`, { deathDate: `${YEAR}-06-02`, amount: 1 });
      expect(dup.status).toBe(400);
    });

    it('blocks deleting a member who has payments', async () => {
      const res = await api.del(`/api/members/${MEMBER}`);
      expect(res.status).toBe(400);
    });
  });

  describe('equipment rentals', () => {
    let equipmentId;

    it('creates equipment with separate member / visitor prices', async () => {
      const res = await api.post('/api/equipment', { name: EQUIP, totalQty: 10, memberPrice: 20, visitorPrice: 50 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ totalQty: 10, available: 10, memberPrice: 20, visitorPrice: 50 });
      equipmentId = res.body.equipmentId;
    });

    it('prices member and visitor rentals differently and reduces stock', async () => {
      const m = await api.post('/api/rentals', {
        equipmentId, renterType: 'MEMBER', memberId: MEMBER, qty: 4, days: 2, rentDate: `${YEAR}-03-01`
      });
      expect(m.status).toBe(201);
      expect(m.body).toMatchObject({ unitPrice: 20, amount: 160, renterName: 'Jest Member One' });

      const v = await api.post('/api/rentals', {
        equipmentId, renterType: 'VISITOR', renterName: 'Jest Visitor', qty: 3, days: 1, rentDate: `${YEAR}-03-02`
      });
      expect(v.body).toMatchObject({ unitPrice: 50, amount: 150 });

      const eq = (await api.get('/api/equipment')).body.find((e) => e.equipmentId === equipmentId);
      expect(eq).toMatchObject({ rentedOut: 7, available: 3 });
    });

    it('refuses to rent more than available', async () => {
      const res = await api.post('/api/rentals', {
        equipmentId, renterType: 'VISITOR', renterName: 'Jest Greedy', qty: 4, days: 1
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Only 3/);
    });

    it('admin price change affects new rentals only; returns restore stock', async () => {
      await api.put(`/api/equipment/${equipmentId}`, { name: EQUIP, totalQty: 10, memberPrice: 30, visitorPrice: 70 });
      const r = await api.post('/api/rentals', {
        equipmentId, renterType: 'VISITOR', renterName: 'Jest Later', qty: 1, days: 1, rentDate: `${YEAR}-03-03`
      });
      expect(r.body.unitPrice).toBe(70);

      const out = (await api.get(`/api/rentals?status=OUT&equipmentId=${equipmentId}`)).body;
      const first = out.find((x) => x.renterName === 'Jest Member One');
      expect(first.unitPrice).toBe(20);

      const ret = await api.put(`/api/rentals/${first.rentalId}/return`, { returnedDate: `${YEAR}-03-03` });
      expect(ret.status).toBe(200);
      expect(ret.body.status).toBe('RETURNED');
      const again = await api.put(`/api/rentals/${first.rentalId}/return`, {});
      expect(again.status).toBe(400);
      const eq = (await api.get('/api/equipment')).body.find((e) => e.equipmentId === equipmentId);
      expect(eq.available).toBe(10 - 3 - 1);
    });

    it('cannot lower total stock below what is rented out', async () => {
      const res = await api.put(`/api/equipment/${equipmentId}`, { name: EQUIP, totalQty: 2, memberPrice: 1, visitorPrice: 1 });
      expect(res.status).toBe(400);
    });
  });

  describe('yearly report', () => {
    it('computes income, expenses and profit for the year', async () => {
      await api.post('/api/expenses', { expenseDate: `${YEAR}-04-01`, category: 'Jest', amount: 1000 });
      const report = (await api.get('/api/reports/yearly')).body;
      const y = report.find((r) => r.year === YEAR);
      // payments were recorded today (not in YEAR), so fees land in the current year's row
      const thisYear = report.find((r) => r.year === new Date().getFullYear());
      expect(thisYear.membershipFees).toBeGreaterThanOrEqual(100);
      expect(thisYear.monthlyContributions).toBeGreaterThanOrEqual(250 * 12);
      expect(y.rentalIncome).toBe(160 + 150 + 70);
      expect(y.deathBenefits).toBe(25000 + 50000);
      expect(y.otherExpenses).toBe(1000);
      expect(y.profit).toBe(y.totalIncome - y.totalExpenses);
    });
  });

  describe('settings', () => {
    it('reads fees and validates updates', async () => {
      const before = (await api.get('/api/settings')).body;
      expect(before).toMatchObject({ monthlyFee: 250, membershipFee: 100 });
      const bad = await api.put('/api/settings', { monthlyFee: 0, membershipFee: 100 });
      expect(bad.status).toBe(400);
    });
  });
});

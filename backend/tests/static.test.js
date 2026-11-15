const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const createApp = require('../src/app');

// The Docker image serves the built frontend from the API process.
describe('serving the built frontend (SERVE_FRONTEND_DIR)', () => {
  let dir;
  let app;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'um-static-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Union Members</title>');
    fs.writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    process.env.SERVE_FRONTEND_DIR = dir;
    app = createApp();
  });

  afterAll(() => {
    delete process.env.SERVE_FRONTEND_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('serves index.html at / and never caches it', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Union Members');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('falls back to index.html for client-side routes', async () => {
    const res = await request(app).get('/members/393A');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Union Members');
  });

  it('caches hashed assets for a long time', async () => {
    const res = await request(app).get('/assets/app-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/immutable/);
  });

  it('keeps unknown /api paths as JSON 404s, not the SPA page', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('still serves the health check', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body).toEqual({ status: 'ok' });
  });
});

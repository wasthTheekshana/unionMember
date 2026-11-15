const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth');
const officersRouter = require('./routes/officers');
const membersRouter = require('./routes/members');
const paymentsRouter = require('./routes/payments');
const equipmentRouter = require('./routes/equipment');
const rentalsRouter = require('./routes/rentals');
const expensesRouter = require('./routes/expenses');
const settingsRouter = require('./routes/settings');
const deathBenefitsRouter = require('./routes/deathBenefits');
const reportsRouter = require('./routes/reports');
const auditRouter = require('./routes/audit');

// Database errors caused by bad input are the caller's mistake, not a server fault.
const PG_CLIENT_ERRORS = {
  '22001': [400, 'One of the values is too long'],
  '22003': [400, 'A number is out of range'],
  '22007': [400, 'A date is not valid'],
  '22008': [400, 'A date is not valid'],
  '22P02': [400, 'One of the values has an invalid format'],
  '23502': [400, 'A required value is missing'],
  '23514': [400, 'A value is not allowed'],
  '23505': [409, 'That record already exists (or was just created by someone else). Please retry.'],
  '23503': [409, 'That record refers to something that does not exist, or is still in use']
};

function createApp() {
  const app = express();
  // Only trust X-Forwarded-For from a proxy we control, so a client cannot spoof
  // its IP to dodge the login rate limit. Default: a proxy on this machine (nginx).
  // Behind a Docker nginx set TRUST_PROXY="loopback, uniquelocal" (private ranges only).
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
  app.use(helmet());

  // The frontend is served from the same origin (nginx proxies /api), so CORS is
  // off unless explicit origins are configured, e.g. CORS_ORIGIN=https://app.example.org
  const origins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origins.length > 0) app.use(cors({ origin: origins }));

  app.use(express.json({ limit: '100kb' }));

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/officers', officersRouter);
  app.use('/api/members', membersRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/equipment', equipmentRouter);
  app.use('/api/rentals', rentalsRouter);
  app.use('/api/expenses', expensesRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/death-benefits', deathBenefitsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/audit', auditRouter);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Optional: serve the built frontend from this process (used by the Docker image,
  // where the shared nginx proxies everything to this one container).
  const publicDir = process.env.SERVE_FRONTEND_DIR;
  if (publicDir) {
    app.use(express.static(publicDir, {
      index: false,
      setHeaders: (res, filePath) => {
        // Vite output in /assets has hashed names, so it can be cached for a year.
        if (/[\\/]assets[\\/]/.test(filePath)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }));
    // Single-page app: any other GET falls back to index.html (client-side routing).
    app.get(/^\/(?!api\/).*/, (req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  }

  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Request body is not valid JSON' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body is too large' });
    }
    if (PG_CLIENT_ERRORS[err.code]) {
      const [status, message] = PG_CLIENT_ERRORS[err.code];
      return res.status(status).json({ error: message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = createApp;

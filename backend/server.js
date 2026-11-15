require('dotenv').config();
const createApp = require('./src/app');
const { initPool, closePool } = require('./src/db/pool');
const { checkConfig } = require('./src/config');

const port = process.env.PORT || 5000;

async function start() {
  // Refuse to start with missing/placeholder secrets in production.
  const problems = checkConfig();
  if (problems.length > 0) {
    const fatal = process.env.NODE_ENV === 'production' || problems.some((p) => p.includes('not set'));
    for (const p of problems) console.error(`${fatal ? 'CONFIG ERROR' : 'Config warning'}: ${p}`);
    if (fatal) process.exit(1);
  }

  try {
    await initPool();
  } catch (err) {
    console.error('Failed to initialize DB pool:', err);
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });

  async function shutdown() {
    server.close();
    await closePool();
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();

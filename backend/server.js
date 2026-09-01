require('dotenv').config();
const createApp = require('./src/app');
const { initPool, closePool } = require('./src/db/pool');

const port = process.env.PORT || 5000;

async function start() {
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

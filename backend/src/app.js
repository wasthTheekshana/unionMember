const express = require('express');
const cors = require('cors');
const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth');
const officersRouter = require('./routes/officers');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/officers', officersRouter);

  return app;
}

module.exports = createApp;

// The tests create and delete rows in whatever database backend/.env points at.
// Refuse to run if that file says this is a production server.
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  const parsed = dotenv.parse(fs.readFileSync(envFile));
  if (parsed.NODE_ENV === 'production' && process.env.ALLOW_TESTS_ON_PRODUCTION !== 'yes-i-understand') {
    throw new Error(
      'Refusing to run tests: backend/.env has NODE_ENV=production. ' +
      'Tests delete data. Point .env at a development database first.'
    );
  }
}

// Startup safety checks. Refuses to boot in production with missing or
// placeholder secrets (the example .env values must never reach a real server).
const WEAK = new Set([
  'change-this-secret', 'changeme', 'secret', 'password', 'admin123', 'local-dev-secret', 'test123'
]);

function checkConfig(env = process.env) {
  const problems = [];
  const production = env.NODE_ENV === 'production';

  const secret = env.JWT_SECRET || '';
  if (!secret) {
    problems.push('JWT_SECRET is not set');
  } else if (production && (secret.length < 32 || WEAK.has(secret.toLowerCase()))) {
    problems.push('JWT_SECRET must be a random string of at least 32 characters (not a placeholder) in production');
  }

  const dbPassword = env.DB_PASSWORD || '';
  if (production && (!dbPassword || WEAK.has(dbPassword.toLowerCase()))) {
    problems.push('DB_PASSWORD must be set to a real password in production');
  }
  return problems;
}

module.exports = { checkConfig, WEAK };

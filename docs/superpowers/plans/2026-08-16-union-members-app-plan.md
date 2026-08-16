# Union Members Management App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web app (React frontend + Express/Oracle backend) that replaces `UNION_Members.csv` with a login-gated CRUD interface for union members, backed by Oracle DB.

**Architecture:** Express REST API (`backend/`) talks to Oracle via `node-oracledb` in thin mode (no native client install). JWT auth protects all routes except login. React SPA (`frontend/`, built with Vite) consumes the API: login page, members list (search/paginate/delete), add/edit form.

**Tech Stack:** Node.js, Express, node-oracledb (thin mode), jsonwebtoken, bcryptjs, cors, dotenv, csv-parse (backend); React, react-router-dom, Vite (frontend); Jest + Supertest (backend tests, run against the real Oracle DB — no mocking of the database).

**Spec:** [docs/superpowers/specs/2026-08-16-union-members-app-design.md](../specs/2026-08-16-union-members-app-design.md)

## Global Constraints

- DB connection: `DB_USER=system`, `DB_PASSWORD=wasath123`, `DB_CONNECTION_STRING=localhost:1521/XEPDB1` (from user-provided `.env`).
- Server: `PORT=5000`, `NODE_ENV=production`, `JWT_SECRET=itasset-dok-2025-change-this-in-prod`.
- `node-oracledb` must run in **thin mode** — do not call `oracledb.initOracleClient()`, do not require Oracle Instant Client.
- `member_id` is preserved from the source CSV (not auto-generated) — see spec Data Model.
- All `/api/*` routes except `/api/auth/login` require a valid JWT (`Authorization: Bearer <token>`).
- No automated frontend test suite (per spec Testing section) — manual walkthrough only, after Task 11.

---

## File Structure

```
backend/
  package.json
  .env                          (real credentials, gitignored)
  .env.example                  (placeholder values, committed)
  .gitignore
  server.js                     (entrypoint: init pool, start express)
  src/
    app.js                      (express app + route mounting)
    db/pool.js                  (oracledb pool init/close)
    middleware/auth.js          (JWT verify middleware)
    routes/health.js
    routes/auth.js
    routes/officers.js
    routes/members.js
    scripts/create-schema.js
    scripts/seed-admin.js
    scripts/import-csv.js
  tests/
    health.test.js
    auth.test.js
    officers.test.js
    members.test.js

frontend/
  package.json
  index.html
  vite.config.js
  src/
    main.jsx
    App.jsx
    api/client.js
    context/AuthContext.jsx
    routes/ProtectedRoute.jsx
    pages/Login.jsx
    pages/MembersList.jsx
    pages/MemberForm.jsx
    styles.css

docs/superpowers/... (already exists — spec + this plan)
UNION_Members.csv (already exists at repo root — source for import script)
```

---

### Task 1: Backend scaffold and health check

**Files:**
- Create: `backend/package.json`
- Create: `backend/.env`
- Create: `backend/.env.example`
- Create: `backend/.gitignore`
- Create: `backend/src/app.js`
- Create: `backend/src/routes/health.js`
- Create: `backend/server.js`
- Test: `backend/tests/health.test.js`

**Interfaces:**
- Produces: `backend/src/app.js` exports an Express `app` (no `.listen()` call — that's in `server.js`), used by all later route tasks and by tests via `supertest(app)`.

- [ ] **Step 1: Create `backend/package.json`**

```json
{
  "name": "union-members-backend",
  "version": "1.0.0",
  "private": true,
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "jest --runInBand",
    "create-schema": "node src/scripts/create-schema.js",
    "seed-admin": "node src/scripts/seed-admin.js",
    "import-csv": "node src/scripts/import-csv.js"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "csv-parse": "^5.5.6",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "jsonwebtoken": "^9.0.2",
    "oracledb": "^6.5.1"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 2: Create `backend/.env`**

```
DB_USER=system
DB_PASSWORD=wasath123
DB_CONNECTION_STRING=localhost:1521/XEPDB1

PORT=5000
NODE_ENV=production
JWT_SECRET=itasset-dok-2025-change-this-in-prod
```

- [ ] **Step 3: Create `backend/.env.example`**

```
DB_USER=system
DB_PASSWORD=changeme
DB_CONNECTION_STRING=localhost:1521/XEPDB1

PORT=5000
NODE_ENV=development
JWT_SECRET=change-this-secret
```

- [ ] **Step 4: Create `backend/.gitignore`**

```
node_modules/
.env
```

- [ ] **Step 5: Create `backend/src/routes/health.js`**

```javascript
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = router;
```

- [ ] **Step 6: Create `backend/src/app.js`**

```javascript
const express = require('express');
const cors = require('cors');
const healthRouter = require('./routes/health');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api/health', healthRouter);

  return app;
}

module.exports = createApp;
```

- [ ] **Step 7: Create `backend/server.js`**

```javascript
require('dotenv').config();
const createApp = require('./src/app');

const app = createApp();
const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
```

- [ ] **Step 8: Write the failing test — `backend/tests/health.test.js`**

```javascript
const request = require('supertest');
const createApp = require('../src/app');

describe('GET /api/health', () => {
  it('returns status ok', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 9: Install dependencies and run the test**

Run: `cd backend && npm install && npm test -- health.test.js`
Expected: PASS (1 test)

- [ ] **Step 10: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/.env.example backend/.gitignore backend/src backend/server.js backend/tests
git commit -m "feat: scaffold backend Express app with health check"
```

---

### Task 2: Oracle DB pool and schema creation script

**Files:**
- Create: `backend/src/db/pool.js`
- Create: `backend/src/scripts/create-schema.js`

**Interfaces:**
- Consumes: `backend/.env` (`DB_USER`, `DB_PASSWORD`, `DB_CONNECTION_STRING`) via `dotenv`.
- Produces: `backend/src/db/pool.js` exports `{ initPool(): Promise<void>, closePool(): Promise<void>, getConnection(): Promise<oracledb.Connection> }`, used by every route and script from here on.

- [ ] **Step 1: Create `backend/src/db/pool.js`**

```javascript
const oracledb = require('oracledb');

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

async function initPool() {
  if (oracledb.getPool()) return;
  await oracledb.createPool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECTION_STRING,
    poolMin: 1,
    poolMax: 10,
    poolIncrement: 1
  });
}

async function closePool() {
  const pool = safeGetPool();
  if (pool) await pool.close(0);
}

function safeGetPool() {
  try {
    return oracledb.getPool();
  } catch {
    return null;
  }
}

async function getConnection() {
  return oracledb.getConnection();
}

module.exports = { initPool, closePool, getConnection };
```

Note: `oracledb.getPool()` throws (not returns null/undefined) if no pool exists yet, so `initPool` guards with try/catch via `safeGetPool`, not a truthiness check.

- [ ] **Step 2: Fix the guard in `initPool` to use the same safe check**

Replace the `if (oracledb.getPool()) return;` line so `initPool` also uses `safeGetPool()`:

```javascript
async function initPool() {
  if (safeGetPool()) return;
  await oracledb.createPool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECTION_STRING,
    poolMin: 1,
    poolMax: 10,
    poolIncrement: 1
  });
}
```

(This replaces the Step 1 version of `initPool` — the full file after this step has `initPool` using `safeGetPool()`, `safeGetPool` defined before its first use.)

- [ ] **Step 3: Create `backend/src/scripts/create-schema.js`**

```javascript
require('dotenv').config();
const { initPool, closePool, getConnection } = require('../db/pool');

const statements = [
  `CREATE TABLE officers (
    officer_id   NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    officer_name VARCHAR2(200) NOT NULL UNIQUE
  )`,
  `CREATE TABLE members (
    member_id    NUMBER PRIMARY KEY,
    member_name  VARCHAR2(200) NOT NULL,
    officer_id   NUMBER REFERENCES officers(officer_id),
    phone        VARCHAR2(50),
    email        VARCHAR2(200),
    address      VARCHAR2(500),
    created_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at   TIMESTAMP DEFAULT SYSTIMESTAMP
  )`,
  `CREATE TABLE users (
    user_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username      VARCHAR2(100) NOT NULL UNIQUE,
    password_hash VARCHAR2(255) NOT NULL,
    created_at    TIMESTAMP DEFAULT SYSTIMESTAMP
  )`
];

const ORA_NAME_ALREADY_USED = 955;

async function run() {
  await initPool();
  const conn = await getConnection();
  try {
    for (const sql of statements) {
      try {
        await conn.execute(sql);
        console.log('Created table OK:', sql.split('\n')[0]);
      } catch (err) {
        if (err.errorNum === ORA_NAME_ALREADY_USED) {
          console.log('Table already exists, skipping:', sql.split('\n')[0]);
        } else {
          throw err;
        }
      }
    }
    await conn.commit();
  } finally {
    await conn.close();
    await closePool();
  }
}

run().catch((err) => {
  console.error('Schema creation failed:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Run the schema creation script against the real DB**

Run: `cd backend && npm run create-schema`
Expected: Output lines `Created table OK: CREATE TABLE officers (`, `... members (`, `... users (` (or "already exists" on reruns). No errors.

- [ ] **Step 5: Verify tables exist**

Run: `cd backend && node -e "require('dotenv').config(); const {initPool,getConnection,closePool}=require('./src/db/pool'); (async()=>{await initPool(); const c=await getConnection(); const r=await c.execute(\"SELECT table_name FROM user_tables WHERE table_name IN ('OFFICERS','MEMBERS','USERS') ORDER BY table_name\"); console.log(r.rows); await c.close(); await closePool();})();"`
Expected: prints 3 rows — `OFFICERS`, `MEMBERS`, `USERS`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db backend/src/scripts/create-schema.js
git commit -m "feat: add Oracle connection pool and schema creation script"
```

---

### Task 3: Auth — password hashing, JWT login route, auth middleware

**Files:**
- Create: `backend/src/routes/auth.js`
- Create: `backend/src/middleware/auth.js`
- Modify: `backend/src/app.js`
- Test: `backend/tests/auth.test.js`

**Interfaces:**
- Consumes: `getConnection()` from `backend/src/db/pool.js` (Task 2); `users` table (Task 2).
- Produces: `backend/src/middleware/auth.js` exports `requireAuth(req, res, next)` Express middleware that sets `req.user = { userId, username }` on success — used by `officers.js` and `members.js` route mounts in Tasks 5–6. `POST /api/auth/login` accepts `{ username, password }`, returns `{ token }`.

- [ ] **Step 1: Create `backend/src/middleware/auth.js`**

```javascript
const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { userId: payload.userId, username: payload.username };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth };
```

- [ ] **Step 2: Create `backend/src/routes/auth.js`**

```javascript
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getConnection } = require('../db/pool');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const conn = await getConnection();
  try {
    const result = await conn.execute(
      `SELECT user_id, username, password_hash FROM users WHERE username = :username`,
      { username }
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const match = await bcrypt.compare(password, user.PASSWORD_HASH);
    if (!match) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { userId: user.USER_ID, username: user.USERNAME },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token });
  } finally {
    await conn.close();
  }
});

module.exports = router;
```

- [ ] **Step 3: Mount the auth router in `backend/src/app.js`**

Add the import and mount alongside the existing health router:

```javascript
const authRouter = require('./routes/auth');
// ...
app.use('/api/auth', authRouter);
```

- [ ] **Step 4: Write the failing test — `backend/tests/auth.test.js`**

This test seeds its own user directly via SQL (bypassing the seed script, which is built in Task 4) so it's self-contained, and cleans up after itself.

```javascript
const request = require('supertest');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const createApp = require('../src/app');
const { initPool, closePool, getConnection } = require('../src/db/pool');

const TEST_USERNAME = 'test_auth_user';
const TEST_PASSWORD = 'Test1234!';

describe('POST /api/auth/login', () => {
  let app;

  beforeAll(async () => {
    await initPool();
    app = createApp();
    const conn = await getConnection();
    try {
      const hash = await bcrypt.hash(TEST_PASSWORD, 10);
      await conn.execute(
        `INSERT INTO users (username, password_hash) VALUES (:u, :p)`,
        { u: TEST_USERNAME, p: hash }
      );
      await conn.commit();
    } finally {
      await conn.close();
    }
  });

  afterAll(async () => {
    const conn = await getConnection();
    try {
      await conn.execute(`DELETE FROM users WHERE username = :u`, { u: TEST_USERNAME });
      await conn.commit();
    } finally {
      await conn.close();
    }
    await closePool();
  });

  it('returns a token for correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });

  it('rejects incorrect password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: TEST_USERNAME, password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('rejects missing fields', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 5: Run the test**

Run: `cd backend && npm test -- auth.test.js`
Expected: PASS (3 tests). Requires the Oracle DB from Task 2 to be reachable.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/auth.js backend/src/middleware/auth.js backend/src/app.js backend/tests/auth.test.js
git commit -m "feat: add JWT login route and auth middleware"
```

---

### Task 4: Admin user seed script

**Files:**
- Create: `backend/src/scripts/seed-admin.js`

**Interfaces:**
- Consumes: `getConnection()` (Task 2), `users` table (Task 2).
- Produces: a `users` row usable by `/api/auth/login` (Task 3). CLI script, no exports consumed by other tasks.

- [ ] **Step 1: Create `backend/src/scripts/seed-admin.js`**

Reads `--username` and `--password` from CLI args (no interactive prompt, so it works non-interactively too).

```javascript
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initPool, closePool, getConnection } = require('../db/pool');

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--username') result.username = args[i + 1];
    if (args[i] === '--password') result.password = args[i + 1];
  }
  return result;
}

async function run() {
  const { username, password } = parseArgs();
  if (!username || !password) {
    console.error('Usage: node src/scripts/seed-admin.js --username <name> --password <pass>');
    process.exit(1);
  }

  await initPool();
  const conn = await getConnection();
  try {
    const existing = await conn.execute(
      `SELECT user_id FROM users WHERE username = :u`,
      { u: username }
    );
    if (existing.rows.length > 0) {
      console.log(`User "${username}" already exists — skipping.`);
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    await conn.execute(
      `INSERT INTO users (username, password_hash) VALUES (:u, :p)`,
      { u: username, p: hash }
    );
    await conn.commit();
    console.log(`Admin user "${username}" created.`);
  } finally {
    await conn.close();
    await closePool();
  }
}

run().catch((err) => {
  console.error('Seed admin failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it to create the real admin user**

Run: `cd backend && node src/scripts/seed-admin.js --username admin --password "<choose-a-real-password>"`
Expected: `Admin user "admin" created.`

- [ ] **Step 3: Verify login works end-to-end**

Run: `cd backend && npm start` (in one terminal), then in another:
`curl -X POST http://localhost:5000/api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"<same-password>\"}"`
Expected: JSON response with a `token` field. Stop the server after checking (Ctrl+C).

- [ ] **Step 4: Commit**

```bash
git add backend/src/scripts/seed-admin.js
git commit -m "feat: add admin user seed script"
```

---

### Task 5: Officers route

**Files:**
- Create: `backend/src/routes/officers.js`
- Modify: `backend/src/app.js`
- Test: `backend/tests/officers.test.js`

**Interfaces:**
- Consumes: `requireAuth` (Task 3), `getConnection()` (Task 2), `officers` table (Task 2).
- Produces: `GET /api/officers` → `[{ officerId, officerName }]`, consumed by the frontend officer dropdown (Task 11).

- [ ] **Step 1: Create `backend/src/routes/officers.js`**

```javascript
const express = require('express');
const { getConnection } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const conn = await getConnection();
  try {
    const result = await conn.execute(
      `SELECT officer_id, officer_name FROM officers ORDER BY officer_name`
    );
    const officers = result.rows.map((row) => ({
      officerId: row.OFFICER_ID,
      officerName: row.OFFICER_NAME
    }));
    res.json(officers);
  } finally {
    await conn.close();
  }
});

module.exports = router;
```

- [ ] **Step 2: Mount it in `backend/src/app.js`**

```javascript
const officersRouter = require('./routes/officers');
// ...
app.use('/api/officers', officersRouter);
```

- [ ] **Step 3: Write the failing test — `backend/tests/officers.test.js`**

```javascript
const request = require('supertest');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const createApp = require('../src/app');
const { initPool, closePool, getConnection } = require('../src/db/pool');

const TEST_OFFICER = 'Test Officer For Jest';

function tokenFor(userId, username) {
  return jwt.sign({ userId, username }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

describe('GET /api/officers', () => {
  let app;
  const token = tokenFor(1, 'tester');

  beforeAll(async () => {
    await initPool();
    app = createApp();
    const conn = await getConnection();
    try {
      await conn.execute(
        `INSERT INTO officers (officer_name) VALUES (:n)`,
        { n: TEST_OFFICER }
      );
      await conn.commit();
    } finally {
      await conn.close();
    }
  });

  afterAll(async () => {
    const conn = await getConnection();
    try {
      await conn.execute(`DELETE FROM officers WHERE officer_name = :n`, { n: TEST_OFFICER });
      await conn.commit();
    } finally {
      await conn.close();
    }
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
  });
});
```

- [ ] **Step 4: Run the test**

Run: `cd backend && npm test -- officers.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/officers.js backend/src/app.js backend/tests/officers.test.js
git commit -m "feat: add officers list route"
```

---

### Task 6: Members CRUD routes

**Files:**
- Create: `backend/src/routes/members.js`
- Modify: `backend/src/app.js`
- Test: `backend/tests/members.test.js`

**Interfaces:**
- Consumes: `requireAuth` (Task 3), `getConnection()` (Task 2), `members`/`officers` tables (Task 2).
- Produces:
  - `GET /api/members?search=&page=&pageSize=` → `{ items: [{memberId, memberName, officerId, officerName, phone, email, address}], total, page, pageSize }`
  - `POST /api/members` body `{ memberId, memberName, officerId, phone, email, address }` → 201 with created member
  - `GET /api/members/:id` → member or 404
  - `PUT /api/members/:id` body same shape as POST (memberId not required in body) → updated member
  - `DELETE /api/members/:id` → 204
  - Consumed by frontend MembersList and MemberForm pages (Tasks 11–12).

- [ ] **Step 1: Create `backend/src/routes/members.js`**

```javascript
const express = require('express');
const { getConnection } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function toMember(row) {
  return {
    memberId: row.MEMBER_ID,
    memberName: row.MEMBER_NAME,
    officerId: row.OFFICER_ID,
    officerName: row.OFFICER_NAME,
    phone: row.PHONE,
    email: row.EMAIL,
    address: row.ADDRESS
  };
}

router.get('/', async (req, res) => {
  const search = (req.query.search || '').trim();
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);
  const offset = (page - 1) * pageSize;

  const conn = await getConnection();
  try {
    const whereClause = search ? `WHERE LOWER(m.member_name) LIKE :search` : '';
    const binds = search ? { search: `%${search.toLowerCase()}%` } : {};

    const countResult = await conn.execute(
      `SELECT COUNT(*) AS total FROM members m ${whereClause}`,
      binds
    );
    const total = countResult.rows[0].TOTAL;

    const listResult = await conn.execute(
      `SELECT m.member_id, m.member_name, m.officer_id, o.officer_name,
              m.phone, m.email, m.address
       FROM members m
       LEFT JOIN officers o ON o.officer_id = m.officer_id
       ${whereClause}
       ORDER BY m.member_id
       OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
      { ...binds, offset, pageSize }
    );

    res.json({
      items: listResult.rows.map(toMember),
      total,
      page,
      pageSize
    });
  } finally {
    await conn.close();
  }
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const conn = await getConnection();
  try {
    const result = await conn.execute(
      `SELECT m.member_id, m.member_name, m.officer_id, o.officer_name,
              m.phone, m.email, m.address
       FROM members m
       LEFT JOIN officers o ON o.officer_id = m.officer_id
       WHERE m.member_id = :id`,
      { id }
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    res.json(toMember(result.rows[0]));
  } finally {
    await conn.close();
  }
});

function validateBody(body, { requireMemberId }) {
  if (requireMemberId && (body.memberId === undefined || body.memberId === null)) {
    return 'memberId is required';
  }
  if (!body.memberName || !body.memberName.trim()) {
    return 'memberName is required';
  }
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return 'email is not a valid email address';
  }
  return null;
}

router.post('/', async (req, res) => {
  const body = req.body || {};
  const error = validateBody(body, { requireMemberId: true });
  if (error) return res.status(400).json({ error });

  const conn = await getConnection();
  try {
    await conn.execute(
      `INSERT INTO members (member_id, member_name, officer_id, phone, email, address)
       VALUES (:memberId, :memberName, :officerId, :phone, :email, :address)`,
      {
        memberId: body.memberId,
        memberName: body.memberName,
        officerId: body.officerId || null,
        phone: body.phone || null,
        email: body.email || null,
        address: body.address || null
      }
    );
    await conn.commit();

    const created = await conn.execute(
      `SELECT m.member_id, m.member_name, m.officer_id, o.officer_name,
              m.phone, m.email, m.address
       FROM members m
       LEFT JOIN officers o ON o.officer_id = m.officer_id
       WHERE m.member_id = :id`,
      { id: body.memberId }
    );
    res.status(201).json(toMember(created.rows[0]));
  } catch (err) {
    if (err.errorNum === 1) {
      return res.status(400).json({ error: 'memberId already exists' });
    }
    throw err;
  } finally {
    await conn.close();
  }
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const error = validateBody(body, { requireMemberId: false });
  if (error) return res.status(400).json({ error });

  const conn = await getConnection();
  try {
    const result = await conn.execute(
      `UPDATE members
       SET member_name = :memberName,
           officer_id = :officerId,
           phone = :phone,
           email = :email,
           address = :address,
           updated_at = SYSTIMESTAMP
       WHERE member_id = :id`,
      {
        memberName: body.memberName,
        officerId: body.officerId || null,
        phone: body.phone || null,
        email: body.email || null,
        address: body.address || null,
        id
      }
    );
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    await conn.commit();

    const updated = await conn.execute(
      `SELECT m.member_id, m.member_name, m.officer_id, o.officer_name,
              m.phone, m.email, m.address
       FROM members m
       LEFT JOIN officers o ON o.officer_id = m.officer_id
       WHERE m.member_id = :id`,
      { id }
    );
    res.json(toMember(updated.rows[0]));
  } finally {
    await conn.close();
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const conn = await getConnection();
  try {
    const result = await conn.execute(`DELETE FROM members WHERE member_id = :id`, { id });
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    await conn.commit();
    res.status(204).send();
  } finally {
    await conn.close();
  }
});

module.exports = router;
```

- [ ] **Step 2: Mount it in `backend/src/app.js`**

```javascript
const membersRouter = require('./routes/members');
// ...
app.use('/api/members', membersRouter);
```

- [ ] **Step 3: Write the failing test — `backend/tests/members.test.js`**

```javascript
const request = require('supertest');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const createApp = require('../src/app');
const { initPool, closePool, getConnection } = require('../src/db/pool');

function tokenFor() {
  return jwt.sign({ userId: 1, username: 'tester' }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

const TEST_ID = 999001;

describe('/api/members CRUD', () => {
  let app;
  const token = tokenFor();

  beforeAll(async () => {
    await initPool();
    app = createApp();
  });

  afterEach(async () => {
    const conn = await getConnection();
    try {
      await conn.execute(`DELETE FROM members WHERE member_id = :id`, { id: TEST_ID });
      await conn.commit();
    } finally {
      await conn.close();
    }
  });

  afterAll(async () => {
    await closePool();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/members');
    expect(res.status).toBe(401);
  });

  it('creates, reads, updates, and deletes a member', async () => {
    const createRes = await request(app)
      .post('/api/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ memberId: TEST_ID, memberName: 'Jest Test Member', phone: '0710000000' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.memberId).toBe(TEST_ID);

    const getRes = await request(app)
      .get(`/api/members/${TEST_ID}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.memberName).toBe('Jest Test Member');

    const updateRes = await request(app)
      .put(`/api/members/${TEST_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ memberName: 'Jest Test Member Updated', phone: '0720000000' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.memberName).toBe('Jest Test Member Updated');

    const deleteRes = await request(app)
      .delete(`/api/members/${TEST_ID}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleteRes.status).toBe(204);

    const getAfterDelete = await request(app)
      .get(`/api/members/${TEST_ID}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getAfterDelete.status).toBe(404);
  });

  it('rejects create with missing memberName', async () => {
    const res = await request(app)
      .post('/api/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ memberId: TEST_ID });
    expect(res.status).toBe(400);
  });

  it('rejects create with invalid email', async () => {
    const res = await request(app)
      .post('/api/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ memberId: TEST_ID, memberName: 'Bad Email', email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `cd backend && npm test -- members.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: All test files PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/members.js backend/src/app.js backend/tests/members.test.js
git commit -m "feat: add members CRUD routes"
```

---

### Task 7: CSV import script

**Files:**
- Create: `backend/src/scripts/import-csv.js`

**Interfaces:**
- Consumes: `UNION_Members.csv` (repo root), `getConnection()` (Task 2), `officers`/`members` tables (Task 2).
- Produces: populated `officers` and `members` tables. CLI script, no exports consumed elsewhere.

- [ ] **Step 1: Create `backend/src/scripts/import-csv.js`**

```javascript
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { initPool, closePool, getConnection } = require('../db/pool');

const CSV_PATH = path.join(__dirname, '..', '..', '..', 'UNION_Members.csv');

async function run() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

  await initPool();
  const conn = await getConnection();
  try {
    const officerNames = [...new Set(
      records
        .map((r) => (r['Collecting Officer'] || '').trim())
        .filter((name) => name.length > 0)
    )];

    const officerIdByName = {};
    for (const name of officerNames) {
      const existing = await conn.execute(
        `SELECT officer_id FROM officers WHERE officer_name = :n`,
        { n: name }
      );
      if (existing.rows.length > 0) {
        officerIdByName[name] = existing.rows[0].OFFICER_ID;
      } else {
        const inserted = await conn.execute(
          `INSERT INTO officers (officer_name) VALUES (:n) RETURNING officer_id INTO :id`,
          { n: name, id: { dir: require('oracledb').BIND_OUT, type: require('oracledb').NUMBER } }
        );
        officerIdByName[name] = inserted.outBinds.id[0];
      }
    }
    await conn.commit();

    let imported = 0;
    let skipped = 0;
    for (const record of records) {
      const memberId = Number(record['Member ID']);
      const memberName = (record['Member Name'] || '').trim();
      const officerName = (record['Collecting Officer'] || '').trim();
      if (!memberId || !memberName) {
        skipped += 1;
        continue;
      }

      const exists = await conn.execute(
        `SELECT member_id FROM members WHERE member_id = :id`,
        { id: memberId }
      );
      if (exists.rows.length > 0) {
        skipped += 1;
        continue;
      }

      await conn.execute(
        `INSERT INTO members (member_id, member_name, officer_id)
         VALUES (:memberId, :memberName, :officerId)`,
        {
          memberId,
          memberName,
          officerId: officerIdByName[officerName] || null
        }
      );
      imported += 1;
    }
    await conn.commit();

    console.log(`Officers created/matched: ${officerNames.length}`);
    console.log(`Members imported: ${imported}, skipped (duplicate or invalid): ${skipped}`);
  } finally {
    await conn.close();
    await closePool();
  }
}

run().catch((err) => {
  console.error('CSV import failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add `csv-parse` sync import path (already a dependency from Task 1) — install if needed**

Run: `cd backend && npm ls csv-parse`
Expected: `csv-parse@5.x` listed (installed in Task 1). If missing, run `npm install csv-parse`.

- [ ] **Step 3: Run the import against the real DB**

Run: `cd backend && npm run import-csv`
Expected: `Officers created/matched: <N officers>` and `Members imported: 359, skipped (duplicate or invalid): 0` on first run.

- [ ] **Step 4: Verify row counts in the DB**

Run: `cd backend && node -e "require('dotenv').config(); const {initPool,getConnection,closePool}=require('./src/db/pool'); (async()=>{await initPool(); const c=await getConnection(); const m=await c.execute('SELECT COUNT(*) AS c FROM members'); const o=await c.execute('SELECT COUNT(*) AS c FROM officers'); console.log('members:', m.rows[0].C, 'officers:', o.rows[0].C); await c.close(); await closePool();})();"`
Expected: `members: 359 officers: <N>`

- [ ] **Step 5: Re-run the import to confirm it's idempotent**

Run: `cd backend && npm run import-csv`
Expected: `Members imported: 0, skipped (duplicate or invalid): 359` — no duplicate rows created.

- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/import-csv.js
git commit -m "feat: add CSV import script for union members data"
```

---

### Task 8: Frontend scaffold (Vite + React + Router)

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.js`
- Create: `frontend/index.html`
- Create: `frontend/.gitignore`
- Create: `frontend/src/main.jsx`
- Create: `frontend/src/App.jsx`
- Create: `frontend/src/styles.css`

**Interfaces:**
- Produces: `frontend/src/App.jsx` default-exports the root `<App />` component with `react-router-dom` routes `/login`, `/` — routes populated in Tasks 10–11.

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "union-members-frontend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `frontend/vite.config.js`**

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000'
    }
  }
});
```

- [ ] **Step 3: Create `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Union Members</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `frontend/.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 5: Create `frontend/src/styles.css`**

```css
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  background: #f5f6f8;
  color: #1a1a1a;
}
.container { max-width: 960px; margin: 0 auto; padding: 24px; }
.card {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  padding: 24px;
}
input, select {
  display: block;
  width: 100%;
  padding: 8px 10px;
  margin-bottom: 14px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 14px;
}
label { font-weight: 600; font-size: 13px; margin-bottom: 4px; display: block; }
button {
  background: #2c5f8a;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}
button.secondary { background: #888; }
button.danger { background: #b3382c; }
button:disabled { opacity: 0.6; cursor: not-allowed; }
table { width: 100%; border-collapse: collapse; margin-top: 16px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eee; font-size: 14px; }
.error { color: #b3382c; font-size: 13px; margin-bottom: 10px; }
.topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.actions button { margin-right: 6px; }
```

- [ ] **Step 6: Create `frontend/src/App.jsx`** (placeholder routes, filled in Tasks 10–11)

```jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';

function Placeholder({ text }) {
  return <div className="container"><div className="card">{text}</div></div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Placeholder text="Login page coming in Task 10" />} />
        <Route path="/" element={<Placeholder text="Members list coming in Task 11" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 7: Create `frontend/src/main.jsx`**

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 8: Install dependencies and verify the dev server boots**

Run: `cd frontend && npm install && npm run dev -- --port 5173`
Expected: Vite prints `Local: http://localhost:5173/`. Open it in a browser — you should see "Members list coming in Task 11" (the `/` route). Stop the server (Ctrl+C) after confirming.

- [ ] **Step 9: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.js frontend/index.html frontend/.gitignore frontend/src
git commit -m "feat: scaffold Vite React frontend with routing shell"
```

---

### Task 9: API client and auth context

**Files:**
- Create: `frontend/src/api/client.js`
- Create: `frontend/src/context/AuthContext.jsx`
- Create: `frontend/src/routes/ProtectedRoute.jsx`

**Interfaces:**
- Produces:
  - `frontend/src/api/client.js` exports `apiFetch(path, options)` — wraps `fetch`, prefixes `/api`, attaches JWT from `AuthContext`'s stored token, throws `Error` with the server's `error` message on non-2xx.
  - `frontend/src/context/AuthContext.jsx` exports `AuthProvider` and `useAuth()` returning `{ token, login(username, password), logout() }`.
  - `frontend/src/routes/ProtectedRoute.jsx` exports default `ProtectedRoute` — redirects to `/login` if `useAuth().token` is falsy.
  - Consumed by Login (Task 10) and MembersList/MemberForm (Task 11).

- [ ] **Step 1: Create `frontend/src/api/client.js`**

```javascript
const TOKEN_KEY = 'union_members_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  const res = await fetch(`/api${path}`, { ...options, headers });

  if (res.status === 204) return null;

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : null;

  if (!res.ok) {
    throw new Error(body?.error || `Request failed with status ${res.status}`);
  }
  return body;
}
```

- [ ] **Step 2: Create `frontend/src/context/AuthContext.jsx`**

```jsx
import { createContext, useContext, useState, useCallback } from 'react';
import { apiFetch, getToken, setToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(getToken());

  const login = useCallback(async (username, password) => {
    const result = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    setToken(result.token);
    setTokenState(result.token);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setTokenState(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

- [ ] **Step 3: Create `frontend/src/routes/ProtectedRoute.jsx`**

```jsx
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return children;
}
```

- [ ] **Step 4: Wire `AuthProvider` into `frontend/src/App.jsx`**

Replace the file with:

```jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import './styles.css';

function Placeholder({ text }) {
  return <div className="container"><div className="card">{text}</div></div>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Placeholder text="Login page coming in Task 10" />} />
          <Route path="/" element={<Placeholder text="Members list coming in Task 11" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

- [ ] **Step 5: Verify the app still boots**

Run: `cd frontend && npm run dev -- --port 5173`
Expected: same placeholder page loads with no console errors. Stop the server after confirming.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api frontend/src/context frontend/src/routes frontend/src/App.jsx
git commit -m "feat: add API client and auth context"
```

---

### Task 10: Login page

**Files:**
- Create: `frontend/src/pages/Login.jsx`
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: `useAuth()` (Task 9).
- Produces: `/login` route renders `Login`, redirects to `/` on success.

- [ ] **Step 1: Create `frontend/src/pages/Login.jsx`**

```jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 380, marginTop: 80 }}>
      <div className="card">
        <h2>Union Members Login</h2>
        {error && <div className="error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <label htmlFor="username">Username</label>
          <input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" disabled={submitting}>
            {submitting ? 'Logging in...' : 'Log In'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `frontend/src/App.jsx`**

```jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Login from './pages/Login';
import './styles.css';

function Placeholder({ text }) {
  return <div className="container"><div className="card">{text}</div></div>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Placeholder text="Members list coming in Task 11" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

- [ ] **Step 3: Manual verification**

Run backend (`cd backend && npm start`) and frontend (`cd frontend && npm run dev -- --port 5173`) together. Open `http://localhost:5173/login`, log in with the admin credentials from Task 4.
Expected: successful login navigates to `/` and shows the "Members list coming in Task 11" placeholder; wrong password shows an inline error message. Stop both servers after confirming.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Login.jsx frontend/src/App.jsx
git commit -m "feat: add login page"
```

---

### Task 11: Members list page (search, pagination, delete)

**Files:**
- Create: `frontend/src/pages/MembersList.jsx`
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 9), `useAuth()` (Task 9), `GET /api/members` (Task 6).
- Produces: `/` route (wrapped in `ProtectedRoute`) renders `MembersList`; links to `/members/new` and `/members/:id/edit` (built in Task 12).

- [ ] **Step 1: Create `frontend/src/pages/MembersList.jsx`**

```jsx
import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';

const PAGE_SIZE = 20;

export default function MembersList() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (currentPage, currentSearch) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(currentPage),
        pageSize: String(PAGE_SIZE),
        search: currentSearch
      });
      const result = await apiFetch(`/members?${params.toString()}`);
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page, search);
  }, [load, page, search]);

  async function handleDelete(memberId) {
    if (!window.confirm(`Delete member ${memberId}?`)) return;
    try {
      await apiFetch(`/members/${memberId}`, { method: 'DELETE' });
      load(page, search);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <div className="container">
      <div className="topbar">
        <h2>Union Members</h2>
        <div>
          <Link to="/members/new"><button>Add Member</button></Link>{' '}
          <button className="secondary" onClick={handleLogout}>Log Out</button>
        </div>
      </div>
      <div className="card">
        <input
          placeholder="Search by name..."
          value={search}
          onChange={(e) => { setPage(1); setSearch(e.target.value); }}
        />
        {error && <div className="error">{error}</div>}
        {loading ? (
          <div>Loading...</div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>ID</th><th>Name</th><th>Officer</th><th>Phone</th><th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.memberId}>
                    <td>{m.memberId}</td>
                    <td>{m.memberName}</td>
                    <td>{m.officerName || '-'}</td>
                    <td>{m.phone || '-'}</td>
                    <td className="actions">
                      <Link to={`/members/${m.memberId}/edit`}><button>Edit</button></Link>
                      <button className="danger" onClick={() => handleDelete(m.memberId)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 12 }}>
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>{' '}
              <span>Page {page} of {totalPages}</span>{' '}
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `frontend/src/App.jsx`**

```jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './routes/ProtectedRoute';
import Login from './pages/Login';
import MembersList from './pages/MembersList';
import './styles.css';

function Placeholder({ text }) {
  return <div className="container"><div className="card">{text}</div></div>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><MembersList /></ProtectedRoute>} />
          <Route path="/members/new" element={<Placeholder text="Add member form coming in Task 12" />} />
          <Route path="/members/:id/edit" element={<Placeholder text="Edit member form coming in Task 12" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

- [ ] **Step 3: Manual verification**

With backend and frontend running (and the CSV imported in Task 7), log in and confirm the members table loads real data, search filters by name, pagination buttons move between pages, and Delete removes a row (test on a throwaway row, or re-import after — don't delete real data casually).
Expected: table shows imported members; search/pagination/delete all work against the live API.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/MembersList.jsx frontend/src/App.jsx
git commit -m "feat: add members list page with search, pagination, delete"
```

---

### Task 12: Add/Edit member form page

**Files:**
- Create: `frontend/src/pages/MemberForm.jsx`
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 9), `GET /api/officers` (Task 5), `GET/POST/PUT /api/members` (Task 6).
- Produces: `/members/new` and `/members/:id/edit` routes; on save, navigates back to `/`.

- [ ] **Step 1: Create `frontend/src/pages/MemberForm.jsx`**

```jsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../api/client';

const emptyForm = { memberId: '', memberName: '', officerId: '', phone: '', email: '', address: '' };

export default function MemberForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [officers, setOfficers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch('/officers').then(setOfficers).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    apiFetch(`/members/${id}`)
      .then((m) => setForm({
        memberId: String(m.memberId),
        memberName: m.memberName,
        officerId: m.officerId ? String(m.officerId) : '',
        phone: m.phone || '',
        email: m.email || '',
        address: m.address || ''
      }))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    const payload = {
      memberName: form.memberName,
      officerId: form.officerId ? Number(form.officerId) : null,
      phone: form.phone,
      email: form.email,
      address: form.address
    };
    try {
      if (isEdit) {
        await apiFetch(`/members/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/members', {
          method: 'POST',
          body: JSON.stringify({ ...payload, memberId: Number(form.memberId) })
        });
      }
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="container"><div className="card">Loading...</div></div>;

  return (
    <div className="container" style={{ maxWidth: 480 }}>
      <div className="card">
        <h2>{isEdit ? 'Edit Member' : 'Add Member'}</h2>
        {error && <div className="error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <label htmlFor="memberId">Member ID</label>
          <input
            id="memberId"
            value={form.memberId}
            disabled={isEdit}
            onChange={(e) => update('memberId', e.target.value)}
          />

          <label htmlFor="memberName">Member Name</label>
          <input
            id="memberName"
            value={form.memberName}
            onChange={(e) => update('memberName', e.target.value)}
          />

          <label htmlFor="officerId">Collecting Officer</label>
          <select id="officerId" value={form.officerId} onChange={(e) => update('officerId', e.target.value)}>
            <option value="">-- none --</option>
            {officers.map((o) => (
              <option key={o.officerId} value={o.officerId}>{o.officerName}</option>
            ))}
          </select>

          <label htmlFor="phone">Phone</label>
          <input id="phone" value={form.phone} onChange={(e) => update('phone', e.target.value)} />

          <label htmlFor="email">Email</label>
          <input id="email" value={form.email} onChange={(e) => update('email', e.target.value)} />

          <label htmlFor="address">Address</label>
          <input id="address" value={form.address} onChange={(e) => update('address', e.target.value)} />

          <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>{' '}
          <button type="button" className="secondary" onClick={() => navigate('/')}>Cancel</button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `frontend/src/App.jsx`**

```jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './routes/ProtectedRoute';
import Login from './pages/Login';
import MembersList from './pages/MembersList';
import MemberForm from './pages/MemberForm';
import './styles.css';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><MembersList /></ProtectedRoute>} />
          <Route path="/members/new" element={<ProtectedRoute><MemberForm /></ProtectedRoute>} />
          <Route path="/members/:id/edit" element={<ProtectedRoute><MemberForm /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

- [ ] **Step 3: Full manual walkthrough**

With backend and frontend running: log in → view members list → click "Add Member", create a new member with a fresh ID (e.g. `999999`) and full contact fields → confirm it appears in the list → click "Edit" on it, change the name/officer → confirm the update shows in the list → click "Delete" on it → confirm it's gone. Also test validation: try adding a member with no name (should show inline error) and an invalid email (should show inline error).
Expected: every step behaves as described, matching spec's Frontend and Error Handling sections.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/MemberForm.jsx frontend/src/App.jsx
git commit -m "feat: add member add/edit form page"
```

---

### Task 13: Root README and setup docs

**Files:**
- Create: `README.md`

**Interfaces:**
- None — documentation only.

- [ ] **Step 1: Create `README.md`**

```markdown
# Union Members Management App

Replaces `UNION_Members.csv` with a login-gated web app backed by Oracle DB.
See `docs/superpowers/specs/2026-08-16-union-members-app-design.md` for the
full design.

## Prerequisites

- Node.js 18+
- Oracle DB reachable at the connection string in `backend/.env`
  (`node-oracledb` runs in thin mode — no Instant Client install needed)

## First-time setup

```bash
cd backend
npm install
npm run create-schema      # creates officers/members/users tables
npm run seed-admin -- --username admin --password <choose-a-password>
npm run import-csv         # loads UNION_Members.csv into officers/members

cd ../frontend
npm install
```

## Running

Backend (port 5000):
```bash
cd backend && npm start
```

Frontend (port 5173, proxies /api to backend):
```bash
cd frontend && npm run dev
```

Open http://localhost:5173 and log in with the admin credentials created above.

## Tests

Backend tests run against the real Oracle DB configured in `backend/.env`:
```bash
cd backend && npm test
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add setup and run instructions"
```

---

## Self-Review Notes

- Spec coverage checked: architecture (Tasks 1–2, 8), data model + migration (Tasks 2, 7), auth (Tasks 3–4), API (Tasks 5–6), frontend (Tasks 9–12), error handling (validation in Task 6, inline errors in Tasks 10/12), testing (Tasks 1, 3, 5, 6 automated; Tasks 10–12 manual per spec scope), setup notes (Tasks 4, 13) — all covered.
- `oracledb.getPool()` throws when no pool exists; Task 2 Step 2 corrects the naive truthiness check from Step 1 before any other task depends on `pool.js`.
- Route/table field names (`officerId`/`officerName` camelCase in API vs `OFFICER_ID`/`OFFICER_NAME` from Oracle's default uppercase column names) are consistent across Tasks 5, 6, 11, 12.

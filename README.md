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

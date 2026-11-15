# Union Members Management App

Samithiya management web app (PostgreSQL + Node/Express + React). Replaces
`UNION_Members.csv`. Features:

- Members, collecting officers, family members (dependents) and deaths with the
  amount the samithiya paid out
- Yearly dues per member: Rs 250 per month + Rs 100 yearly membership
  (Rs 3,100 a year), with Paid / Partly paid / Not paid status and a receipt
  number recorded against every payment
- Receipt books per collecting officer (e.g. 1000–1100): receipt numbers are
  issued in order and are unique across officers
- Equipment (chairs, tables…): stock levels, separate member / visitor prices
  (admin editable), rent-out and return tracking
- Yearly report: fees + rentals − death benefits − other expenses = profit
- Dashboard with collection progress, month-by-month chart, insights and alerts
- Safeguards: login lockout, change-password (signs out other sessions), an **Activity** log of
  every payment / void / fee change / deletion, voids that need a reason, and fee history by year
  (changing a fee never rewrites earlier years)

Fees are editable on the Reports page. See
`docs/superpowers/specs/2026-08-16-union-members-app-design.md` for the
original design.

## Prerequisites

- Node.js 18+
- PostgreSQL 13+ with an empty database (e.g. `samithiya`); connection details
  go in `backend/.env` (copy `backend/.env.example`)

## First-time setup

```bash
cd backend
npm install
npm run create-schema      # creates all pm_* tables (safe to re-run)
ADMIN_PASSWORD='<at least 10 characters>' npm run seed-admin -- --username admin
npm run import-csv         # loads UNION_Members.csv into pm_officers/pm_members

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

Backend tests run against the real PostgreSQL DB configured in `backend/.env`
(use a development database — tests create and delete rows prefixed `T-FEAT` /
`T-SEC` / `Jest`; they refuse to run if `.env` says `NODE_ENV=production`):
```bash
cd backend && npm test
```

## Deployment

The app runs in Docker on the DOK shared server at **https://union.testsys.shop**
(own database container, shared nginx, SSL, backups). Follow
[deploy/dok/DEPLOY-DOK.md](deploy/dok/DEPLOY-DOK.md); it uses `Dockerfile`, `docker-compose.yml`
and `.env.docker.example`.

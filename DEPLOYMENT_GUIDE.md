# Deployment Guide

Deploys Union Members Management alongside the existing IT-Asset-Management
app on the same server, under PM2 + nginx.

## Layout on the server

```
/home/UnionMangementSystem/
  backend/
  frontend/
  logs/              (created during setup, see below)
ecosystem.config.js   (this repo's root - PM2 reads it from here)
```

- **Backend port:** 5003 (IT-Asset-Management uses 5000, so this avoids collision)
- **Public URL:** http://192.168.2.199:8082 (nginx listens on 8082, proxies `/api` to `localhost:5003`)

## 1. Get the code onto the server

Copy the project (excluding `node_modules`, `.env`, `frontend/dist`, and
`.superpowers/`) to `/home/UnionMangementSystem` — e.g. via `scp`/WinSCP from
your dev machine. `node_modules` must NOT be copied across: it contains
platform-specific native bindings and has to be installed fresh on the
server (see step 2).

```bash
cd /home/UnionMangementSystem
mkdir -p logs
```

## 2. Backend setup

```bash
cd backend
npm install --production
```

Create `backend/.env` on the server (this file is gitignored — it is never
committed, so it must be created manually on every environment):

```
DB_USER=system
DB_PASSWORD=wasath123
DB_CONNECTION_STRING=localhost:1521/XEPDB1

PORT=5003
NODE_ENV=production
JWT_SECRET=<generate a new, strong secret - do NOT reuse the dev one>
```

`node-oracledb` runs in thin mode, so it does not strictly require the Oracle
Instant Client. `ecosystem.config.js` still sets `LD_LIBRARY_PATH` and
`ORACLE_HOME` to the same values as IT-Asset-Management's config, since both
apps connect to the same Oracle instance on this server and that keeps the
environment consistent between the two PM2 processes — harmless for a
thin-mode connection either way.

Run once, against the server's Oracle instance:

```bash
npm run create-schema
npm run seed-admin -- --username admin --password <choose-a-real-production-password>
npm run import-csv
```

(`create-schema` and `import-csv` are safe to re-run — both are idempotent,
skipping tables/rows that already exist.)

## 3. Frontend build

```bash
cd ../frontend
npm install
npm run build
```

This produces `frontend/dist/`, which nginx serves directly as static files
(see step 5) — the frontend has no PM2 process of its own.

## 4. Start the backend with PM2

From the repo root (`/home/UnionMangementSystem`):

```bash
pm2 start ecosystem.config.js
pm2 save
```

Check it's up:

```bash
pm2 status
curl http://localhost:5003/api/health
```

## 5. nginx

```bash
sudo cp deploy/nginx-union-members.conf /etc/nginx/sites-available/union-members
sudo ln -s /etc/nginx/sites-available/union-members /etc/nginx/sites-enabled/union-members
sudo nginx -t && sudo systemctl reload nginx
```

Then open `http://192.168.2.199:8082` and log in with the admin credentials
created in step 2.

## Updating after a code change

Copy the updated files over (excluding `node_modules`, `.env`, `frontend/dist`)
the same way as step 1, then:

```bash
cd /home/UnionMangementSystem
cd backend && npm install --production
cd ../frontend && npm install && npm run build
pm2 restart union-members-backend
```

nginx picks up the new `frontend/dist` build automatically (it just serves
static files) — no nginx reload needed unless `deploy/nginx-union-members.conf`
itself changed.

# Union Members Management App — Design Spec

Date: 2026-08-16

## Purpose

Replace the `UNION_Members.csv` spreadsheet (359 rows: Member ID, Member Name,
Collecting Officer, Contact Info) with a web application backed by Oracle DB,
so union member records can be viewed, searched, added, edited, and deleted
through a browser instead of a spreadsheet. Access is gated behind a login
page.

## Scope

- Single-tenant, single-admin-role application (no multi-role permissions).
- CRUD for union members.
- Fixed, manageable list of "Collecting Officers" used as a dropdown when
  assigning a member.
- Contact info expanded from one blank column into structured fields: phone,
  email, address.
- One-time data migration from `UNION_Members.csv` into Oracle.

Out of scope (not requested): multi-role permissions, audit history/versioning,
file/photo attachments, bulk import UI (the CSV migration is a one-time
script, not a recurring feature), email notifications.

## Architecture

- **Backend:** Node.js + Express REST API.
- **Frontend:** React single-page app.
- **Database:** Oracle DB (`localhost:1521/XEPDB1`), accessed via
  `node-oracledb` in **thin mode** — pure JavaScript driver, no Oracle
  Instant Client installation required.
- **Auth:** Username/password login issuing a JWT (`JWT_SECRET` from `.env`);
  JWT required on all member/officer API routes.
- Config via `.env`: `DB_USER`, `DB_PASSWORD`, `DB_CONNECTION_STRING`, `PORT`,
  `NODE_ENV`, `JWT_SECRET` (values already provided by the user).

```
/backend
  /src
    /db        (oracledb pool, connection setup)
    /routes    (auth, members, officers)
    /middleware (JWT auth guard)
    /scripts   (CSV import, admin user seed)
  server.js
/frontend
  /src
    /pages     (Login, MembersList, MemberForm)
    /api       (fetch wrappers)
    App.jsx
```

## Data Model

Tables are prefixed `pm_` because this app runs in a shared Oracle "system"
schema alongside other applications (e.g. IT-Asset-Management) — unprefixed
names like `users` collide with tables those other apps already own.
Auto-increment IDs (`pm_officers.officer_id`, `pm_users.user_id`) use a
sequence + `BEFORE INSERT` trigger, matching the convention used by
IT-Asset-Management's schema scripts (`setupAllTables.js`), rather than
`GENERATED ALWAYS AS IDENTITY`.

```sql
CREATE SEQUENCE pm_officers_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE pm_users_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE pm_officers (
  officer_id   NUMBER PRIMARY KEY,
  officer_name VARCHAR2(200) NOT NULL UNIQUE
);

CREATE TABLE pm_members (
  member_id    VARCHAR2(20) PRIMARY KEY, -- preserved from source CSV, not generated
  member_name  VARCHAR2(200) NOT NULL,
  officer_id   NUMBER REFERENCES pm_officers(officer_id),
  phone        VARCHAR2(50),
  email        VARCHAR2(200),
  address      VARCHAR2(500),
  created_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at   TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE TABLE pm_users (
  user_id       NUMBER PRIMARY KEY,
  username      VARCHAR2(100) NOT NULL UNIQUE,
  password_hash VARCHAR2(255) NOT NULL,
  created_at    TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE OR REPLACE TRIGGER trg_pm_officers_id
BEFORE INSERT ON pm_officers FOR EACH ROW
BEGIN IF :NEW.officer_id IS NULL THEN SELECT pm_officers_seq.NEXTVAL INTO :NEW.officer_id FROM DUAL; END IF; END;

CREATE OR REPLACE TRIGGER trg_pm_users_id
BEFORE INSERT ON pm_users FOR EACH ROW
BEGIN IF :NEW.user_id IS NULL THEN SELECT pm_users_seq.NEXTVAL INTO :NEW.user_id FROM DUAL; END IF; END;
```

`member_id` is preserved as-is from the CSV, as text, rather than auto-generated
or typed as a number — so existing member numbering stays stable. The source
data is not purely numeric: 257 of 359 rows carry an alphanumeric ID (e.g.
`008A`, `011A`), so `member_id` is `VARCHAR2(20)`, not `NUMBER`. All API and
UI code treats `member_id`/`memberId` as an opaque string, never coerced with
`Number()`. (Amended after Task 7's CSV parsing surfaced this; see the
implementation plan's ledger for the ruling.)

## Data Migration

One-time script (`backend/src/scripts/import-csv.js`):
1. Parse `UNION_Members.csv`.
2. Extract distinct `Collecting Officer` values → insert into `pm_officers`.
3. Insert each row into `pm_members`, resolving `officer_id` by name lookup.
   Contact Info column is blank in source data, so `phone`/`email`/`address`
   start empty and get filled in later via the UI.
4. Run once against a fresh schema; not part of the app's runtime.

## API

All routes under `/api`. All except `/api/auth/login` require
`Authorization: Bearer <JWT>`.

| Method | Path              | Purpose                          |
|--------|-------------------|-----------------------------------|
| POST   | /auth/login       | Verify credentials, return JWT   |
| GET    | /members          | List members (search + pagination via query params) |
| POST   | /members          | Create member                    |
| GET    | /members/:id      | Get one member                   |
| PUT    | /members/:id      | Update member                    |
| DELETE | /members/:id      | Delete member                    |
| GET    | /officers         | List officers (for dropdown)     |

Validation: `member_id` and `member_name` required on create; `email` format
checked if provided; officer must reference an existing `officer_id`.

## Frontend

- **Login page** — username/password form, stores JWT (in memory + localStorage),
  redirects to members list on success.
- **Members list page** — table of members (ID, name, officer, phone), search
  box, pagination, Edit/Delete row actions, "Add Member" button.
- **Add/Edit Member form** — fields for name, officer (dropdown from
  `/api/officers`), phone, email, address. Same form component for both
  create and edit.
- Route guard redirects to login if no valid JWT.

## Error Handling

- Backend returns consistent JSON error shape `{ error: string }` with
  appropriate HTTP status (400 validation, 401 auth, 404 not found, 500
  server error).
- Frontend surfaces API errors inline on forms; login failures show an
  inline message on the login form.

## Testing

- Backend: automated tests for auth (login success/failure) and member CRUD
  endpoints (create/read/update/delete, validation errors).
- Frontend: manual verification by running the app and walking through
  login → list → add → edit → delete once built (no automated UI test
  suite, per project scope).

## Setup Notes

- Admin user is created via a seed script (`backend/src/scripts/seed-admin.js`)
  prompting for/accepting a username and password at setup time — not
  hardcoded in source.
- `.env` values (DB connection, JWT secret, port) as already provided by the
  user; `.env` is gitignored.

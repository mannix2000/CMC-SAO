# CMC SAO Attendance System

Node.js + Express + PostgreSQL attendance system for flag ceremonies and school events.

- **Admin** imports/manages the student roster (CSV/XLSX) and creates events.
- **SSG** and **NSTP** officers each independently search the roster and mark attendance (present/late/excused/absent) for an event.
- Admin sees a combined report per event (SSG status + NSTP status + computed overall) and can export it as CSV.
- **SSG** and **NSTP** each track their own budget and expenses (income/expense entries, optionally linked to an event); admin can view/manage both and export CSV.
- Admin can customize the system name, logo, and background image under **Settings**.
- Admin sets Absent/Late fine amounts (in ₱) under **Settings**; fines are created automatically the moment an officer marks a student Absent or Late, tracked per SSG/NSTP org with paid/unpaid status.
- Admin also manages a separate **Faculty & Staff** roster. Their attendance is checked by the **NSTP officer only** (not SSG) against the same events used for students, shown alongside the student report per event, and is never subject to fines.
- Every account (admin, SSG, NSTP) can edit their own **My Profile**: username, email, nickname, profile picture, and password — reachable by clicking the username in the navbar.
- Admin manages **Organizations** (student clubs, e.g. Math Club) under **Organizations**: create an org, then add members by searching/checking students already in the roster (via CSV/XLSX import or paste). Each organization gets its own income/expense budget ledger, kept fully separate from SSG/NSTP's budgets.

## Requirements

- Node.js 18+
- A PostgreSQL database

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your PostgreSQL connection string and a session secret:
   ```
   cp .env.example .env
   ```

3. Create the database tables:
   ```
   npx prisma migrate dev --name init
   ```

4. Seed the first admin account (uses `SEED_ADMIN_USERNAME` / `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `.env`):
   ```
   npm run seed
   ```

5. Start the server:
   ```
   npm run dev
   ```
   Visit http://localhost:3000 and log in with the seeded admin account.

## Typical workflow

1. Log in as admin → **Officer Accounts** → create one SSG and one NSTP account.
2. **Students** → **Import Roster** → upload a `.csv`/`.xlsx` (or download the template first), preview, then confirm.
3. **Events** → **New Event** → set name, type, date, and which officer roles are required.
4. Log in as the SSG officer and the NSTP officer (in separate browsers/sessions) → **Events** → open the event → search and tap a status for each student.
5. Back in the admin account → **Events** → **Report** to see the combined SSG/NSTP/overall status per student, or **Export CSV**.
6. Each officer can use **Budget** to log income (e.g. school allocations) and expenses for their own organization, optionally tagging an entry to an event. Admin's **Budget** page shows both organizations' balances side by side and can filter/export by org.

## Mobile API (for the React Native app)

A stateless JSON API lives under `/api`, separate from the web app's session-cookie login. It uses JWT bearer tokens instead, since that's simpler for React Native than managing cookies.

**Auth**
- `POST /api/login` — body `{ "username": "...", "password": "..." }` → `{ token, user }`. Send the token back as `Authorization: Bearer <token>` on every other call. Token lifetime is set by `JWT_EXPIRES_IN` in `.env` (default 30 days).
- `GET /api/me` — returns the logged-in user's profile. Good for a "verify token still valid" check on app start.

**Officer endpoints** (SSG/NSTP only — admin accounts get a 403 here, same as the web app's officer routes)
- `GET /api/events` — list all events.
- `GET /api/students?q=&course=&yearLevel=&section=` — roster, with the same search/filter as the web roster page. Returns `{ students, filterOptions }`.
- `GET /api/events/:id/attendance?q=&course=&yearLevel=&section=` — roster merged with *your* org's current status for that event (`status: "present" | "absent" | "late" | "excused" | null`).
- `POST /api/events/:id/attendance/:studentId` — body `{ "status": "present" }` (or `absent`/`late`/`excused`) — marks attendance. Runs through the exact same code path as the web app, so fines still auto-apply if a fee policy is configured.

All `/api/*` responses are JSON, including errors (`{ "error": "..." }`) and 404s — unlike the rest of the app, which renders HTML error pages.

This currently covers roster + attendance marking only. If the mobile app later needs faculty attendance, budget, or fines, those would need their own `/api` endpoints added the same way.

## Notes

- Sessions are stored in Postgres itself (via `connect-pg-simple`), so no separate session store is needed.
- Roster files are parsed in memory (5MB limit) and never written to disk.
- There is no public sign-up; only an admin can create SSG/NSTP/admin accounts.

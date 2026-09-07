# IFQM - Kalpion

A multi-tenant web platform that lets employees submit workplace improvement ideas,
scores them with AI, routes them through a configurable approval chain, and rewards
contributors on a live leaderboard - turning a scattered suggestion box into a
tracked, measurable innovation pipeline.

---

## What it does

- **Capture** - a guided multi-step wizard turns a rough idea into a complete,
  structured proposal (situation, solution, business case, attachments,
  co-suggesters), with live duplicate detection.
- **Score** - every idea is rated 0-100 across six quality dimensions, using an
  optional AI provider (OpenAI/Gemini) or a built-in heuristic scorer that needs
  no API key.
- **Route** - ideas escalate one stage at a time up the author's own reporting
  line, or go to a review committee with a configurable approval threshold; SLA
  timers flag overdue reviews.
- **Reward** - points (10 submit / 25 approved / 65 implemented), leaderboards,
  challenges and community voting keep people contributing.
- **Track** - ROI and implementation tracking, analytics, CSV export, and an
  append-only audit log connect ideas to real outcomes.
- **Push** - approved ideas can be pushed to the QCMS quality system, with each
  organisation holding its own API key.

Each organisation is an isolated tenant with its own database, branding, users and
settings. Platform admins see only aggregate stats - never an organisation's idea
content.

## Signing in

An employee signs in with a username, an email address or a mobile number. The
organisation code is optional: a master login directory resolves an identifier to
its tenant, so people do not have to remember one. Platform admins sign in with
the organisation code left blank.

One-time codes are available by email and by SMS, for sign-in, password reset,
registering a new organisation, and verifying a changed mobile number.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite SPA, 7-language i18n (en, hi, mr, kn, te, ta, ml), per-tenant branding |
| Backend | Node.js + Express (modular REST API), MySQL via `mysql2` (raw SQL) |
| Database | MySQL / MariaDB - `ifqm_master` registry + a schema per tenant |
| Auth | JWT (Bearer) + bcrypt, per-account lockout, live role re-check |
| Security | Helmet, CORS allow-list, rate limiting, HTTPS/HSTS enforcement |
| AI scoring | Pluggable: OpenAI, Gemini, or built-in heuristic (default) |
| Email | ZeptoMail over SMTP or its HTTPS API, with a queued sender |
| SMS | Kaleyra over Jio DLT, with registered content templates |
| Files | Multer, tenant-scoped uploads served through an authenticated route |

## Project layout

```
ifqm/
├── backend/            # Node/Express API (runs on :4000)
│   ├── src/            # routes, controllers, services, middleware
│   ├── schema/         # tenant schema used when provisioning
│   ├── scripts/        # setup, migrate, migrate-remote, backup, provision-tenant
│   └── test/           # HTTP invariant/integration suite
├── frontend/           # React + Vite SPA (runs on :5173)
│   └── src/            # pages, components, context, i18n, services
├── db/
│   ├── master.sql      # the ifqm_master registry
│   └── migrations/     # forward-only, applied through a ledger
├── User manuals/       # end-user PDFs
└── assets/             # logo and favicon
```

## Quick start (development)

**Prerequisites:** Node.js 18 or newer (developed on 22) and MySQL/MariaDB
(for example via XAMPP).

```bash
# 1. Backend
cd backend
cp .env.example .env          # fill in JWT_SECRET and DB credentials
npm install
npm run setup                 # build the schema and apply every migration
npm run dev                   # API on http://localhost:4000

# 2. Frontend, in a second terminal
cd frontend
npm install
npm run dev                   # app on http://localhost:5173
```

`npm run setup` is idempotent. It creates `backend/.env` from the example if it
is missing, builds `ifqm_master` from `db/master.sql`, creates a schema for every
tenant in the registry, and applies all migrations - so it is equally a
first-time setup and a repair for a half-built database.

## Testing

```bash
cd backend
npm test                      # 128 cases, driving the real API
```

The suite provisions its own scratch schemas (`ifqm_test_*`) and drops them
afterwards, so it never touches development data. It forces
`STRICT_ALL_TABLES` on its sessions so local, CI and production agree about what
the database will accept.

CI runs the same suite against MariaDB 10.11 on Node 22, and builds the
frontend, on every push to `main` and every pull request.

## Database migrations

Migrations are never applied by a deploy. They are always a deliberate step.

A ledger in `ifqm_master.schema_migrations` records which file has run against
which schema, so the runner is forward-only and safe to re-run - only unrecorded
pairs are applied. Fixing a bad migration means writing a new one, not editing
one that has already run.

```bash
cd backend
npm run migrate                                   # local, from backend/.env
node scripts/migrate-remote.mjs <env-file> <ca.pem> --dry   # remote, plan only
node scripts/migrate-remote.mjs <env-file> <ca.pem>         # remote, apply
```

`migrate-remote.mjs` reads credentials from a file rather than the command line,
so a database password never reaches shell history. Give it absolute paths - it
resolves relative to its own directory. It reads `MASTER_DB_HOST` /
`MASTER_DB_USER` / `MASTER_DB_PASS`.

Files ending `_master.sql` target the registry; everything else is applied to
every tenant schema.

## Configuration

The backend reads `backend/.env` and nothing else. Environment files for each
deployment are kept at the repository root, named `.env.<half>.<target>` so it
is clear which half of the app they configure and where they belong:

| File | Half | Target |
|---|---|---|
| `.env.backend.ifqm` | backend | the IFQM server |
| `.env.frontend.ifqm` | frontend | the IFQM server, at build time |
| `.env.backend.render` | backend | Render |
| `.env.frontend.vercel` | frontend | Vercel, at build time |
| `backend/.env` | backend | local development |

Every one of them is gitignored. `backend/.env.example` is the committed
template and documents each variable; it holds no real values.

Two settings are worth knowing before a first deploy:

- `VITE_API_URL` is compiled into the frontend bundle at build time, so changing
  it needs a rebuild rather than a restart, and it must end in `/api`.
- `CORS_ORIGIN` is an exact-match allowlist, not a pattern. A trailing slash or
  the wrong scheme fails every request with a generic network error.

In production the server refuses to start with missing or unsafe secrets - a
short `JWT_SECRET`, an empty database password, a `root` database user, or a
`CORS_ORIGIN` still pointing at localhost. It prints what is wrong and exits.

## Deployment

[`DEPLOYMENT_SETTINGS.md`](DEPLOYMENT_SETTINGS.md) covers the whole of it: which
branch to deploy, the build and start commands, the settings that must agree
across the frontend and backend, mail and SMS, and how to run migrations against
a managed database.

`render.yaml` declares every backend key with `sync: false`, so no value is ever
committed.

## Documentation

- [`DEPLOYMENT_SETTINGS.md`](DEPLOYMENT_SETTINGS.md) - deploying, configuring and
  migrating
- [`User manuals/`](User%20manuals/) - end-user PDFs for the three roles:
  employee, organisation admin and platform admin
- `backend/.env.example` - every environment variable, with what it does and how
  it fails when it is wrong
- The in-app user guide at `/user-guide`, linked from the sidebar once signed in

## Maintainer

Yashas R - Jain (Deemed-to-be) University, Master of Computer Applications.

# IFQM — Kalpion

A multi-tenant web platform that lets employees submit workplace improvement ideas,
scores them with AI, routes them through a configurable approval chain, and rewards
contributors on a live leaderboard — turning a scattered suggestion box into a
tracked, measurable innovation pipeline.

> Yashas R (25MCAR0042), Adrish Chowdhury (25MCAR0153) and Bhuvan K H (25MCAR0075).

---

## What it does

- **Capture** — a guided multi-step wizard turns a rough idea into a complete,
  structured proposal (situation → solution → business case → attachments →
  co-suggesters), with live duplicate detection.
- **Score** — every idea is rated 0–100 across six quality dimensions, using an
  optional AI provider (OpenAI/Gemini) or a built-in heuristic scorer that needs
  no API key.
- **Route** — ideas escalate up the organisation hierarchy, or go to a review
  committee with a configurable approval threshold; SLA timers flag overdue reviews.
- **Reward** — points (10 submit / 25 approved / 65 implemented), leaderboards,
  challenges and community voting keep people contributing.
- **Track** — ROI and implementation tracking, analytics, CSV export, and an
  append-only audit log connect ideas to real outcomes.

Each organisation is an isolated tenant with its own database, branding, users and
settings. Platform admins see only aggregate stats — never an organisation's idea
content.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite SPA, 7-language i18n, per-tenant branding |
| Backend | Node.js + Express (modular REST API), MySQL via `mysql2` (raw SQL) |
| Database | MySQL / MariaDB — `ifqm_master` registry + per-tenant schemas |
| Auth | JWT (Bearer) + bcrypt, per-account lockout, live role re-check |
| Security | Helmet, CORS allow-list, rate limiting, HTTPS/HSTS enforcement |
| AI scoring | Pluggable: OpenAI, Gemini, or built-in heuristic (default) |
| Email / files | Nodemailer SMTP queue · Multer, tenant-scoped uploads |

## Project layout

```
ifqm/
├── backend/            # Node/Express API (runs on :4000)
│   ├── src/            # routes · controllers · services · middleware
│   ├── schema/         # tenant schema for provisioning
│   ├── scripts/        # setup, migrate, backup, provision-tenant
│   └── test/           # HTTP invariant/integration suite
├── frontend/           # React + Vite SPA (runs on :5173)
│   └── src/            # pages · components · context · i18n · services
└── docs/               # all documentation, generated PDFs and sample data
```

## Quick start (development)

**Prerequisites:** Node.js ≥ 18 (tested on 22) and MySQL (e.g. via XAMPP).

```bash
# 1. Backend
cd backend
cp .env.example .env          # fill in JWT_SECRET, DB creds (see comments in file)
npm install
npm run setup                 # create schema + seed a demo tenant
npm run dev                   # API on http://localhost:4000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev                   # app on http://localhost:5173 (proxies /api → :4000)
```

Open http://localhost:5173. Log in with an organisation code; platform admins log
in with the org code **left blank**.

## Testing

```bash
cd backend
npm test                      # drives the real API against scratch databases
```

## Deployment

Production setup — least-privilege DB user, TLS, environment hardening and
tenant provisioning — is documented in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
The server refuses to start in `production` with missing or unsafe secrets.

## Documentation

Everything lives in [`docs/`](docs/). The project root holds only what has to be
there: this file, `render.yaml` (the deployment host reads it from the root),
and configuration.

**Start here**

- [`docs/Software Architecture.docx`](docs/) — the full architecture and design
  document: requirements, diagrams, data model, API, security, operations
- [`docs/TECHNICAL_MANUAL.md`](docs/TECHNICAL_MANUAL.md) — for whoever inherits
  the code: how it fits together and why the non-obvious parts are that way
- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) — end-user guide (roles, submitting,
  reviewing, admin settings)

**Deploying and running**

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — production deployment
- [`docs/FREE_DEPLOY.md`](docs/FREE_DEPLOY.md) — zero-cost deployment
  (Vercel + Render + Aiven), including the day-two workflow
- [`docs/HOSTING_COMPARISON.md`](docs/HOSTING_COMPARISON.md) — Azure vs AWS vs
  Hostinger, with a recommendation

**Design and data**

- [`docs/PROJECT_FLOWCHART.md`](docs/PROJECT_FLOWCHART.md) — flows and timeline
- [`docs/DATA_AND_API_PRIVACY.md`](docs/DATA_AND_API_PRIVACY.md) — what is
  stored, who can read it, and what is deliberately not collected
- [`docs/VIEW_COMPARISON.md`](docs/VIEW_COMPARISON.md) — All Ideas vs the Idea Board

**Meeting follow-up**

- [`docs/MOM_29Jul2026_Changes_Implemented.md`](docs/MOM_29Jul2026_Changes_Implemented.md)
  — what was built after the 29 July review, in plain English
- [`docs/MOM_29Jul2026_Implementation_Status.md`](docs/MOM_29Jul2026_Implementation_Status.md)
  — every action item and its state

**Generated files** (rebuild with the scripts in `docs/`)

- `docs/Kalpion_User_Guide.pdf`, `docs/Kalpion_TestCases_Simple.pdf`,
  `docs/QCMS_TestCases_Simple.pdf`
- `docs/IFQM_Demo_Employees_500.xlsx` — 500 fictional employees for demos and
  testing (`node backend/scripts/generate-demo-employees.js`)
- [`docs/IFQM_Project_Overview.pptx`](docs/IFQM_Project_Overview.pptx) — project
  overview presentation

## Authors

| Name | Register No. |
|---|---|
| Yashas R | 25MCAR0042 |
| Adrish Chowdhury | 25MCAR0153 |
| Bhuvan K H | 25MCAR0075 |

Jain (Deemed-to-be) University — Master of Computer Applications (MCA).

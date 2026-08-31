# Kalpion — Technical Manual

Written for whoever inherits this codebase. It assumes you can read JavaScript
and SQL, and nothing else about the project.

Covers MOM 29 Jul 2026 §1.2, §1.3, §2.1, §3.1, §3.2 and §13.7.

**Companion documents**
| File | For |
|---|---|
| `README.md` | What the product does, quick start |
| `docs/USER_GUIDE.md` | End users (employees, org admins) |
| `docs/DEPLOYMENT.md` | Production deployment on your own server |
| `docs/FREE_DEPLOY.md` | Zero-cost deployment (Vercel + Render + Aiven) |
| `MOM_29Jul2026_Implementation_Status.md` | Every MOM item and its state |

---

## 1. System shape

```
Browser ──HTTPS──▶ React SPA (Vite build, static files)
                        │
                        │ XHR, Bearer JWT
                        ▼
                   Express API  ──▶  ifqm_master   (registry: tenants, platform
                        │                            admins, tickets, login
                        │                            activity, registrations)
                        │
                        └────────▶  ifqm_<slug>    (one schema PER ORGANISATION:
                                                     users, ideas, votes, files)
```

The single most important structural fact: **each organisation has its own
database schema.** `ifqm_master` records which organisation exists and which
schema it lives in; nothing else. A query in the app is always scoped to one
tenant's pool, so cross-tenant leakage would require a code path that
deliberately opens the wrong pool.

### Request lifecycle

1. `src/app.js` — helmet, CORS allow-list, HTTPS redirect, body parsing, the
   global per-IP rate limiter.
2. `src/routes/index.js` — mounts each route group under `/api`.
3. `src/middleware/auth.js` — decodes the JWT, **re-reads the user from the
   database on every request** (so deactivation, demotion and password reset
   take effect immediately rather than at token expiry), resolves the tenant,
   attaches `req.db` and `req.tenant`, and meters the request against the
   organisation's API quota.
4. Controller — HTTP shape only. Never contains business rules.
5. Service — all business logic; takes `db` as its first argument and never
   touches `req`/`res`. This is why services are directly testable.
6. `src/middleware/errorHandler.js` — turns `ApiError` into a JSON response and
   anything else into a generic 500 (raw driver errors disclose schema names and
   paths, so they are logged, never returned).

### Layout

```
backend/
├── server.js               boot, graceful shutdown, port-clash diagnostics
├── schema/tenant_schema.sql  ← a new organisation is built from THIS FILE ALONE
├── scripts/                setup · migrate · backup · provision-tenant
└── src/
    ├── config/             all env vars land here, plus the production guard
    ├── database/           master.js (registry) · tenant.js (per-tenant pools)
    ├── middleware/         auth · rateLimiter · tenantQuota · errorHandler
    ├── routes/             thin; one file per resource
    ├── controllers/        thin; HTTP only
    └── services/           the actual product
frontend/src/
├── pages/                  one file per route
├── components/             shared UI, Layout/ holds the shell
├── context/                Auth · Branding · Lang · Toast · Notif
├── i18n/                   en + 6 Indian languages
└── services/api.js         every server call in the app
db/
├── master.sql              registry schema + seeds
└── migrations/             NNN_name.sql, forward-only, ledgered
```

---

## 2. The rules that are not obvious

Each of these exists because the alternative failed in production. Change them
only with the reason in hand.

**`tenant_schema.sql` must stay in step with `db/migrations/`.**
`createTenant()` provisions a new organisation from that file *alone* — it never
runs the migrations. Anything a migration adds must also be born there, or every
organisation created from the UI starts life missing it. This has already caused
one outage ("Create New Organisation" died on `Unknown column
'password_changed_at'`).

**Migrations are forward-only and ledgered.** `ifqm_master.schema_migrations`
records `(db_name, filename)`. Fixing a bad migration means writing a new one —
never editing an applied file, because copies that already ran cannot be
retro-edited. Files ending `_master.sql` target the registry; everything else is
applied to every tenant schema.

**MySQL, not MariaDB.** XAMPP ships MariaDB, which accepts `ADD COLUMN IF NOT
EXISTS` and `CREATE INDEX IF NOT EXISTS`. Real MySQL 8 does not. Every guarded
DDL statement in `db/migrations/` uses the `information_schema` + `PREPARE`
idiom for that reason. Managed MySQL also defaults to `sql_mode=ANSI`, where
`"double quotes"` are identifiers — so SQL string literals must use single
quotes.

**Never `SELECT i.*` into a list response.** That is how the full text of every
idea's proposed solution ended up in every employee's browser. `ideaService`
redacts on the way out; see §4 below.

**Passwords are compared asynchronously.** `bcryptjs`'s sync variant pins the
event loop for the full ~250 ms of key stretching, during which the process
serves nobody. A 9 a.m. sign-in surge made login latency the whole API's latency.

**Login always burns a bcrypt compare,** even for an unknown account
(`DUMMY_HASH`). Short-circuiting answered "no such user" in 5 ms and "wrong
password" in 250 ms, so response time alone enumerated who worked there.

**The platform console cannot see inside a tenant.** `platformService` has a
written privacy contract at the top of the file: aggregate counts and the org's
own admin contact, never an employee row, an idea's content, or a file. Two
endpoints were removed for violating it.

---

## 3. Data model, in brief

**Registry — `ifqm_master`**

| Table | Holds |
|---|---|
| `tenants` | One row per organisation: slug, domain, schema name, status, `last_login_at`, quota overrides |
| `platform_admins` | IFQM staff. Soft-capped at 5 (§12.11) |
| `tenant_registrations` | MSME self-signup queue (§9) |
| `platform_login_activity` | Append-only sign-in record (§12.12) |
| `tenant_api_usage` | Per-tenant request counters (§8.3) |
| `login_attempts` | Brute-force lockout state (cleared on success — not an audit trail) |
| `support_tickets` | Every org's tickets, plus `archived_at` (§12.3) |
| `platform_settings` | Platform-wide defaults |

**Per organisation — `ifqm_<slug>`**

`users` · `ideas` · `idea_attachments` · `idea_co_suggesters` · `idea_workflow`
(append-only audit) · `idea_reviewers` · `idea_votes` · `idea_community_votes` ·
`idea_comments` · `challenges` · `idea_categories` · `notifications` ·
`org_settings` · `email_queue` · `password_reset_tokens` · `user_import_jobs`.

`ideas` is the centre of gravity. Note that several columns are deliberately
separate rather than merged:

- `expected_implementation_date` (submitter's estimate) vs
  `implementation_target_date` (what the owner commits to after approval)
- `implementation_duration` (free text, legacy) vs `time_required` (fixed bands,
  MOM §14.5) — the free-text column holds real data on older ideas and cannot be
  coerced
- `patentability` is its own axis, not a status: an idea can be approved and
  unpatentable, or rejected and still worth filing
- `archived_at` is a filter, not a delete — points, audit trail and ROI survive

---

## 4. Two rules worth understanding before changing anything

### Solution visibility (§13.1, §11.4)

The proposal text is the intellectual contribution. Publishing it to the whole
organisation on filing lets anyone restate it as their own before the original is
even reviewed.

- The **list** endpoint never sends a full solution to anyone. It sends
  `solution_summary` (first sentence) and `solution_redacted`.
- The **detail** endpoint redacts unless the viewer is the author, a
  co-suggester, an assigned or current reviewer, or a manager and above.
- The org admin chooses the mode: `authors_reviewers` (default), `managers_only`,
  `everyone`.

Enforced server-side, so it holds against a crafted API call — not a UI
restriction.

### The approval chain

Two modes. `getApprovalConfig()` resolves both into the same
`{ reviewer_roles, final_roles }` shape, so the escalation engine never learns
which one an org uses.

- **stages** — an ordered list (`originator → immediate_manager →
  department_manager → plant_head`). Order is the thing being stored.
- **default / custom** — two role lists.

Per MOM §13.11/§13.12: `super_admin` is no longer an approver anywhere, and the
built-in chain ends at **Plant Head**. `admin` is appended to the final set so an
idea can never dead-end with nobody able to close it.

---

## 5. Running it

```bash
# One command, idempotent, also repairs a half-built database
cd backend && npm install && npm run setup && npm run dev   # :4000
cd frontend && npm install && npm run dev                   # :5173
```

`npm run setup` creates `backend/.env`, builds `ifqm_master`, creates every
tenant schema in the registry, and applies all migrations.

**Tests:** `cd backend && npm test` — 33 HTTP integration tests against a real
database. They cover the invariants that have broken before (tenant isolation,
role gates, lockout arithmetic, anonymity masking). *The 285/288 figure in the
MOM refers to the separate manual test-case document, not this suite.*

**Adding an organisation:** platform console → New Organisation, or
`node scripts/provision-tenant.js --name="Acme" --slug="acme" --domain="acme.com"`.

---

## 6. Where the bodies are buried

| Symptom | Cause |
|---|---|
| Server exits at boot with a numbered list | The production config guard. Fix what it names in `.env`. |
| `Unknown column …` on Create Organisation | `tenant_schema.sql` drifted from `db/migrations/`. |
| SQL syntax error on a managed MySQL | MariaDB-only DDL, or `"double quotes"` under `ANSI_QUOTES`. |
| Opaque `500` on a browser API call | Origin missing from `CORS_ORIGIN`. The cors middleware passes an `Error`, which becomes a 500 — this misleads reliably. |
| Uploads vanish after a deploy | Ephemeral disk (Render free tier). Files are on disk, rows are in the DB. |
| `429` with a quota message | Per-tenant API quota (§8.3). Raise it on the tenant row or in platform settings. |
| Login works, everything else 401s | Password changed, role changed, or account deactivated — every request re-reads the user. |

---

## 7. Phases completed (§3.1)

| Phase | Delivered |
|---|---|
| 1 | PHP/MySQL prototype — idea capture, basic review |
| 2 | Multi-tenancy: registry + schema per organisation, platform console |
| 3 | Migration to React + Node/Express; JWT replaces PHP sessions |
| 4 | Workflow depth: configurable approval chains, SLA/escalation, multi-reviewer committees |
| 5 | Engagement: points, leaderboard, challenges, community voting |
| 6 | Outcomes: implementation tracking, ROI, analytics, exports, audit log |
| 7 | Hardening: brute-force lockout, per-request re-auth, privacy contract on the console, load-driven indexing |
| 8 | Reach: 7-language i18n, bulk user import, email/phone login without an org code |
| 9 | Integration: QCMS push for approved ideas |
| 10 | **This MOM** — MSME self-registration with approval, solution privacy, podium leaderboard, on-hold vs inactive, per-tenant quotas, patentability, archiving |

## 8. Roadmap (§3.2)

Not started; recorded so the sequence is not re-derived later.

**Near term** — SMTP configured in production (nothing emails until then) ·
OTP/SMS login (§4) · Azure OAuth + SSO with QCMS, DWM and Skills (§12.6, §12.7) ·
billing and GST invoicing (§10).

**Then** — text-to-voice idea capture, aimed squarely at shop-floor staff who
will speak an idea but not type one · a mobile app (the SPA is responsive today,
which may be enough — worth testing before committing) · richer analytics.

**Open questions blocking work** are listed in
`MOM_29Jul2026_Implementation_Status.md`. The live one is §9.6 vs §9.3: the MOM
asks both to block free email domains and to accept Gmail for businesses without
a domain. Free mail is currently blocked.

---

## 9. QCMS API key — operator guide (§13.7)

The key is **write-only through the API**. `GET /api/integrations/settings`
returns `qcms_api_key_set: true|false` and never the value, so a compromised
admin session cannot read it back out.

To set one: Admin → API & Integration → paste → Save. To rotate: paste the new
one; leaving the field blank keeps the existing key rather than wiping it. To
remove: contact IFQM. The key is stored per tenant in `org_settings`; there is no
screen, export or log line anywhere that prints it.

Base URL comes from `QCMS_BASE_URL` in the environment, and an org admin can
override it per tenant.

# IFQM Migration — PHP → React + Node/Express + MySQL

Technology migration only. Behaviour, UI/UX, business rules, SQL logic, and DB
schema stay **identical** to the PHP app. The PHP code (`index.php`, `api/*.php`)
is kept in place as the reference oracle to compare against, module by module.

## Source architecture (analysis)
- **`index.php`** (5,668 lines): PHP header (auth/session bootstrap) + one HTML
  document. CSS lives in inline `<style>` (~L33–1375). A single `<script>`
  (~L1376–5668, ~4,300 lines, 51 `fetch()` calls, ~200 functions) is a
  vanilla-JS SPA that renders the UI and calls `api/*.php`. → migrates to React;
  CSS preserved verbatim as a global stylesheet.
- **`api/*.php`** (14 files): PDO + prepared statements JSON API. → Express MVC.
- **Multi-tenant**: `ifqm_master` registry (`tenants`, `platform_admins`) →
  per-tenant DBs (`ifqm_ideation`, `ifqm_jain_uni`, …). Tenant resolved by
  slug → domain → default → hardcoded fallback.
- **Auth**: PHP sessions + CSRF + brute-force lock + bcrypt. → JWT + bcrypt.

## Mandated intentional differences (tech-stack consequences only)
- PHP session → **JWT** (`Authorization: Bearer`), lifetime = `SESSION_LIFETIME`
  (28800s). Login returns `token`; client stores it.
- **CSRF tokens dropped**: a session artifact; JWT-in-header has no ambient
  credential to forge (security-neutral). `/me` no longer returns `csrf_token`.
- Brute-force counter kept in-process (PHP kept it in the session) — same rule:
  5 fails → 15-min lock, per `email|org`.
- bcrypt: PHP `$2y$` hashes verify unchanged via `bcryptjs`; new hashes use
  `$2b$10$` (PHP `password_verify` accepts them). **Verified** end-to-end.

## Module order & status
| # | Module | Backend | Frontend | Verified |
|---|--------|---------|----------|----------|
| 1 | Foundation + DB layer + **Auth** | ✅ | — | ✅ login/JWT/me/lockout/tenant+platform |
| 2 | **Users & Departments** | ✅ | ⬜ | ✅ CRUD/guards/role-rules/hierarchy/profile |
| 3 | **Ideas (submit/edit/workflow)** | ✅ | ⬜ | ✅ submit/escalation/committee/dashboard/roi/impl |
| 4 | **Voting (rating + community)** + ideas.php `board`/`community_vote` | ✅ | ⬜ | ✅ rating/up-down/community/stats/poll/board |
| 5 | **Comments** | ✅ | ⬜ | ✅ nesting/soft+hard delete/placeholder/perms |
| 6 | **Leaderboard** | ✅ | ⬜ | ✅ PHP-vs-Node diff identical, all 4 periods |
| 7 | **AI scoring** (engine + `score`/`batch_rescore` endpoints) | ✅ | ⬜ | ✅ heuristic byte-identical + endpoints |
| 8 | **Notifications** | ✅ | ⬜ | ✅ list/backfill/unread-count/mark-read |
| 9 | **Admin / Settings + Challenges** | ✅ | ⬜ | ✅ settings mask/whitelist + challenge CRUD |
| 10 | **Reports / Export + Uploads** | ✅ | ⬜ | ✅ CSV/HTML/analytics/audit/attachments |
| 11 | **Platform admin + provisioning** | ✅ | ⬜ | ✅ tenants/detail/hierarchy/create + CLI |
| 12 | React frontend (full UI, CSS preserved) | — | ⬜ | |
| 13 | End-to-end parity verification vs PHP | | | |

## Module 1 — done
Backend scaffold under `backend/`:
- `src/config` — env loader mirroring `api/config.php` constants.
- `src/database` — `master.js` (registry pool) + `tenant.js` (per-tenant pool
  cache + `resolveTenant` priority chain + fallback tenant).
- `src/middleware` — `auth.js` (`requireAuth`/`requireRole`/`requirePlatformAuth`
  + JWT → tenant-DB attach), `errorHandler.js`, `rateLimiter.js`.
- `src/utils` — `jwt`, `respond`/`ApiError`, `asyncHandler`, `logger`.
- `src/services` — `authService.js` (port of `api/auth.php`), `mailerService.js`
  (nodemailer port of `api/mailer.php`).
- `src/controllers/authController.js`, `src/routes/*`, `app.js`, `server.js`.

### Verified (against live MySQL, real `$2y$` hashes)
- Platform-admin login (`platform@ifqm.io`) → token → `/me` ✔
- Tenant login (temp user, PHP-hashed pw) → JWT carries `org_slug`, tenant `/me`
  resolves correct tenant DB ✔ (temp user removed afterwards)
- Wrong password → 401 with decrementing attempt counter ✔
- DB-down → clean `"Database connection failed."` (matches PHP) ✔

## Module 2 — done
User-management + profile actions of `api/users.php` → `userService` /
`userController` / `userRoutes` (`/api/users/*`):
`list`, `admin_users` (`/admin`), `create_user` (POST `/`), `update_user`
(PUT `/:id`), `delete_user` (DELETE `/:id`), `managers`, `hierarchy`, `profile`.
Role guards, validation order, role-assignment rules, initials, dedupe (409),
and delete→deactivate-if-has-ideas all mirror PHP.

Deferred to their own modules (they also live in users.php): `leaderboard` (6),
`notifications`/`mark_read` (8), `analytics`/`audit` (10). "Departments" is the
free-text `users.department` column — no departments table/CRUD in the source.

### Verified (live DB, temp users, all removed after)
create (+409 dupe, +400 short pw) ✔ · update ✔ · managers/hierarchy/list/search
✔ · guards: edit-self, edit/delete super_admin, delete-self, 404, admin-cannot-
assign-admin, admin self-edit message ✔ · hard-delete (no ideas) ✔ · profile ✔

## Module 3 — done
`api/ideas.php` → `ideaService` / `ideaController` / `ideaRoutes` (`/api/ideas/*`):
list, my, review, get (`/:id`), submit, draft, review-action, dashboard,
assign-reviewers, reviewer-decision, check-duplicate, bulk-review, roi,
implementation. Role scoping, SLA due date, hierarchical **escalation chain**,
**multi-reviewer committee + threshold** logic, points (10/25/65), notifications,
queued emails, idempotency guard, and anonymous masking all mirror PHP.

Pulled forward (Ideas depends on them):
- **AI scorer** → `aiService.js` (6-dimension heuristic + pluggable OpenAI/Gemini,
  blank by default). **Verified byte-identical to score.php** across 5 diverse
  ideas (scores, reasons, breakdowns). Completes Module 7's engine; the two REST
  endpoints (`score`, `batch_rescore`) remain for Module 7.
- Shared helpers → `coreHelpers.js` (generateIdeaCode/addNotification/addWorkflow/
  addPoints); `settingsService.getApprovalConfig`.

Deferred to Module 4 (community voting): `board`, `community_vote` (live in
ideas.php but are voting features).

Known faithful quirk: `idea_workflow.action` ENUM lacks 'ROI Updated'/
'Implementation Updated', so MariaDB (non-strict sql_mode) stores '' for those —
**PHP does the same** (verified by running PHP addWorkflow).

### Verified (live DB, temp exec←mgr←emp hierarchy, all removed after)
submit→ai_score=90/+10pts/reviewer-routed/notify ✔ · escalation mgr→exec→final
Approved/+25 ✔ · self-approval 403 ✔ · role guard 403 ✔ · committee assign +
reviewer-decision threshold→Approved/+25 ✔ · dashboard emp/mgr ✔ · check-duplicate
✔ · roi (`Cost Saving: 12,345.50`) + implementation (`Status: In Progress`) ✔

## Module 4 — done
`api/votes.php` + the `board`/`community_vote` actions of `api/ideas.php` →
`votingService` / `votingController` / `votingRoutes` (`/api/votes/*`):
rate (5-star upsert), upvote, downvote, community (community_vote), community-stats,
poll-all, stats, board. `communityAdjustedScore` (net×3 capped ±20) preserved.

Faithful distinction preserved: **upvote/downvote maintain the
ideas.upvotes/downvotes counter columns** and return `community_score`, whereas
**community (ideas.php community_vote) RECOUNTS** from idea_community_votes and
does NOT touch those columns — verified the columns stay 0,0 on that path.

### Verified (live DB, temp voters + 2 fixed-score ideas, all removed after)
5-star: vote_count/avg_rating/user_rating, upsert update, self-vote 403, invalid
400 ✔ · up/down: score 50→53/47/56, toggle-off, switch, column maintenance ✔ ·
community_vote recount (columns untouched) + toggle + 400 ✔ · community-stats,
stats, poll-all (map+ts), board (sort ranking) ✔

## Module 5 — done
`api/comments.php` → `commentService` / `commentController` / `commentRoutes`
(`/api/comments/*`): list (`GET ?idea_id=`), add (`POST`), delete (`DELETE /:id`).
Threaded nesting, add validation (non-empty, ≤1000 chars, idea + parent checks),
and delete rules (owner or admin/executive/super_admin; soft-delete when the
comment has replies else hard-delete) all mirror PHP.

Subtle rule preserved: a soft-deleted comment is rendered as a "[deleted]"
placeholder ONLY while it still has replies; once its last reply is removed it is
omitted from the tree entirely.

### Verified (live DB, temp users + idea, all removed after)
add top-level/reply/second ✔ · nested list (2 top, 1 reply) ✔ · validations
(empty/1000/bad-idea/bad-parent) ✔ · delete perms 403 ✔ · soft-delete →
[deleted] placeholder with reply nested ✔ · hard-delete reply → childless parent
omitted ✔

## Module 6 — done
`leaderboard` action of `api/users.php` → `leaderboardService` /
`leaderboardController` / `leaderboardRoutes` (`GET /api/leaderboard?period=`):
individuals + departments + top_ideas, with monthly/quarterly/yearly/all period
filters applied inside the `LEFT JOIN ideas i ON ... <filter>` clause (period
whitelisted to a fixed SQL fragment). The unused `leaderboard` SQL VIEW already
exists in each tenant DB — nothing to recreate.

Faithful quirk preserved: departments `SUM(u.points)` is computed over the ideas
join, so a user's points are multiplied by their idea count (e.g. dept_points=110
for our seed) — **PHP produces the identical value**.

### Verified — PHP-vs-Node diff (same live DB, values coerced for PDO-string vs
mysql2-mixed typing): **IDENTICAL for period = all / monthly / quarterly /
yearly**. Seed cross-check: L1 idea_count 3 / implemented 1 / avg 70.0 / votes 2 /
rating 3.0; backdated (2023) idea correctly excluded by the yearly filter.

## Module 7 — done
Two REST endpoints of `api/score.php` → `scoreController` / `scoreRoutes`
(`/api/score/*`), on top of the already-verified `aiService` engine:
- `GET /api/score?id=` — rescore one idea + persist (auth).
- `POST /api/score/batch-rescore` — rescore every idea (**admin only**, matching
  PHP `requireRole('admin')`, not super_admin).

### Verified (live DB, temp idea/users; real ideas snapshot+restored)
single rescore 5→12 with reason/breakdown/source ✔ · bad id 404 ✔ · batch
non-admin 403 ✔ · batch admin `{updated:3}` ✔ · pre-existing ideas restored intact ✔

## Module 8 — done
`notifications` / `mark_read` actions of `api/users.php` → `notificationService`
/ `notificationController` / `notificationRoutes` (`/api/notifications/*`):
- `GET /api/notifications` — latest 20 + `unread_count`; back-fills a missing
  idea_id by matching an `IDA-YYYY-NNN` code in the message (and persists it).
- `POST /api/notifications/mark-read` — marks all the user's notifications read.

### Verified (live DB, temp user/idea + 4 notifications, all removed after)
unread_count=3 ✔ · back-fill links + persists idea_id from message code ✔ ·
no-code notification stays unlinked ✔ · mark-read → unread_count=0 ✔

## Module 9 — done
**Settings** (`api/settings.php`) → extended `settingsService` + `settingsController`
+ `settingsRoutes` (`/api/settings/*`): get (SMTP-password masked to `••••••••`
for admins, removed for others), update (whitelist, threshold clamp 1–100, role
list normalize, invalid approval_mode skip, masked-password skip), test-email.
**Challenges** (`api/challenges.php`) → `challengeService` / `challengeController`
/ `challengeRoutes` (`/api/challenges/*`): list/get/create/update/delete with
role + creator guards; delete orphans linked ideas (challenge_id→NULL).

Note: PHP's htmlspecialchars in the test-email BODY is kept (it's real emailed
HTML, not a JSON API field) — distinct from the JSON-response esc() we drop.

### Verified (live DB; org_settings snapshotted + restored; temp users/idea removed)
settings: pass masking per-role ✔ · update clamp/normalize/skip-unknown ✔ ·
masked-password skip verified with proper UTF-8 (updated=1, pass unchanged) ✔ ·
real password overwrite ✔ · guards 403/400 ✔ · test-email no-host 400 ✔ ·
challenges: create/list/get+ideas/update(close)/status-400/role-403/delete→orphan ✔

## Module 10 — done
**Export** (`api/export.php`) → `exportService`/`exportController`/`exportRoutes`
(`/api/export/*`): ideas CSV + leaderboard CSV (UTF-8 BOM, fputcsv-style quoting),
analytics HTML (printable report, admin/exec/mgr roles). **Reports** (analytics +
audit JSON from `users.php`) → `reportService` (`/api/reports/*`). **Uploads**
(`api/upload.php`) → `uploadService`/`uploadController`/`uploadRoutes`
(`/api/upload`): multipart via multer memoryStorage → per-tenant
backend/uploads/<slug>/, served at /api/uploads/<slug>/<file>; DELETE /:id.

Upload size rule: PHP receives the whole file then checks size, so the app's
10MB limit is enforced in uploadService (clean 400). multer only imposes a high
hard ceiling (≥50MB) to bound memory — verified an 11MB upload returns a clean
`400 "File exceeds 10MB limit."` via a real client (Node fetch / axios-like); the
earlier `000` was a curl-only mid-upload artifact.

### Verified (live DB, temp users/idea + real files, all removed)
CSV BOM + comma-field quoting ✔ · leaderboard CSV ✔ · analytics HTML + 403 ✔ ·
reports analytics JSON (impact sorted desc) + audit + 403 ✔ · upload valid
(file on disk + served 200) ✔ · bad section 400 / not-owner 403 / bad ext 400 /
oversized 400 ✔ · delete owner→removed, non-owner 403 ✔

## Module 11 — done  (backend complete ✅)
**Platform** (`api/platform.php`) → `platformService`/`platformController`/
`platformRoutes` (`/api/platform/*`, all requirePlatformAuth): tenants (aggregate
stats, creds stripped), tenants/:id (detail), tenants/:id/hierarchy (user tree,
no idea content), POST tenants (create_tenant — provisions DB+schema+admin+
registration, rollback-drops DB on failure). CLI: `scripts/provision-tenant.js`
(port of provision_tenant.php — creates super_admin SA-001).

**Bug fix (documented deviation):** the source `schema.sql` used by PHP
provisioning references `idea_comments` in an index but never creates the table
(nor `challenges`/`email_queue`; those live only in `schema_updates.sql`, which
provisioning never runs). PHP's own create_tenant/provision_tenant.php therefore
fail. Provisioning here uses a consolidated **`backend/schema/tenant_schema.sql`**
(source schema + the 3 missing tables) so new tenants match the existing working
DBs. This is the one place we intentionally *fix* rather than replicate PHP,
because the goal is a production-ready migration and the PHP flow is broken.

### Verified (live master DB; test tenants created then fully dropped)
platform login ✔ · tenants list (2 tenants, aggregate stats, **db creds
stripped**) ✔ · detail + hierarchy (idea_count but no titles/content) ✔ · guards
401 (tenant user / no token) ✔ · create_tenant validation 400/409 ✔ · provision
→ 13 tables incl idea_comments/challenges/email_queue, admin login + submit +
comment all work ✔ · CLI provision (super_admin SA-001) ✔ · rollback drops DB on
failure ✔

---

## Backend status: 11/11 modules DONE and verified against live MySQL.
Every PHP API file is ported: auth, config, users, ideas, votes, comments, score,
challenges, settings, export, upload, mailer, platform, provision_tenant.
Remaining: **frontend** (React port of the index.php SPA + CSS) and **E2E parity**.

## Run
```bash
cd backend
cp .env.example .env      # adjust secrets; set a strong JWT_SECRET
npm install
npm run dev               # http://localhost:4000
```
Requires XAMPP MySQL running with `ifqm_master` + tenant DB(s).

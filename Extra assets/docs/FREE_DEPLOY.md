# Deploying IFQM for free (temporary test environment)

A throwaway public environment on three free tiers, no credit card:

| Piece | Host | Free tier |
|---|---|---|
| React frontend (`frontend/`) | **Vercel** | unlimited static deploys |
| Node/Express API (`backend/`) | **Render** | 1 web service, 512 MB, 750 h/month |
| MySQL 8 | **Aiven** | 1 CPU / 1 GB RAM / 1 GB disk, one service per org |

Render has no MySQL product and Vercel has no long-running Node process, which
is why the database and the API live on different hosts. Everything below is
free indefinitely; read [Limits](#limits-of-this-setup) before showing it to
anyone — a sleeping backend and a disappearing uploads folder are the two
surprises that matter.

Prerequisite: the repo is pushed to GitHub (Render and Vercel both deploy from
a branch).

---

## 1. Database — Aiven MySQL

1. Sign up at <https://aiven.io> (no card), **Create service → MySQL → Free
   plan**, pick the region closest to your testers.
2. Wait for the service to reach *Running*, then open its **Overview** tab and
   copy: `Host`, `Port`, `User` (`avnadmin`), `Password`, and download the **CA
   certificate**.
3. Aiven only pre-creates `defaultdb`. This app wants one schema for the
   registry plus one per organisation — `npm run setup` in step 2 creates them,
   but if your account is not allowed to `CREATE DATABASE`, add `ifqm_master`
   and `ifqm_ideation` by hand from the service's **Databases** tab first.

## 2. Load the schema (from your machine, once)

The setup scripts read `backend/.env`, and shell variables win over that file —
so you can point them at Aiven for one command without touching your local
config. In PowerShell, from `backend/`:

```powershell
$env:MASTER_DB_HOST="mysql-xxxx-yyyy.aivencloud.com"
$env:DB_PORT="12345"
$env:DB_SSL="true"
$env:MASTER_DB_USER="avnadmin"
$env:MASTER_DB_PASS="<aiven password>"
$env:MASTER_DB_NAME="ifqm_master"
npm run setup
```

That creates `ifqm_master`, every tenant schema listed in its registry, and
applies `db/migrations/*.sql` to all of them. It is idempotent — re-run it
after any failure.

`db/master.sql` seeds a default tenant whose `db_host` is `localhost`, which
would send the deployed API looking for a database on Render's own container.
Repoint every tenant at Aiven (same shell, still in `backend/`):

```powershell
node -e "const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.MASTER_DB_HOST,port:+process.env.DB_PORT,ssl:{rejectUnauthorized:false},user:process.env.MASTER_DB_USER,password:process.env.MASTER_DB_PASS,database:'ifqm_master'});const [r]=await c.execute('UPDATE tenants SET db_host=?',[process.env.MASTER_DB_HOST]);console.log('tenants repointed:',r.affectedRows);await c.end();})()"
```

Then create the organisation you will actually log into. `--domain` must be
unique per tenant but is only used for host-based tenant resolution, so the
Vercel hostname is a sensible value:

```powershell
node scripts/provision-tenant.js --name="Demo Org" --slug="demo" `
  --domain="ifqm-demo.vercel.app" `
  --db-host="$env:MASTER_DB_HOST" --db-user="avnadmin" --db-pass="$env:MASTER_DB_PASS" `
  --admin-email="admin@demo.test" --admin-pass="<a 12+ char password>"
```

Finally make that org the default tenant, so signing in without an org code
resolves to a tenant that has users rather than the empty seeded one:

```powershell
node -e "const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.MASTER_DB_HOST,port:+process.env.DB_PORT,ssl:{rejectUnauthorized:false},user:process.env.MASTER_DB_USER,password:process.env.MASTER_DB_PASS,database:'ifqm_master'});await c.execute('UPDATE tenants SET is_default = (slug = ?)',['demo']);const [rows]=await c.query('SELECT slug,db_host,db_name,is_default FROM tenants');console.table(rows);await c.end();})()"
```

Keep double quotes out of the JavaScript in these one-liners — PowerShell 5.1
ends the argument at the first inner `"`, even escaped as `\"`, and then tries to
run the remainder as a command. Pass values with `?` placeholders instead.

Close the terminal afterwards so the Aiven credentials do not linger in the
shell session.

## 3. Backend — Render

**New → Web Service → connect the repo**, then:

| Setting | Value |
|---|---|
| Root directory | `backend` |
| Runtime | Node |
| Build command | `npm ci` |
| Start command | `npm start` |
| Instance type | Free |
| Health check path | `/api/health` |

(Or point Render at the `render.yaml` blueprint in the repo root, which sets
all of the above and prompts for the secrets.)

Environment variables:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `CORS_ORIGIN` | `https://<your-app>.vercel.app` — fill in after step 4 |
| `FRONTEND_BASE_URL` | same Vercel URL |
| `MASTER_DB_HOST` | Aiven host |
| `DB_PORT` | Aiven port |
| `DB_SSL` | `true` |
| `DB_SSL_CA` | contents of the downloaded CA `.pem` (optional — see below) |
| `MASTER_DB_NAME` | `ifqm_master` |
| `MASTER_DB_USER` / `APP_DB_USER` | `avnadmin` |
| `MASTER_DB_PASS` / `APP_DB_PASS` | Aiven password |
| `DB_POOL_SIZE` | `3` |

Do not set `PORT`; Render injects it and the server already reads it.

`DB_SSL_CA` is what makes the database link *authenticated* rather than merely
encrypted. Leaving it blank still uses TLS but skips certificate verification —
acceptable for a disposable test environment, not for real data.

The backend **refuses to boot** if `JWT_SECRET` is short/missing, the DB
password is empty, the DB user is `root`, or `CORS_ORIGIN`/`FRONTEND_BASE_URL`
are unset, localhost, or plain http. If the deploy dies immediately, the Render
log names the exact offender.

## 4. Frontend — Vercel

**Add New → Project → import the repo**, then:

| Setting | Value |
|---|---|
| Root directory | `frontend` |
| Framework | Vite |
| Build command | `npm run build` (default) |
| Output directory | `dist` (default) |

One environment variable, read at **build** time:

```
VITE_API_URL = https://<your-service>.onrender.com/api
```

`frontend/vercel.json` already rewrites unknown paths to `index.html` so
react-router deep links (`/admin`, `/ideas/123`) survive a refresh.

Now go back to Render, set `CORS_ORIGIN` and `FRONTEND_BASE_URL` to the real
Vercel URL, and let it redeploy. Changing `VITE_API_URL` later requires a Vercel
**redeploy**, not just a restart — it is baked into the bundle.

## 5. Smoke test

1. `https://<service>.onrender.com/api/health` → `{"success":true,"status":"ok"}`
   (first hit after idle takes ~1 minute while the instance wakes).
2. Open the Vercel URL, log in with org code `demo` and the admin credentials
   from step 2.
3. Platform-admin console: `platform@ifqm.io` / `password` — seeded by
   `db/master.sql`. **Change it immediately**, it is public in this repo.
4. If login returns a CORS error, `CORS_ORIGIN` does not exactly match the
   browser's origin (no trailing slash, https, correct subdomain).

## Shipping changes after the first deploy

Both hosts watch the connected branch, so the loop stays `code → test locally →
commit → push`, and the push is the deploy. Render rebuilds the backend
(~2-4 min) and Vercel rebuilds the frontend; each has a one-click rollback to
the previous deploy if something lands badly.

Local development is unchanged: `backend/.env` still points at XAMPP with
`DB_SSL=false`, and the production-only config guard never fires in dev. The
cloud credentials live only in the Render dashboard.

**Schema changes are the one step a push does not perform.** Nothing runs
migrations on deploy by default:

1. Write `db/migrations/00N_your_change.sql` (append `_master` to the filename
   if it targets the registry rather than tenant schemas).
2. `npm run migrate` locally → verify against XAMPP.
3. Commit and push; wait for Render to finish deploying.
4. Run the same migration against Aiven, from `backend/` in PowerShell:

   ```powershell
   $env:MASTER_DB_HOST="mysql-xxxx-yyyy.aivencloud.com"
   $env:DB_PORT="12345"; $env:DB_SSL="true"
   $env:MASTER_DB_USER="avnadmin"; $env:MASTER_DB_PASS="<aiven password>"
   npm run migrate
   ```

Order matters when a migration is not backwards-compatible: apply an additive
migration *before* pushing the code that needs it, and a destructive one
*after*. If you would rather not think about it, set Render's start command to
`npm run migrate && npm start` — migrations then run on every boot (cheap once
the ledger is current) and a failed migration aborts the deploy instead of
leaving a half-broken app. The cost is that a schema change and its code always
go live together, so it must be the backwards-compatible kind.

Two smaller things that bite:

- **Vercel preview deployments** (every branch/PR gets its own URL) will fail
  CORS, because that hostname is not in the backend's `CORS_ORIGIN`.
  `CORS_ORIGIN` accepts a comma-separated list — add the branch's stable alias
  domain, or just test previews against production and skip the API.
- **Local and Aiven data have diverged** from the moment you deployed. Seed
  rows added by hand locally do not exist in the cloud; put them in a migration
  if they matter.

## Limits of this setup

- **Cold starts.** The Render free instance sleeps after 15 minutes idle; the
  next request takes roughly a minute. Warn testers, or hit `/api/health` on a
  schedule.
- **Uploads vanish.** Free Render instances have an ephemeral filesystem, and
  attachments/logos are written to `backend/uploads/`. Every deploy, restart and
  wake-from-sleep wipes them, while the database rows describing them survive —
  so old attachments will 404. Fine for testing flows, not for a demo you want
  to keep.
- **1 GB database**, and Aiven powers a free service off after a long idle
  period (with an email first); restart it from the console.
- **Few DB connections.** `DB_POOL_SIZE=3` keeps `(tenants + 1) × pool` under
  the free plan's ceiling. Each new organisation adds a pool.
- **Emails** (password reset, notifications) need SMTP credentials configured in
  the app's admin settings; without them those flows fail silently.
- **Secrets.** Everything above lives in Render/Vercel dashboards, not in git.
  Never commit `backend/.env`.

## Teardown

Delete the Render service, the Vercel project, and the Aiven service. Nothing
bills, but the Aiven free service occupies your one-free-service slot until it
is removed.

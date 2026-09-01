# Deployment settings — Kalpion

Two hosted pieces, and each needs values that live in a dashboard rather than in
this repository. `render.yaml` declares every backend key with `sync: false`
precisely so no value is committed, and every `.env*` is gitignored.

| | URL |
|---|---|
| Frontend (Vercel) | https://kalpion-employee-ideation-tool.vercel.app |
| Backend (Render)  | https://kalpion-eit.onrender.com |
| Database (Aiven)  | shared by both deployments; migrations 024–040 applied |

Local companions, gitignored, holding the values to paste:
`.env.render` and `.env.vercel`.

---

## 1. Vercel — `VITE_API_URL` is missing `/api`

**This is currently wrong, and it breaks every request.**

Settings → Environment Variables → Production:

```
VITE_API_URL=https://kalpion-eit.onrender.com/api
```

It is set to `https://kalpion-eit.onrender.com` today, with no `/api`.
`api.js` uses the value as the axios `baseURL` and appends paths to it, so a
sign-in currently goes to:

```
https://kalpion-eit.onrender.com/auth/login      → 404 {"error":"Unknown action"}
```

instead of:

```
https://kalpion-eit.onrender.com/api/auth/login  → 200
```

Both verified against the live service.

The value is compiled into the bundle at **build** time — Vite substitutes
`import.meta.env.VITE_API_URL` during the build — so **redeploy after changing
it**. Saving the variable alone leaves the old URL inside the JavaScript
browsers are already being served.

---

## 2. Render — `CORS_ORIGIN` does not name the frontend

**Also currently wrong, and blocks the browser even once §1 is fixed.**

Environment → add or correct:

```
CORS_ORIGIN=https://kalpion-employee-ideation-tool.vercel.app,https://kalpion-employee-ideation-tool-git-main-yashas2.vercel.app
FRONTEND_BASE_URL=https://kalpion-employee-ideation-tool.vercel.app
```

Measured against the running service — a CORS preflight from each origin:

| Origin | Result |
|---|---|
| `https://kalpion-employee-ideation-tool.vercel.app` | **500 — blocked** |
| `https://eit-sage.vercel.app` (the old frontend) | 500 — blocked |
| `http://localhost:5173` | 204 — allowed |

Only localhost passes, and only because `app.js` allows it by pattern. So
`CORS_ORIGIN` on this service is unset or holds something matching neither
frontend.

It is an **exact-match allowlist**, not a pattern. A trailing slash, `http`
instead of `https`, or a different sub-domain all fail — and the failure reaches
the user as a generic network error with nothing naming CORS, which is why it is
worth getting right in one go rather than by trial.

`FRONTEND_BASE_URL` is separate and also matters: it builds the link in a
password-reset email. Wrong, and resets point at a site that no longer serves
this backend.

### Deployment URLs cannot be allowlisted

Vercel issues a unique URL per deployment
(`…-oftdmhk7q-yashas2.vercel.app`). Those change on every push, so they can
never be in the list. Use the production domain, plus the stable per-branch
alias above if you want preview builds to reach the API.

---

## 3. The rest of the Render environment

Everything else is in `.env.render`, ready to paste: database, JWT secret,
platform mail, SMS/DLT, points, background jobs.

Two worth knowing:

- **`DB_SSL_CA`** carries the Aiven CA inline as PEM, so no certificate file is
  needed on the host.
- **`RUN_BACKGROUND_JOBS`** must be left blank or `1` on exactly one instance.
  It drives the email queue drain, the approval-chain repair and the
  registration-notice retry. Two instances would both drain the same queue, and
  the claim-and-attempt update is not atomic enough for that to be safe.

## 4. Database — nothing to do

The new backend already reaches Aiven: `/api/auth/maintenance` returns a real
answer, which is a read of `platform_settings`. Migrations 024–040 are applied
and `migrate-remote.mjs --dry` reports "up to date".

To apply future migrations, from `backend/` with **absolute** paths — the script
resolves relative to its own directory, not the working one:

```
node scripts/migrate-remote.mjs C:/xampp/htdocs/ifqm/.env.render C:/xampp/htdocs/ifqm/ca.pem --dry
node scripts/migrate-remote.mjs C:/xampp/htdocs/ifqm/.env.render C:/xampp/htdocs/ifqm/ca.pem
```

The env keys it reads are `MASTER_DB_HOST` / `MASTER_DB_USER` / `MASTER_DB_PASS`
— not `DB_HOST` / `DB_USER` / `DB_PASSWORD`.

---

## Checking it worked

After fixing both and redeploying the frontend:

```
curl -i -X OPTIONS https://kalpion-eit.onrender.com/api/auth/login \
  -H "Origin: https://kalpion-employee-ideation-tool.vercel.app" \
  -H "Access-Control-Request-Method: POST"
```

Expect **204** with an `access-control-allow-origin` header. A 500 means the
origin is still not in the list.

Then confirm the frontend was rebuilt, not just re-saved:

```
curl -s https://kalpion-employee-ideation-tool.vercel.app/ \
  | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js'
```

Fetch that bundle and check it contains `kalpion-eit.onrender.com/api` — with
the `/api`. If the suffix is missing, the variable was saved but not rebuilt.

**Note:** the Render free instance sleeps. The first request after idle takes
about 50 seconds, which is a cold start and not a fault.

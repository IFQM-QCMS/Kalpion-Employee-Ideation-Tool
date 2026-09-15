# Deployment settings

Values that live in an env file on the server rather than in this repository.
Every `.env*` is gitignored.

## Production

Production is `https://kalpion.ifqm.org.in`: Docker Compose on the IFQM VPS,
directory `/opt/ifqm-kalpion`, three containers - `kalpion-web` (nginx, the
built SPA), `kalpion-api` (Node, port 4000) and `kalpion-db` (MariaDB 10.11,
named volume `kalpion-db-data`). A shared reverse proxy on the `ifqm-new-sites`
docker network terminates TLS and routes `/api/*` to the API and everything
else to the web container. IFQM's server administrator maintains the proxy and
the host; the repository owns everything inside the three containers.

Deploys are automatic: every push to `main` runs CI, and on success
`.github/workflows/deploy.yml` copies the tested tree to the server, rebuilds
the two application images, runs the migration runner in the API container and
fails the deploy unless `/api/health` answers. The database container is never
rebuilt or restarted by a deploy.

Two files on the server hold the secrets, and both survive a deploy untouched:

| Server file | Read by | Holds |
|---|---|---|
| `/opt/ifqm-kalpion/backend/.env` | the API container (`env_file`) | everything in `backend/.env.example`; in particular `MASTER_DB_PASS` **and** `APP_DB_PASS`, which must be the same password |
| `/opt/ifqm-kalpion/.env` | `docker compose` | `MARIADB_ROOT_PASSWORD`, `MARIADB_PASSWORD` - read by MariaDB only when its volume is first created |

The two database password keys exist because the registry and the tenant
schemas may one day live on different servers. Today they do not: `ifqm_app`
opens both, so a rotation must change both keys, and the API container must be
**recreated** (`docker compose up -d --force-recreate kalpion-api`) rather than
restarted, because `env_file` is read only when a container is created. A
rotation that touches only `MASTER_DB_PASS` leaves the health checks green and
every organisation screen failing with "Database connection failed".

The reverse proxy needs `client_max_body_size` of at least `MAX_FILE_MB` plus
headroom (the application allows 10 MB uploads, so 12m); nginx's default of 1 MB
answers larger uploads with its own HTML 413 before the API sees them.

The local companion for the production env is `.env.backend.vps` at the
repository root. It is a reference copy: after a password rotation on the
server it is the server's file that is current, never this one, so it must not
be copied over the server's file without first carrying the live passwords into
it.

## Environment files

Each file is named `.env.<half>.<target>`, so it is obvious which half of the
app it configures and which deployment it belongs to.

| File | Half | Target |
|---|---|---|
| `.env.backend.vps` | backend | production (see above) |
| `.env.frontend.ifqm` | frontend | production, build-time; `docker-compose.yml` also passes it as a build arg |
| `backend/.env` | backend | local development only |
| `.env.backend.ifqm` | backend | retired: the Aiven-hosted MySQL the Render deployment used; still needed by `scripts/export-remote.mjs` until that data has been carried over |
| `.env.backend.render`, `.env.frontend.vercel` | - | retired Render + Vercel hosting; `render.yaml` and `vercel.json` are kept for reference only |

`backend/.env.example` is the committed template and holds no real values. The
backend reads `backend/.env` and nothing else; the files above are copied into
it (or into the host's environment store) at deploy time.

## Branch

Deploy `main`. `sms-otp-kaleyra-dlt` is a merged feature branch and is not
ahead of `main`.

## Backend

Runs from `backend/`. Node 18 or newer.

```
cd backend
npm ci
npm run setup      # first time only: builds the schema and applies migrations
npm start          # node server.js, listens on PORT (default 4000)
```

Health check: `GET /api/health`.

The server refuses to start in production if `JWT_SECRET` is missing or under 32
characters, the database password is empty, the database user is `root`, or
`CORS_ORIGIN` still mentions localhost. It prints what is wrong and exits; read
the banner rather than treating it as a crash.

Other things it needs:

- `backend/uploads/` writable, on storage that survives a restart. Attachments
  and tenant logos live there and are not served by `express.static`.
- `RUN_BACKGROUND_JOBS` set to `0` on every instance but one. It drives the
  email queue drain, approval-chain repair, retention purge, billing sweep and
  registration-notice retry, and two instances would drain the same queue.
- `TRUST_PROXY=1` behind a single reverse proxy, or every sign-in is logged from
  the proxy's address.

## Frontend

Built separately and served as static files with an SPA fallback, so that every
non-asset path rewrites to `/index.html` (nginx: `try_files $uri /index.html;`).

```
cd frontend
npm ci
npm run build      # -> frontend/dist
```

`VITE_API_URL` is compiled into the bundle at build time, not read at runtime.
Changing it needs a rebuild, not a restart. Saving it without rebuilding leaves
the old URL inside the JavaScript browsers are already being served.

The trailing `/api` matters: `api.js` uses the value as the axios `baseURL` and
appends paths to it.

```
VITE_API_URL=https://kalpion.ifqm.org.in/api
```

## The three URL settings must agree

```
VITE_API_URL=https://kalpion.ifqm.org.in/api      # frontend, at build time
CORS_ORIGIN=https://kalpion.ifqm.org.in           # backend
FRONTEND_BASE_URL=https://kalpion.ifqm.org.in     # backend
```

`CORS_ORIGIN` is an exact-match allowlist, not a pattern. A trailing slash,
`http` instead of `https`, or a different sub-domain all fail, and the failure
reaches the user as a generic network error that never mentions CORS. It takes a
comma-separated list where more than one origin is needed.

`FRONTEND_BASE_URL` builds the link inside password-reset emails.

Vercel issues a unique URL per deployment, which changes on every push and
cannot be allowlisted. Use the production domain or the stable branch alias.

Check it with a preflight:

```
curl -i -X OPTIONS https://kalpion.ifqm.org.in/api/auth/login \
  -H "Origin: https://kalpion.ifqm.org.in" \
  -H "Access-Control-Request-Method: POST"
```

204 with an `access-control-allow-origin` header is right. A 500 means the
origin is not in the list.

## Mail and SMS

Both are env-only, with no screen in the platform console. Leave either block
out and the sign-up page says so: "Codes by email are not available right now",
or "Codes by SMS are unavailable at the moment".

`PLATFORM_MAIL_API_KEY` is the provider's API token, not the SMTP password.
ZeptoMail issues the two separately and the wrong one returns a 401 that reads
like a bad password.

`PLATFORM_MAIL_TRANSPORT=api` skips SMTP entirely. Use it on a host that blocks
outbound SMTP, where the port hangs rather than refusing.

`SMS_SENDER_ID` is six characters. The registration is written `IFQMID-T`; the
`-T` is Jio's category annotation and is stripped before sending.

DLT template ids and their approved wording stay together in
`backend/src/config/smsTemplates.js`. Do not move either half into an env file:
the carrier checks the two against each other, an env value overrides the code,
and a mismatch is accepted by the gateway and then dropped by the carrier with
no error at either end.

## Database

Migrations are not applied by a deploy. They are always a deliberate step.

A ledger in `ifqm_master.schema_migrations` records which files have run against
which schema, so the runner is forward-only and re-running is safe.

Fresh database:

```
cd backend
npm run setup      # master.sql, tenant schemas, then every migration
```

Existing database, local credentials:

```
cd backend
npm run migrate
```

Remote managed database, credentials read from a file rather than the command
line. Use absolute paths, since the script resolves relative to its own
directory:

```
node scripts/migrate-remote.mjs C:/xampp/htdocs/ifqm/.env.backend.ifqm C:/xampp/htdocs/ifqm/ca.pem --dry
node scripts/migrate-remote.mjs C:/xampp/htdocs/ifqm/.env.backend.ifqm C:/xampp/htdocs/ifqm/ca.pem
```

It reads `MASTER_DB_HOST` / `MASTER_DB_USER` / `MASTER_DB_PASS`, not
`DB_HOST` / `DB_USER` / `DB_PASSWORD`.

Use a database user restricted to the `ifqm_%` schemas. The app refuses to start
as `root` in production.

`DB_SSL_CA` carries the provider's CA inline, so no certificate file is needed
on the host. On Render it must be flattened to one line with `\n`, because a
value ends at the first real newline there.

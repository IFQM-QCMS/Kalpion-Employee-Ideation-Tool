#!/usr/bin/env bash
#
# Deploy Kalpion on the IFQM VPS.
#
# Runs ON the server. It is piped in over SSH by .github/workflows/deploy.yml
# and read by `bash -s`, so the version that runs is always the one from the
# commit being deployed - nothing needs updating on the server first.
#
# Three other products share this box (IFQM Skills, DWM, OctaQube). Nothing
# outside APP_DIR is written to and only one service is restarted, so none of
# them is affected. The guard rails below enforce that rather than trusting the
# caller to pass the right path.
#
# Inputs, all passed as environment variables by the workflow:
#   DEPLOY_SHA        commit to deploy - the one CI tested   (required)
#   APP_DIR           checkout to deploy into                (default /opt/ifqm-kalpion)
#   KALPION_SERVICE   systemd unit or pm2 app name           (default ifqm-kalpion)
#   HEALTH_PATH       health endpoint                        (default /api/health)
#   HEALTH_RETRIES    attempts before failing                (default 20, about 40s)
#
# Exit codes: 0 deployed and healthy. Non-zero means the deploy failed; if it
# got as far as restarting, the code has been rolled back.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ifqm-kalpion}"
KALPION_SERVICE="${KALPION_SERVICE:-ifqm-kalpion}"
HEALTH_PATH="${HEALTH_PATH:-/api/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-20}"
DEPLOY_SHA="${DEPLOY_SHA:?DEPLOY_SHA is required}"

say()  { printf '\n[deploy] %s\n' "$*"; }
die()  { printf '\n[deploy] FATAL: %s\n' "$*" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────────────────────
# 1. Guard rails
# ─────────────────────────────────────────────────────────────────────────────

# Only ever Kalpion's own directory. A typo or a bad variable must not put this
# script anywhere near /opt/ifqm-skills, /opt/dwm or /opt/octaqube.
case "$APP_DIR" in
  /opt/ifqm-kalpion|/opt/ifqm-kalpion/) ;;
  *) die "APP_DIR is \"$APP_DIR\". This script only deploys /opt/ifqm-kalpion." ;;
esac

[ -d "$APP_DIR/.git" ] || die "$APP_DIR is not a git checkout. Clone the repository there first."
cd "$APP_DIR"

# And only ever this repository, in case something else was cloned to the path.
remote_url="$(git config --get remote.origin.url || true)"
case "$remote_url" in
  *Kalpion-Employee-Ideation-Tool*) ;;
  *) die "origin is \"$remote_url\", which is not the Kalpion repository. Refusing to deploy." ;;
esac

# Node 18 is the floor declared in backend/package.json; CI runs 22.
command -v node >/dev/null 2>&1 || die "node is not installed for this user."
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 18 ] || die "node $(node -v) is too old. backend/package.json requires >=18 (22 recommended)."

say "user=$(whoami) dir=$APP_DIR node=$(node -v) service=$KALPION_SERVICE"

# ─────────────────────────────────────────────────────────────────────────────
# 2. The production .env is never touched
# ─────────────────────────────────────────────────────────────────────────────
# backend/.env is gitignored, so `git reset --hard` does not touch it. There is
# deliberately NO `git clean` anywhere in this script: `git clean -x` is exactly
# the command that would delete backend/.env and backend/uploads/.
#
# It is checksummed before and after regardless. Bringing a service back up on
# a config that quietly changed is worse than refusing to deploy.
ENV_FILE="$APP_DIR/backend/.env"
[ -f "$ENV_FILE" ] || die "backend/.env is missing on the server. Put the production file in place before deploying."
env_before="$(sha256sum "$ENV_FILE" | cut -d' ' -f1)"
say ".env found, sha256 ${env_before:0:12}... - it will not be written to"

previous_sha="$(git rev-parse HEAD)"
say "currently deployed: $previous_sha"

# ─────────────────────────────────────────────────────────────────────────────
# 3. Restart, defined early so the rollback path can call it
# ─────────────────────────────────────────────────────────────────────────────
# Only ever "$KALPION_SERVICE". systemd is tried first, then pm2. Neither branch
# can touch another application: systemctl is given one unit name and the
# sudoers rule permits only that one command; pm2 is given one app name.
restart_service() {
  if command -v systemctl >/dev/null 2>&1 \
     && systemctl list-unit-files --type=service --no-legend 2>/dev/null \
        | grep -qE "^${KALPION_SERVICE}\.service[[:space:]]"; then
    say "restarting systemd unit ${KALPION_SERVICE}"
    sudo -n systemctl restart "${KALPION_SERVICE}"
  elif command -v pm2 >/dev/null 2>&1 && pm2 describe "${KALPION_SERVICE}" >/dev/null 2>&1; then
    say "restarting pm2 app ${KALPION_SERVICE}"
    pm2 restart "${KALPION_SERVICE}" --update-env
    pm2 save >/dev/null 2>&1 || true
  else
    die "no systemd unit or pm2 app named \"${KALPION_SERVICE}\".
        systemd: sudo systemctl list-unit-files | grep -i kalpion
        pm2:     pm2 list
        Then set the KALPION_SERVICE repository variable to the real name."
  fi
}

rollback() {
  say "ROLLING BACK to $previous_sha"
  git reset --hard "$previous_sha" || true
  (cd backend  && npm ci --omit=dev --no-audit --no-fund) || true
  (cd frontend && npm ci --no-audit --no-fund && npm run build) || true
  restart_service || true
  say "rolled back. NOTE: migrations are forward-only and any that ran remain applied."
}

# ─────────────────────────────────────────────────────────────────────────────
# 4. Code
# ─────────────────────────────────────────────────────────────────────────────
# `reset --hard <sha>`, not `pull`: a pull deploys whatever main happens to be
# at now, which is not necessarily the commit that passed CI.
say "fetching $DEPLOY_SHA"
git fetch --prune --no-tags origin
git reset --hard "$DEPLOY_SHA"
say "now at $(git rev-parse --short HEAD) - $(git log -1 --pretty=%s)"

# ─────────────────────────────────────────────────────────────────────────────
# 5. Dependencies and build
# ─────────────────────────────────────────────────────────────────────────────
# backend/package.json declares no devDependencies, so --omit=dev installs
# exactly the runtime set. The backend has no build step; it is run directly
# with `node server.js` (npm start).
say "backend dependencies"
(cd backend && npm ci --omit=dev --no-audit --no-fund)

# The frontend DOES need its dev dependencies: `npm run build` is
# `npm run check && vite build`, and vite and eslint are both devDependencies.
# Output goes to frontend/dist.
say "frontend build"
(cd frontend && npm ci --no-audit --no-fund && npm run build)
[ -f "$APP_DIR/frontend/dist/index.html" ] || die "frontend build produced no dist/index.html."

# ─────────────────────────────────────────────────────────────────────────────
# 6. Database migrations
# ─────────────────────────────────────────────────────────────────────────────
# `npm run migrate` is node scripts/migrate.js, which reads backend/.env for its
# own credentials (MASTER_DB_HOST / MASTER_DB_USER / MASTER_DB_PASS, plus
# DB_PORT / DB_SSL / DB_SSL_CA for a managed database). It reads that file and
# never writes it.
#
# Forward-only, with a ledger in ifqm_master.schema_migrations, so only files
# with no ledger row run and re-running is safe. Applied to the registry and to
# every tenant schema.
say "database migrations"
(cd backend && npm run migrate)

# ─────────────────────────────────────────────────────────────────────────────
# 7. Restart
# ─────────────────────────────────────────────────────────────────────────────
restart_service

# ─────────────────────────────────────────────────────────────────────────────
# 8. Health check
# ─────────────────────────────────────────────────────────────────────────────
# Against the local port, so this reports on the service that was just
# restarted rather than on the proxy in front of it. GET /api/health returns
# {"success":true,"status":"ok"}.
PORT="$(grep -E '^[[:space:]]*PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d "\"' \r" || true)"
PORT="${PORT:-4000}"
URL="http://127.0.0.1:${PORT}${HEALTH_PATH}"

say "health check: $URL"
healthy=0
for i in $(seq 1 "$HEALTH_RETRIES"); do
  body="$(curl -fsS --max-time 5 "$URL" 2>/dev/null || true)"
  case "$body" in
    *'"status":"ok"'*) healthy=1; say "healthy after ${i} attempt(s): $body"; break ;;
  esac
  sleep 2
done

if [ "$healthy" -ne 1 ]; then
  say "health check FAILED after ${HEALTH_RETRIES} attempts"
  say "recent service log:"
  if command -v journalctl >/dev/null 2>&1; then
    sudo -n journalctl -u "${KALPION_SERVICE}" -n 40 --no-pager 2>/dev/null || true
  elif command -v pm2 >/dev/null 2>&1; then
    pm2 logs "${KALPION_SERVICE}" --lines 40 --nostream 2>/dev/null || true
  fi
  rollback
  die "deploy failed its health check and was rolled back to $previous_sha"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 9. Confirm the .env is byte-for-byte what it was
# ─────────────────────────────────────────────────────────────────────────────
env_after="$(sha256sum "$ENV_FILE" | cut -d' ' -f1)"
[ "$env_before" = "$env_after" ] \
  || die "backend/.env CHANGED during this deploy. Investigate before trusting the release."
say ".env unchanged, verified"

say "deployed $(git rev-parse --short HEAD) successfully"

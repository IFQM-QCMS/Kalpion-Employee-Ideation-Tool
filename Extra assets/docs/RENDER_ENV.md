# Render environment — what to set, and what changed

Render does not take an uploaded file. The variables live in the service's
**Environment** tab, and it has an **"Add from .env"** button that accepts
pasted `KEY=value` lines — that is the closest thing to an upload, and it is
what the blocks below are formatted for.

**Paste `.env.render` from the repository root.** It is complete, ordered, and
commented, and it is gitignored — it holds live credentials and is never
committed. Everything below explains what is in it.

Your local `backend/.env` is **not** the file to paste. It points at a local
MySQL, uses `root`, allows `localhost` as an origin, and the server refuses to
start in production with any of those.

`.env.render` has been verified by booting the real server against it in
production mode: it starts without tripping the config guard, connects to
Aiven, reports mail ready over the HTTPS API, and reports the three registered
SMS templates. `/api/health` answers 200.

---

## What changed in `.env.render` (already applied to the file)

The August SMS work moved the DLT template IDs and their wording out of the
environment and into `backend/src/config/smsTemplates.js`, because the carrier
checks the two against each other and keeping them in separate places is how
they drift apart.

If you are updating the Render dashboard by hand rather than re-pasting the
whole file, these are the only differences.

**1. Delete these six.** They held the IFQM *Skills* registration. An
environment value overrides the code, so left in place every OTP goes out under
a template id whose registered wording it does not match — accepted by the
gateway, discarded by the carrier, silently.

```
SMS_TEMPLATE_LOGIN
SMS_TEMPLATE_RESET
SMS_TEMPLATE_ACTIVATION
SMS_TEXT_LOGIN
SMS_TEXT_RESET
SMS_TEXT_ACTIVATION
```

**2. Change one.**

```
SMS_SENDER_ID=IFQMID-T
```

(It is currently `IFQMSK` — the Skills header.)

**3. Add `DB_SSL_CA`** — the contents of `ca.pem`, newlines written as `\n`.
Without it the database connection is encrypted but *not authenticated*: the
driver cannot prove the server is Aiven. Render ends a value at the first real
newline, so an unflattened PEM truncates at `-----BEGIN CERTIFICATE-----` and
fails with an issuer error that says nothing about the actual mistake.

**4. Also added**, none of them secret: `LOG_TO_FILE=0` (Render's disk is
ephemeral and production defaults to file logging, so logs would be written
where nobody can read them and lost on deploy), `RUN_BACKGROUND_JOBS=true`,
`EMAIL_QUEUE_INTERVAL_MS`, `DB_MAX_POOLS`.

**5. Leave these exactly as they are.** They are correct and are the only SMS
values still read from the environment:

```
SMS_PROVIDER=kaleyra
SMS_ENDPOINT=https://api.kaleyra.io
SMS_SID=HXAP1678914824IN
SMS_PE_ID=1201174858303838784
SMS_API_KEY=…            ← unchanged
```

After the deploy, the first lines of the log confirm it:

```
sms: kaleyra via IFQMID-T — 3 template(s) registered (registration_phone, login, password_reset)
sms: "Number Change OTP" is sent under the registration_phone registration until it has its own id — …
sms: "Mobile Number Changed — Security Alert" will NOT be sent — …
```

If you instead see `sms config: … only one of the pair is set`, one of the six
deletions was missed.

---

## Database — done

Migrations **024–031 are applied to Aiven** (27 Aug 2026), across all six
tenant schemas plus the registry.

They had been applied by hand and never recorded, so the ledger in
`ifqm_master.schema_migrations` showed nothing and the runner re-applied all
eight. That is safe — every one is guarded on `information_schema`, and 024's
only writes are a `DELETE` of settings keys the single-chain model replaced and
an `INSERT … ON DUPLICATE KEY UPDATE value = value`, which preserves a
customised chain. Verified afterwards: `ifqm_vp`'s custom chain
(`originator,team_lead,immediate_manager,department_manager,plant_head`)
survived intact, and user and idea counts are unchanged in all six.

The ledger now has the rows, so this will not repeat.

### Running migrations against a remote database

```bash
cd backend
node scripts/migrate-remote.mjs ../.env.render ../ca.pem --dry   # plan only
node scripts/migrate-remote.mjs ../.env.render ../ca.pem         # apply
```

It reads credentials from the file rather than the command line, so no database
password lands in shell history or in the process list. `--dry` prints exactly
what would run and writes nothing.

`npm run migrate` still exists and still reads `backend/.env`, which points at
your local MySQL — that is the one to use for local work.

---

## The full list

`.env.render` in the repository root is the list, with a comment above every
block explaining what it is for and what breaks without it. It is gitignored,
so it holds the real values rather than placeholders.

For a **fresh** service, `render.yaml` in the root is a Render blueprint that
declares the same variables — identifiers as literals, every key and password
as `sync: false` so a blueprint deploy prompts for them instead of storing them
in git.

---

## The four things that will stop the service booting

The server validates these and exits rather than starting insecurely. All four
print the reason.

| | Why it refuses |
|---|---|
| `JWT_SECRET` unset, example, or under 32 chars | tokens can be forged for any user in any tenant |
| DB user is `root`, or password empty | a compromised app process owns every schema on the host |
| `CORS_ORIGIN` unset or contains localhost | it would fall back to localhost and reject your own frontend |
| `FRONTEND_BASE_URL` on localhost or `http://` | password-reset links would point somewhere unreachable, or travel unencrypted |

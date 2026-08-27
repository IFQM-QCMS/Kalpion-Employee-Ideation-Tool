# Render environment — what to set, and what changed

Render does not take an uploaded file. The variables live in the service's
**Environment** tab, and it has an **"Add from .env"** button that accepts
pasted `KEY=value` lines — that is the closest thing to an upload, and it is
what the blocks below are formatted for.

Your local `backend/.env` is **not** the file to paste. It points at a local
MySQL, uses `root`, allows `localhost` as an origin, and the server refuses to
start in production with any of those. The paste block at the bottom is the
production shape.

---

## If the service is already deployed: only three things changed

The August SMS work moved the DLT template IDs and their wording out of the
environment and into `backend/src/config/smsTemplates.js`, because the carrier
checks the two against each other and keeping them in separate places is how
they drift apart.

**1. Delete these six.** They still hold the IFQM *Skills* registration. Left in
place they override the correct values, and every OTP is dropped by the carrier
for not matching its template.

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

**3. Leave these exactly as they are.** They are correct and are the only SMS
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

## Still outstanding on the database

**Migration 031 has not been applied to Aiven.** Nothing is broken while it
waits — both birth columns were always nullable, so user creation works, and the
bulk-import email counters are written in a separate statement that is allowed
to fail. Apply it when convenient:

```bash
cd backend
MASTER_DB_HOST=… MASTER_DB_USER=… MASTER_DB_PASS=… MASTER_DB_NAME=ifqm_master \
DB_SSL=true DB_SSL_CA="$(cat aiven-ca.pem)" \
npm run migrate
```

The runner keeps a ledger in `ifqm_master.schema_migrations`, so re-running it
is safe and applies only what is missing.

---

## Full production block

For a fresh service, or to check the existing one against. Replace every `…`.

```bash
NODE_ENV=production
PORT=10000

# Render sets PORT itself; the value above is a fallback. CORS_ORIGIN and
# FRONTEND_BASE_URL must be your real https frontend — the server refuses to
# start in production if either still mentions localhost, because password-reset
# links would be generated pointing at a machine nobody can reach.
CORS_ORIGIN=https://your-frontend.vercel.app
FRONTEND_BASE_URL=https://your-frontend.vercel.app

# ── Database (Aiven) ──
# Not root, and not empty: the server refuses to start on either. Use an account
# limited to the ifqm_% schemas.
MASTER_DB_HOST=….aivencloud.com
MASTER_DB_PORT=…
MASTER_DB_USER=…
MASTER_DB_PASS=…
MASTER_DB_NAME=ifqm_master
DB_SSL=true
# The whole CA certificate, newlines and all. Aiven rejects an unverified
# connection, and without this the failure reads as a network timeout.
DB_SSL_CA="-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----"

# ── Sessions ──
# At least 32 characters, and never the example value — anyone holding it can
# forge a token for any user in any tenant. Generate with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
JWT_SECRET=…
JWT_EXPIRES_IN=28800

# ── Mail (ZeptoMail) ──
# Welcome emails to new employees, password resets and the leaderboard send all
# depend on this. PLATFORM_MAIL_API_KEY is the "emailapikey" token, NOT the SMTP
# password — they are issued separately and the wrong one earns a silent 401.
PLATFORM_SMTP_HOST=smtp.zeptomail.in
PLATFORM_SMTP_PORT=587
PLATFORM_SMTP_USER=…
PLATFORM_SMTP_PASS=…
PLATFORM_MAIL_FROM=…
PLATFORM_MAIL_FROM_NAME=IFQM Ideation
PLATFORM_MAIL_API_KEY=…
# Render blocks outbound SMTP on the free tier. Set this so mail goes over
# HTTPS immediately instead of waiting out a connection timeout on every send.
PLATFORM_MAIL_TRANSPORT=api

# ── SMS (Kaleyra / Jio DLT) ──
# Template IDs and wording are NOT here — see smsTemplates.js.
OTP_ENABLED=true
SMS_PROVIDER=kaleyra
SMS_ENDPOINT=https://api.kaleyra.io
SMS_SID=HXAP1678914824IN
SMS_SENDER_ID=IFQMID-T
SMS_PE_ID=1201174858303838784
SMS_API_KEY=…

# ── Optional ──
MAX_FILE_MB=15
AI_PROVIDER=
OPENAI_API_KEY=
GEMINI_API_KEY=
QCMS_BASE_URL=
```

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

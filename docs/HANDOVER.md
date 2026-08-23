# Handover — moving the source code and databases to the customer

**Audience:** whoever receives this system on the customer's side, plus the
person handing it over.
**Scope:** getting the code, the databases and the credentials off the
development machine and running under the customer's own accounts.

This is deliberately written as a sequence with checks after each step, because
the failure mode of a handover is not "it did not work" — it is "it appeared to
work, and something was missing that nobody noticed for a month."

---

## 0. The one thing that is easy to get wrong

**The database is not in the repository, and the repository is not enough to
run the system.** Three separate things have to move:

| What | Where it lives now | How it moves |
|---|---|---|
| Source code | git repository | git bundle, or a transfer of the GitHub repo |
| Data | MySQL: `ifqm_master` + one database per organisation | `mysqldump`, restored on their server |
| Secrets | `backend/.env` — **never committed** | handed over separately, out of band |

Copy only the code and the customer gets an application that starts, connects
to nothing, and has no way in. Copy the code and the data but not the secrets
and it will not start at all. All three, or none.

---

## 1. Before you begin — decide who owns what

Settle these before moving anything, because two of them cannot be undone
quietly afterwards.

| Decision | Why it matters |
|---|---|
| **Who owns the GitHub repository** | If the customer is to own it, transfer it rather than pushing a copy — a transfer carries issues, history and settings; a copy carries none of it |
| **Who owns the domain and DNS** | Sign-in links, reset links and invoice links are all built from `FRONTEND_BASE_URL` |
| **Who holds the third-party accounts** | ZeptoMail, the Kaleyra/Jio DLT SMS account, Razorpay, and any AI provider key. These are billed to somebody — see §6 |
| **Whether history transfers** | A full clone hands over every commit, including anything ever committed by mistake. See §2.2 |

---

## 2. Moving the source code

### 2.1 The recommended route — transfer the GitHub repository

Cleanest, because nothing has to be reconstructed:

1. Customer creates (or nominates) a GitHub organisation.
2. On the repository: **Settings → General → Danger Zone → Transfer ownership**.
3. Add their engineers as collaborators; remove yourself once they confirm access.
4. They clone it: `git clone <their-new-url> ifqm`

### 2.2 If GitHub is not an option — a git bundle

A bundle is a single file containing the entire repository, history included,
and it verifies itself on the other end:

```bash
cd /c/xampp/htdocs/ifqm
git bundle create ifqm-source.bundle --all
```

They restore it with:

```bash
git clone ifqm-source.bundle ifqm
cd ifqm && git log --oneline | head    # sanity check: history is present
```

**Check the history before you send it.** A bundle carries every commit ever
made, including any secret committed and later removed — removing a file in a
later commit does not remove it from history:

```bash
git log --all --oneline -S "PLATFORM_SMTP_PASS" | head
git log --all --oneline -- backend/.env | head
```

If either returns anything, either rewrite history (`git filter-repo`) before
bundling, or hand over a **squashed** repository instead:

```bash
git checkout --orphan handover && git add -A
git commit -m "Initial handover snapshot"
git bundle create ifqm-source.bundle handover
```

That trades the history for certainty about what is inside. State plainly which
of the two you sent.

### 2.3 What must NOT be in the transfer

`.gitignore` already excludes these; confirm rather than assume:

```bash
git ls-files | grep -E "\.env$|node_modules|backups/|uploads/" || echo "clean"
```

- `backend/.env` — secrets, moved separately (§4)
- `node_modules/` — reinstalled from `package-lock.json`
- `backend/uploads/` — **real customer attachments**; these move with the data (§3.3)
- `backend/backups/` — database dumps

---

## 3. Moving the databases

### 3.1 What exists

One registry plus one database per organisation:

```bash
mysql -u root -e "SHOW DATABASES LIKE 'ifqm%';"
```

At the time of writing: `ifqm_master` (registry — organisations, plans,
billing, login directory, one-time codes) and one `ifqm_<slug>` per customer
organisation.

**`ifqm_master` is not optional and not secondary.** It holds the list of
tenants, which is the only thing that knows the others exist. Restore it first.

### 3.2 Take the dump

The repository already has a script that does all of this correctly:

```bash
cd backend && npm run backup
```

It writes per-schema `.sql` files **and copies `backend/uploads/`**, which is
the part people forget. If you dump by hand instead, dump every database, not
just master:

```bash
for db in $(mysql -u root -N -e "SHOW DATABASES LIKE 'ifqm%';"); do
  mysqldump -u root --single-transaction --routines --events "$db" > "${db}.sql"
done
```

`--single-transaction` takes a consistent snapshot without locking the tables,
so the site can stay up while it runs.

### 3.3 Attachments live on disk, not in MySQL

`backend/uploads/` holds every file anyone attached to an idea. The database
stores only the filename. **A database-only handover silently loses every
attachment** — the rows survive, the ideas open, and the file links 404.

```bash
tar -czf ifqm-uploads.tar.gz -C backend uploads
```

### 3.4 Restore on their server

```bash
mysql -u root -e "CREATE DATABASE ifqm_master CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root ifqm_master < ifqm_master.sql
# then each tenant, same pattern
tar -xzf ifqm-uploads.tar.gz -C /path/to/backend
```

### 3.5 Verify the restore — do not skip this

Count rows on both sides and compare. A restore that half-worked looks
identical to one that worked:

```bash
mysql -u root -N -e "
SELECT 'tenants',    COUNT(*) FROM ifqm_master.tenants
UNION ALL SELECT 'plans', COUNT(*) FROM ifqm_master.plans
UNION ALL SELECT 'users', COUNT(*) FROM ifqm_<slug>.users
UNION ALL SELECT 'ideas', COUNT(*) FROM ifqm_<slug>.ideas;"
```

Then apply any migrations the dump predates — it is safe to run them all, they
are guarded and idempotent, **with one exception**:

```bash
cd backend && npm run migrate
```

> **Do not re-run `db/migrations/017_quota_not_a_cap_master.sql` by hand.** It
> is the only migration without an idempotency guard and it ends in
> `DELETE FROM tenant_api_usage` — running it against a restored database wipes
> the accumulated API usage history. `npm run migrate` tracks what has been
> applied; running files by hand does not.

---

## 4. Moving the secrets

`backend/.env` is not in git and must not be. Send it **out of band** — a
password manager share, or an encrypted file with the passphrase given over a
different channel. Not email, not the same channel as the code.

The variables that must be present, grouped by what breaks without them:

| Group | Variables | Missing means |
|---|---|---|
| Database | `MASTER_DB_HOST/USER/PASS/NAME`, `FALLBACK_DB_*` | will not start |
| Identity | `JWT_SECRET`, `JWT_EXPIRES_IN` | nobody can sign in |
| Public URL | `FRONTEND_BASE_URL`, `CORS_ORIGIN` | reset and invoice links point nowhere |
| Email | `PLATFORM_SMTP_*`, `PLATFORM_MAIL_API_KEY`, `PLATFORM_MAIL_FROM` | no codes, no invoices, no temporary passwords |
| SMS | `SMS_PROVIDER`, `SMS_SID`, `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_PE_ID`, `SMS_TEMPLATE_*` | no codes by SMS |
| Limits | `MAX_FILE_MB`, `DB_POOL_SIZE`, `DB_MAX_POOLS` | defaults apply |
| Optional | `OPENAI_API_KEY` / `GEMINI_API_KEY`, `QCMS_BASE_URL` | scoring falls back to the built-in heuristic |

**`JWT_SECRET` should be regenerated at handover, not copied.** Changing it
signs everybody out once, which is the correct thing to happen when a system
changes hands — the old value is on your machine and in your shell history.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**`FRONTEND_BASE_URL` must be their real https URL.** The application refuses to
start in production if it still points at localhost, because password-reset and
invoice links are built from it.

---

## 5. Bringing it up on their side

```bash
cd backend && npm ci && cd ../frontend && npm ci
cd ../backend && npm run migrate      # brings a restored dump up to date
npm start
```

Then check, in this order:

1. `curl https://<their-domain>/api/health` → `{"success":true,"status":"ok"}`
2. Sign in as a platform admin → the organisation list matches §3.5
3. Sign in as an ordinary employee of one tenant → their ideas are there
4. Open an idea with an attachment → **the file downloads** (proves §3.3 worked)
5. Trigger a password reset → the email arrives, and its link points at their
   domain rather than localhost
6. Submit a test idea and approve it through one step

Item 4 is the one that catches a partial handover. Items 5 and 6 prove the
outbound integrations were carried over rather than merely configured.

---

## 6. Third-party accounts — the part that is not technical

These are contracts, not configuration. Each is billed to somebody, and each
will keep working after handover right up until the card behind it is cancelled.

| Service | Used for | To transfer |
|---|---|---|
| **ZeptoMail** | all outbound email | new account in their name, or transfer billing; issue a fresh API key and revoke the old one |
| **Kaleyra / Jio DLT** | SMS one-time codes | the DLT registration is tied to a Principal Entity — see `docs/SMS_DLT_TEMPLATES.docx`; templates must be registered under **their** PE ID |
| **Razorpay** | subscription payments | their own merchant account; keys replaced |
| **AI provider** (optional) | idea quality scoring | optional — with no key the built-in heuristic is used |
| **Hosting / DNS** | everything | their accounts, their domain |

**Revoke your own keys once theirs are confirmed working, not before.** Doing
both at once produces an outage nobody can diagnose, because the system will
look correctly configured while failing on every send.

---

## 7. Known issues to hand over honestly

Do not let these be discovered later. Each is documented in the technical
manual; this is the short form.

| Issue | Impact | Status |
|---|---|---|
| **Uploads on an ephemeral disk** | On Render's free tier, attachments vanish on redeploy. On the documented VPS path they persist and are backed up | Depends entirely on which host they use — see `docs/HOSTING_COMPARISON.md`. Object storage is the real fix |
| **No scheduled backup or restore drill** | `npm run backup` exists and works, but nothing runs it on a schedule and no restore has been rehearsed | Process gap for them to close on day one — see §8 |
| **Connection pools capped at 50** | Beyond ~50 concurrently-active organisations, the least recently used pool is closed and reopened on next use | Working as designed; raise `DB_MAX_POOLS` if their MySQL `max_connections` allows |
| **SMS templates** | Currently every message goes out under one approved DLT template, so a password reset reads "complete your activation" | Fixed by registering the four templates in `docs/SMS_DLT_TEMPLATES.docx` under their own PE ID |

---

## 8. The first week on their side

1. **Schedule `npm run backup`** — daily, to storage that is not the app server.
2. **Rehearse a restore into a scratch database** and compare row counts. A
   backup nobody has restored is a hope, not a backup.
3. **Rotate every credential** you had access to, once theirs are working.
4. **Remove your access** — GitHub, server, database, third-party consoles.
5. **Set a calendar reminder** for the DLT template approvals and any plan
   renewal dates already in `ifqm_master.tenants`.

---

## 9. Handover checklist

Sign this off together, on a call, with both parties watching:

- [ ] Repository transferred or bundle verified (`git log` shows history)
- [ ] `.env` delivered out of band; `JWT_SECRET` regenerated
- [ ] `ifqm_master` restored, tenant count matches
- [ ] Every tenant database restored, row counts match
- [ ] `uploads/` restored — an attachment opens end to end
- [ ] `npm run migrate` run clean on the restored data
- [ ] Health endpoint green on their domain
- [ ] Password-reset email arrives, link points at their domain
- [ ] A test idea submitted and approved through one step
- [ ] Third-party accounts in their name; your keys revoked
- [ ] Backup scheduled; one restore rehearsed
- [ ] Your access removed from every system above

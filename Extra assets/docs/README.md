# Kalpion

A full-stack internal platform that lets employees submit improvement ideas, get them AI-scored, route them through a multi-level approval chain, and track everything on a live leaderboard and community voting board. Built as a single PHP/MySQL app with no framework dependencies — just drop it into XAMPP and it runs.

---

## What it does

Every organisation has people with great ideas and no clear way to surface them. This tool fixes that. Employees log in, describe a problem and their proposed fix, and the system scores it automatically (via Google Gemini or a built-in heuristic fallback), routes it up the management chain, and awards points when ideas get approved or implemented.

The whole thing lives in one `index.php` with a small `api/` folder behind it — no build step, no Node, no Composer.

---

## Features

**For employees**
- Submit ideas with a structured 5-step wizard (situation → solution → impact → co-suggesters + options → review)
- Attach supporting files (images, PDFs, up to 10 MB each)
- Tag up to 2 co-suggesters who share the credit
- Submit anonymously — identity hidden from peers, still visible to managers
- Pick an idea template (Cost Reduction, Process Improvement, Safety, etc.)
- Link submission to an active Innovation Challenge
- Live duplicate detection — warns if a similar idea already exists
- See your idea scored in real-time with a breakdown across 6 dimensions
- Community star rating (1–5 ★) on any idea that isn't yours
- In-app notifications when your idea moves through the workflow
- Personal profile with points total and idea history

**For managers / reviewers**
- Review queue sorted by SLA due date (overdue ideas flagged red) then AI score
- One-click Approve / Reject / Implement with optional comment
- Escalation chain — approvals automatically route up the hierarchy; only executives or admins give final approval
- Bulk review — select multiple ideas and approve or reject them in one action
- Bulk assign ideas to a named committee (multi-reviewer workflow) with custom approval threshold
- ROI tracking — record financial impact on implemented ideas (cost saving, revenue, etc.)
- Implementation tracking — assign an owner, target date, and status (In Progress / Completed / On Hold)
- Dashboard KPI cards showing pending reviews and overdue reviews
- Export ideas list as CSV or print a full analytics report

**For admins**
- User management — create, edit, deactivate users with an 8-level role hierarchy
- Org Settings panel — configure SLA days, escalation days, feature flags, and SMTP email
- Send test email directly from the settings panel
- Batch re-score all ideas with the current scoring model
- Audit log — immutable record of every action ever taken on every idea

**For everyone**
- Idea Board — community voting page with up/down votes and net score ranking
- Innovation Challenges — campaigns employees can submit ideas into
- Leaderboard — individual and department rankings by points
- Top Ideas board ranked by AI quality score
- Analytics dashboard: submission trends, status breakdown, impact area heatmap
- Light / dark mode
- English / Hindi bilingual UI (`data-i18n` driven, live toggle)
- Collapsible sidebar

---

## Tech stack

| Layer | Choice |
|---|---|
| Backend | PHP 8.2 (vanilla, no framework) |
| Database | MySQL 8.0 / MariaDB 10.6+ |
| Frontend | Vanilla JS SPA — no React, no Vue, no build tool |
| Styling | Custom CSS with Inter font, CSS custom properties, dark mode |
| AI scoring | Google Gemini 2.0 Flash (optional — heuristic fallback built in) |
| Auth | PHP sessions with bcrypt password hashing |
| Email | Raw SMTP via `fsockopen` with STARTTLS/SSL support |
| Server | Apache via XAMPP (or any PHP-capable web server) |

---

## Scoring engine

Ideas are scored 0–100 across six dimensions. If you have a Gemini API key set in `api/config.php`, the AI evaluates the idea and returns a score + explanation. If not (or the API is down), the built-in heuristic engine runs automatically.

| Dimension | Max | What it looks at |
|---|---|---|
| Problem Clarity | 20 | Sentence structure, lexical diversity, quantitative evidence, causal language |
| Solution Quality | 20 | Actionable steps, mechanism specificity, vocabulary richness |
| Feasibility | 15 | Resource awareness, realistic scope, depth-vs-claim match |
| Business Impact | 20 | Impact level declared, areas touched, tangible benefit stated |
| Measurability | 10 | Numbers in baseline, from→to targets, benchmark language |
| Innovation | 15 | Technology angle, new process design, cross-functional reach |

Generic phrases like "improve efficiency" or "make it better" are penalised — ideas need to be specific to score well.

---

## Approval workflows

**Hierarchical (default)**
Idea goes to the submitter's direct manager. If the manager is not a final approver (executive/admin), the idea automatically escalates to their manager, and so on up the chain. Only an executive or admin can give the final Approved status. The escalation level is tracked and shown as a badge on each idea card.

**Multi-reviewer / Committee**
An admin routes the idea to a named group of reviewers and sets an approval threshold (e.g. 60%). Each reviewer votes independently. When all votes are in, the system automatically finalises the status. A threshold of 100% means any single rejection blocks the idea.

---

## Role hierarchy

| Role | Can do |
|---|---|
| `trainee` | Submit ideas, vote, view leaderboard |
| `employee` | Same as trainee |
| `team_lead` | All above + review direct reports' ideas (escalates to manager) |
| `project_lead` | All above + broader review scope |
| `manager` | All above + committee assignment, analytics, bulk review |
| `senior_manager` | All above + full org analytics |
| `executive` | Final approval authority + read-only analytics |
| `admin` | All above + user management, org settings, audit log |
| `super_admin` | Full access including user hierarchy and system stats |

---

## Multi-tenancy

The app can run as a single-org install (the default) or serve multiple organisations from one codebase. When multi-tenant mode is active, an `ifqm_master` database maps HTTP hostnames or URL slugs to per-tenant databases and isolated upload directories.

If `ifqm_master` does not exist, the app falls back gracefully to the default `ifqm_ideation` database — existing installs keep working without any changes.

To provision a new tenant:

```bash
php provision_tenant.php \
  --name="Acme Corp" \
  --slug="acme" \
  --domain="acme.yourhost.com" \
  --admin-email="admin@acme.com" \
  --admin-pass="changeme"
```

---

## Installation (single tenant, XAMPP)

1. Clone or copy this folder into `C:\xampp\htdocs\ifqm\`

2. Import the base schema:
```sql
-- In phpMyAdmin or MySQL CLI:
SOURCE /path/to/ifqm/schema.sql;
```

3. If updating an existing install, run the feature migrations:
```sql
SOURCE /path/to/ifqm/schema_updates.sql;
```

4. (Optional) Set your Gemini API key in `api/config.php`:
```php
define('GEMINI_API_KEY', 'your-key-here');
```
The app works fully without it using the built-in heuristic scorer.

5. Visit `http://localhost/ifqm/`

No `composer install`, no `npm install`, no `.env` to create.

---

## Project structure

```
ifqm/
├── index.php                  # Entire frontend SPA + login page (~5500 lines)
├── schema.sql                 # Clean schema for fresh installs
├── schema_updates.sql         # Incremental migrations (features 1–15)
├── database.sql               # Schema + seed data
├── master.sql                 # ifqm_master schema for multi-tenant mode
├── cleanup.sql                # Role ENUM migration for existing databases
├── provision_tenant.php       # CLI script to onboard a new organisation
├── api/
│   ├── config.php             # DB connections, tenant resolution, shared helpers
│   ├── auth.php               # Login / logout / session check
│   ├── ideas.php              # Idea CRUD, workflow, escalation, voting board, bulk review
│   ├── users.php              # Users, notifications, leaderboard, analytics, audit
│   ├── comments.php           # Threaded discussion comments on ideas
│   ├── challenges.php         # Innovation challenges CRUD
│   ├── mailer.php             # Email queue + raw SMTP sender
│   ├── export.php             # CSV export (ideas, leaderboard) + print analytics report
│   ├── settings.php           # Org-level settings (SLA, SMTP, feature flags)
│   ├── platform.php           # Platform-admin API (tenant management)
│   ├── score.php              # AI scoring engine (Gemini + heuristic fallback)
│   ├── upload.php             # File attachment handler
│   └── uploads/               # Per-tenant uploaded files (gitignored)
└── assets/
    └── ifqm-logo.png
```

---

## Configuration (`api/config.php`)

```php
// Gemini AI scoring — leave empty to use heuristic scorer only
define('GEMINI_API_KEY', '');

// Points awarded at each milestone
define('POINTS_SUBMIT',      10);
define('POINTS_APPROVED',    25);
define('POINTS_IMPLEMENTED', 65);

// Max upload size per file
define('MAX_FILE_MB', 10);

// Session idle timeout in seconds (default 8 hours)
define('SESSION_LIFETIME', 28800);
```

Org-level settings (SLA days, SMTP credentials, feature flags) are stored in the `org_settings` database table and are editable at runtime from the Admin Panel → Org Settings tab.

---

## First-time setup

After running `schema.sql`, a default super_admin account is created automatically:

| Field | Value |
|---|---|
| Email | `admin@ifqm.test` |
| Password | `changeme123` |

> **Change this password immediately on first login.** Create new users for your team and delete this account once onboarded.

### Platform admin (IFQM team only)

The platform-level admin account is stored separately in `ifqm_master.platform_admins`:

| Field | Value |
|---|---|
| Email | `platform@ifqm.io` |
| Password | `password` |

Log in at the platform level by **leaving the Organization Code blank** on the login screen.

---

## Security checklist before production

- [ ] Change all default passwords (admin accounts, platform admin)
- [ ] Set `GEMINI_API_KEY` in `api/config.php` (optional — heuristic scorer works without it)
- [ ] Configure real SMTP credentials in Org Settings
- [ ] Enable HTTPS on your web server
- [ ] Set `MASTER_DB_PASS` and `FALLBACK_DB_PASS` to strong credentials in `api/config.php`
- [ ] Review the `.gitignore` — ensure `api/uploads/` and any credentials files are excluded
- [ ] Run `schema_updates.sql` on all existing tenant databases after updating the codebase

---

## Security

- Passwords hashed with bcrypt (`password_hash` / `password_verify`)
- All DB queries use PDO prepared statements — no string interpolation
- Role checks enforced server-side on every API request — frontend gates are UX only
- Uploaded files validated by MIME type before saving
- Audit log is append-only; no row is ever updated or deleted
- Session idle timeout enforced at PHP level, JS visibility-change listener, and 10-minute polling interval

---

## Known limitations

- No OAuth / SSO — email + password only
- Bilingual support is English and Hindi; more languages can be added by extending the `TRANSLATIONS` object in `index.php`
- No rate limiting on the AI scoring or email endpoints
- File uploads go to local disk — swap `upload.php` for S3/R2 for horizontal scaling
- MySQL must be started manually on XAMPP (not registered as a Windows service by default)

---

## License

MIT. Do whatever you want with it — just don't ship the demo passwords to production.

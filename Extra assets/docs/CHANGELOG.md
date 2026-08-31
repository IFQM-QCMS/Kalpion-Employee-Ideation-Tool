# IFQM Changelog — Security & Performance Hardening

> **Who is this for?** Admins and developers. Each section has two parts:
> - **Technical** — what changed and why (for developers/DevOps)
> - **Layman's** — plain-English explanation (for non-technical readers/admins)

---

## [v2.0] — May 2026 — Production Hardening Release

### 1. CSRF Token Protection (Anti-CSRF)

**Technical:**
- Added `generateCsrfToken()`, `validateCsrfToken()`, and `requireCsrf()` helpers to `api/config.php`
- Server generates a cryptographically random 64-char hex token on login, stored in `$_SESSION['csrf_token']`, valid for 1 hour
- Every state-changing (POST) API endpoint now calls `requireCsrf()` before processing
- The `X-CSRF-Token` HTTP header is required on all POST/PUT/PATCH requests
- Frontend (`index.php`) stores the token in a `csrfToken` variable and injects it via `...csrfHeaders()` spread into all fetch calls
- Token is returned in the `?action=me` response so `initApp()` syncs it immediately after login
- Token is cleared on logout

**Files changed:** `api/config.php`, `api/ideas.php`, `api/users.php`, `api/settings.php`, `api/comments.php`, `api/upload.php`, `api/votes.php`, `api/challenges.php`, `index.php`

**Layman's:**
- **What:** Added a hidden security token that every form submission must include.
- **Why:** Prevents a malicious website from tricking a logged-in user into submitting forms (like approving an idea or deleting a user) without their knowledge.
- **Impact:** Users will not notice anything different. All legitimate actions work normally. Malicious cross-site attempts will be blocked.

---

### 2. Brute-Force Login Protection

**Technical:**
- Added in-memory brute-force tracking to `api/auth.php`
- Failed login attempts are tracked per `email + org_slug` combination using `$_SESSION['failed_' . md5($loginId)]`
- After 5 consecutive failed attempts, the account is locked for 15 minutes
- Lockout expiry is checked on each login and resets automatically
- Successful login clears all failed attempt counters
- API returns `429 Too Many Requests` with `retry_after` seconds during lockout

**Layman's:**
- **What:** After 5 wrong password attempts, the account locks for 15 minutes.
- **Why:** Prevents automated bots from guessing your password by trying thousands of combinations per second.
- **Impact:** Legitimate users who forget their password can wait 15 minutes or use the "Forgot Password" link. No account is ever permanently locked.

---

### 3. Session Fixation Prevention

**Technical:**
- `session_regenerate_id(true)` is called immediately after successful password verification — before setting `$_SESSION['user']`
- Applies to both platform admin login and tenant user login in `api/auth.php`
- Ensures the old (pre-login) session ID is destroyed and replaced with a fresh one

**Layman's:**
- **What:** When you successfully log in, your session ID changes to something new.
- **Why:** Prevents a malicious website from knowing your session ID before you log in, then hijacking it after you log in.
- **Impact:** Completely invisible to users. Standard security practice.

---

### 4. Password Reset / Forgot Password Flow

**Technical:**
- Added `?action=forgot_password` endpoint in `api/auth.php`: generates a bcrypt-hashed token, stores it in `password_reset_tokens` table with 1-hour expiry, sends a reset email via configured SMTP
- Added `?action=reset_password` endpoint: verifies token against all stored hashes (no timing leak), updates `users.password_hash`, deletes token after use
- Added `password_reset_tokens` table to schema with foreign key to `users`
- Frontend: "Forgot your password?" link on login page triggers `openForgotPassword()` → uses `prompt()` for email collection → shows toast with result
- Reset page: `openResetPassword()` reads `?reset_token=` from URL → double-prompt for new password confirmation → API call → clears URL params on success
- Email enumeration is prevented — the API always returns success regardless of whether the email exists

**Files changed:** `api/auth.php`, `schema.sql`, `schema_updates.sql`, `database.sql`, `index.php`

**Layman's:**
- **What:** There's now a "Forgot your password?" link on the login page.
- **Why:** Users who forget their password can reset it themselves without asking an admin.
- **How it works:**
  1. Click "Forgot your password?" and enter your email
  2. If your email is registered, you'll receive an email with a reset link (valid for 1 hour)
  3. Click the link, enter a new password, and log in normally
  4. The old password stops working immediately
- **Impact:** Users can self-serve password resets. Admins no longer need to manually reset passwords.

---

### 5. Database Performance Indexes

**Technical:**
- Added 11 composite indexes to `schema.sql` (new installs) and `schema_updates.sql` (existing installs)
- Indexes cover: `ideas(status)`, `ideas(submitted_at)`, `ideas(submitter_id, status)`, `ideas(current_reviewer_id)`, `notifications(user_id, is_read)`, `idea_votes(idea_id)`, `idea_community_votes(idea_id)`, `idea_comments(idea_id)`, `idea_workflow(idea_id)`, `idea_reviewers(idea_id, reviewer_id)`, `password_reset_tokens(user_id)`
- All indexes use `CREATE INDEX IF NOT EXISTS` for idempotency

**Files changed:** `schema.sql`, `schema_updates.sql`, `database.sql`

**Layman's:**
- **What:** Added database "bookmarks" to speed up common queries.
- **Why:** When the app lists ideas, filters by status, or shows your notifications, it needs to find rows quickly. These indexes act like a book's index — instead of reading every page to find something, the database jumps directly to the right page.
- **Impact:** Faster page loads, especially as the number of ideas and users grows. Users won't notice directly, but the app will feel snappier.

---

## Summary Table

| # | Feature | Risk Level | User Impact |
|---|---|---|---|
| 1 | CSRF tokens on all POST requests | High | Invisible (security) |
| 2 | Brute-force lockout after 5 fails | High | 15-min wait if locked out |
| 3 | Session ID regeneration on login | High | Invisible (security) |
| 4 | Forgot password / reset flow | Medium | New UI link on login page |
| 5 | Database indexes | Low | Faster queries |

---

## Migration Instructions (Existing Installations)

If you already have an `ifqm_ideation` database running, run the migration SQL to get the new features:

```sql
SOURCE C:/xampp/htdocs/ifqm/schema_updates.sql;
```

This creates the `password_reset_tokens` table and adds all 11 performance indexes without touching existing data.

---

## Breaking Changes

- **None.** All changes are backward-compatible additions.
- CSRF tokens are transparent — users don't need to do anything.
- Brute-force protection works automatically with no configuration.
- Password reset requires SMTP to be configured in Org Settings to send emails (the flow still works without it — the user just won't receive an email).

---

## Security Notes

- The CSRF token is a cryptographically random 64-character hex string generated with `random_bytes(32)` — not guessable or predictable
- Tokens use `hash_equals()` for comparison to prevent timing attacks
- Password reset tokens are bcrypt-hashed before storage — even if the `password_reset_tokens` table is leaked, tokens cannot be reversed
- The forgot password endpoint always returns success to prevent email enumeration attacks
- Session IDs are regenerated using `session_regenerate_id(true)` which overwrites the old session file on disk
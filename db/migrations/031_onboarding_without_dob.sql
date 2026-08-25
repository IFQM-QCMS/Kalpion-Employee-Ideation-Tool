-- ============================================================================
--  031  Onboarding without a date of birth; welcome emails counted
--
--    FOR EACH TENANT DATABASE:
--      mysql -u root -p ifqm_<slug> < db/migrations/031_onboarding_without_dob.sql
--
--  Tenant databases only — users and imports live nowhere else.
--
--  ── What changed above this line ───────────────────────────────────────────
--
--  A date of birth was required to create a user, by every route: the Add User
--  form, the bulk import sheet, and the API behind both. It existed to feed one
--  function — the first-login password was the first 4 letters of the name plus
--  the birth year — and nothing else in the product ever read it.
--
--  That is a poor trade. A date of birth is a personal identifier people are
--  asked for constantly and which is used, elsewhere, to prove who they are. We
--  were collecting it from every employee in the company to build a throwaway
--  credential that is replaced at first login.
--
--  A phone number is already required of every account, because it carries
--  sign-in codes and password resets. So the formula is now the first 4 letters
--  of the name plus the LAST 4 DIGITS of the phone number, and an account with
--  an email address does not use the formula at all — it is sent a random
--  password instead, which is strictly better because the channel is private.
--
--  ── The columns are kept ───────────────────────────────────────────────────
--
--  users.date_of_birth and users.year_of_birth are NOT dropped, and are simply
--  no longer written. Two reasons. Dropping a column is the one schema change
--  that cannot be rolled back by re-running a migration — the data is gone the
--  moment it executes, on seven production databases at once. And organisations
--  that imported employees under the old rule have real values in there; a
--  customer who wants them erased should be able to ask, and be told yes,
--  rather than discovering we did it unannounced during an unrelated release.
--
--  What this migration DOES do is make them nullable, so an INSERT that no
--  longer mentions them is legal. That is the whole schema change here.
-- ============================================================================

-- ── Portability note ────────────────────────────────────────────────────────
-- Some MySQL deployments (Aiven's default among them) run with ANSI_QUOTES, in
-- which "..." is an IDENTIFIER, not a string. The guarded statements below build
-- SQL as text and would be read as column names there — the failure looks like
-- `Unknown column 'ALTER TABLE ...'`, which is baffling until you know why.
-- Dropped for this session only, so the file parses identically everywhere.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @is_tenant := (SELECT COUNT(*) FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users');

-- ── users.date_of_birth / year_of_birth: allow NULL ─────────────────────────
-- Only touched if the column is currently NOT NULL, so re-running is free.

SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
                   AND COLUMN_NAME = 'date_of_birth' AND IS_NULLABLE = 'NO') > 0,
  'ALTER TABLE users MODIFY COLUMN date_of_birth DATE NULL DEFAULT NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
                   AND COLUMN_NAME = 'year_of_birth' AND IS_NULLABLE = 'NO') > 0,
  'ALTER TABLE users MODIFY COLUMN year_of_birth SMALLINT NULL DEFAULT NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── user_import_jobs: how many welcome emails actually went out ─────────────
--
-- An import now sends mail, and mail fails in ways an insert does not: a
-- mailbox that bounces, a provider that rate-limits, a tenant with no SMTP
-- configured at all. Those accounts are created and perfectly valid, so the
-- import must not be reported as failed — but an administrator still has to be
-- able to find out that fifty people never received the password they are
-- waiting for. Without these two counters that failure is only in the log.

SET @has_jobs := (SELECT COUNT(*) FROM information_schema.TABLES
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_import_jobs');

SET @sql := IF(@has_jobs > 0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_import_jobs'
                   AND COLUMN_NAME = 'emailed_count') = 0,
  'ALTER TABLE user_import_jobs ADD COLUMN emailed_count INT NOT NULL DEFAULT 0 AFTER created_count',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@has_jobs > 0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_import_jobs'
                   AND COLUMN_NAME = 'email_failed_count') = 0,
  'ALTER TABLE user_import_jobs ADD COLUMN email_failed_count INT NOT NULL DEFAULT 0 AFTER emailed_count',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 'emailing' is a new phase value. The column is a VARCHAR(24), so it already
-- accommodates it; noted here only because the phase list is documented in
-- migration 002 and this is where the extra value came from.

-- ============================================================================
--  039  A platform admin proves the address and the number before the account
--       can be used
--
--    mysql -u root -p ifqm_master < db/migrations/039_platform_admin_verification_master.sql
--
--  Master registry only — platform_admins lives nowhere else. The _master
--  suffix is what the runner routes on.
--
--  ── Why this account in particular ─────────────────────────────────────────
--
--  A platform admin can reach every tenant on the platform: every organisation's
--  people, ideas, billing and support history. It is the widest credential the
--  product issues, and until now it was created by typing a name, an address and
--  a password into a form. Nothing checked that the address existed, that anyone
--  read it, or that the number belonged to the person being given the keys — a
--  typo in the email field produced a working account that its intended owner
--  could never receive a reset for, and the account still worked.
--
--  ── Existing accounts are grandfathered, deliberately ──────────────────────
--
--  Both timestamps are back-filled for rows that already exist. Leaving them
--  NULL would lock every current platform admin out of the console on the next
--  deploy — including the only account that can create another one — and there
--  is no way back in without editing SQL by hand. An outage of the vendor
--  console is not a security improvement.
--
--  What it does mean is that today's admins have no verified number on file, so
--  the console lists their verification state and says which of them predate
--  the rule. Making them re-verify is then a decision an operator takes with
--  their eyes open, rather than one this file takes for them at 2am.
-- ============================================================================

-- Aiven's default sql_mode includes ANSI_QUOTES, under which "..." is an
-- identifier rather than a string. The guarded statements below build SQL as
-- text and would be read as column names there. Dropped for this session only.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has_tbl := (SELECT COUNT(*) FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_admins');

-- ── phone ───────────────────────────────────────────────────────────────────
-- Nullable, because the rows that already exist have no number and inventing
-- one would be worse than recording that we do not have it. Every account
-- created from here on is refused without a valid one.
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_admins'
                    AND COLUMN_NAME = 'phone');
SET @sql := IF(@has_tbl > 0 AND @has_col = 0,
  'ALTER TABLE platform_admins ADD COLUMN phone VARCHAR(20) NULL AFTER email',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── the two proofs ──────────────────────────────────────────────────────────
-- Timestamps rather than booleans: "verified" is a thing that happened at a
-- moment, and knowing when is what lets somebody later ask whether it happened
-- before or after an incident. A boolean throws that away for one byte.
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_admins'
                    AND COLUMN_NAME = 'email_verified_at');
SET @sql := IF(@has_tbl > 0 AND @has_col = 0,
  'ALTER TABLE platform_admins ADD COLUMN email_verified_at DATETIME NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_admins'
                    AND COLUMN_NAME = 'phone_verified_at');
SET @sql := IF(@has_tbl > 0 AND @has_col = 0,
  'ALTER TABLE platform_admins ADD COLUMN phone_verified_at DATETIME NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── grandfather what is already there ───────────────────────────────────────
-- Stamped with created_at, not NOW(): these accounts were not verified today,
-- and writing today's date would assert something that did not happen. The
-- creation date is the honest answer to "since when has this been trusted".
--
-- Guarded on both columns being NULL so a re-run cannot overwrite a real
-- verification that has since taken place.
SET @sql := IF(@has_tbl > 0,
  'UPDATE platform_admins
      SET email_verified_at = COALESCE(created_at, NOW()),
          phone_verified_at = COALESCE(created_at, NOW())
    WHERE email_verified_at IS NULL AND phone_verified_at IS NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

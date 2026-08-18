-- ============================================================================
--  025  Sign in with a username; email is no longer compulsory
--
--    Master registry:
--      mysql -u root -p ifqm_master < db/migrations/025_username_login.sql
--    Then FOR EACH TENANT DATABASE (the same file — it detects which it is in):
--      mysql -u root -p ifqm_<slug> < db/migrations/025_username_login.sql
--
--  ── What changes ───────────────────────────────────────────────────────────
--
--  users.email was NOT NULL UNIQUE and was the login identifier. An employee
--  without a company mailbox — which on a shop floor is most of them — had to
--  be given a fabricated address before an account could exist at all.
--
--  So: users.username is added, and users.email becomes nullable. An account
--  needs at least one of the two, which is enforced in userService rather than
--  by a CHECK constraint, so the message can say which field to fill in.
--
--  ── Why the username is unique across the whole platform ───────────────────
--
--  login_directory has PRIMARY KEY (identifier) and maps an identifier to the
--  organisation that owns it. That single key is what lets somebody sign in
--  without typing an org code: one point lookup finds the tenant, one indexed
--  lookup inside it finds the person.
--
--  Per-organisation usernames would break that key — 'rkumar' would no longer
--  identify one row, so the PK would have to become (tenant_id, identifier),
--  and a username with no org code could then only be resolved by querying
--  EVERY tenant database on EVERY sign-in. That is O(customers) per login and
--  gets worse as the platform sells. Requiring the org code would avoid the
--  scan, but at that point code-free sign-in has been given up to arrive back
--  at the same two lookups this design already has.
--
--  The cost of the choice is that the first organisation to claim a username
--  holds it platform-wide. That is the same bargain email already makes.
--
--  ── Why a username cannot collide with an email or a phone ─────────────────
--
--  All three share one keyspace, so the format rules have to keep them apart,
--  and they do it structurally rather than by convention:
--
--    email     contains '@'          — usernames forbid it
--    phone     reduces to digits     — usernames must contain a letter
--    username  3-30 of [a-z0-9._-]
--
--  Enforced in directoryService.isUsername(). No pair of the three can produce
--  the same key.
-- ============================================================================

-- ── Tenant databases ────────────────────────────────────────────────────────

SET @is_tenant := (SELECT COUNT(*) FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users');

-- username: nullable, unique. MySQL lets a UNIQUE index hold any number of
-- NULLs, so every existing account stays valid with no username at all.
SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
                   AND COLUMN_NAME = 'username') = 0,
  'ALTER TABLE users ADD COLUMN username VARCHAR(50) NULL DEFAULT NULL AFTER employee_id',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
                   AND INDEX_NAME = 'uq_users_username') = 0,
  'ALTER TABLE users ADD UNIQUE KEY uq_users_username (username)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- email: NOT NULL -> NULL. The UNIQUE index is kept and, like username above,
-- goes on tolerating as many NULLs as there are accounts without an address.
SET @sql := IF(@is_tenant > 0 AND (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
                   AND COLUMN_NAME = 'email') = 'NO',
  'ALTER TABLE users MODIFY COLUMN email VARCHAR(150) NULL DEFAULT NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- An account created before this migration may carry '' rather than a real
-- address (nothing enforced a format on import). Empty string is not "no
-- address" to a UNIQUE index — it is a value, and the second such account
-- would collide with the first.
SET @sql := IF(@is_tenant > 0, 'UPDATE users SET email = NULL WHERE email = ""', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── Master registry ─────────────────────────────────────────────────────────

SET @has_dir := (SELECT COUNT(*) FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'login_directory');

SET @sql := IF(@has_dir > 0,
  "ALTER TABLE login_directory MODIFY COLUMN id_type ENUM('email','phone','username') NOT NULL",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

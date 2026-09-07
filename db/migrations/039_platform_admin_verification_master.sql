-- 039 A platform admin proves the address and the number before the account

-- Aiven's default sql_mode includes ANSI_QUOTES, under which "..." is an identifier rather
-- than a string.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has_tbl := (SELECT COUNT(*) FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_admins');

-- phone Nullable, because the rows that already exist have no number and inventing one
-- would be worse than recording that we do not have it.
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_admins'
                    AND COLUMN_NAME = 'phone');
SET @sql := IF(@has_tbl > 0 AND @has_col = 0,
  'ALTER TABLE platform_admins ADD COLUMN phone VARCHAR(20) NULL AFTER email',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- the two proofs Timestamps rather than booleans: "verified" is a thing that happened at a
-- moment, and knowing when is what lets somebody later ask whether it happened before or
-- after an incident.
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

-- grandfather what is already there Stamped with created_at, not NOW(): these accounts
-- were not verified today, and writing today's date would assert something that did not
-- happen.
SET @sql := IF(@has_tbl > 0,
  'UPDATE platform_admins
      SET email_verified_at = COALESCE(created_at, NOW()),
          phone_verified_at = COALESCE(created_at, NOW())
    WHERE email_verified_at IS NULL AND phone_verified_at IS NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

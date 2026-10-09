-- 046 KAL-032: logout now actually revokes the token server-side

-- Some managed MySQL services enable ANSI_QUOTES, under which "..." is an identifier rather
-- than a string.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

-- Stamped on logout; the auth middleware rejects a token whose issued-at is at or before this
-- moment, so a logged-out token stops working immediately instead of staying valid for the
-- rest of its life.
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
                    AND COLUMN_NAME = 'session_invalidated_at');
SET @sql := IF(@has_col = 0,
  'ALTER TABLE users ADD COLUMN session_invalidated_at DATETIME NULL DEFAULT NULL AFTER password_changed_at',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

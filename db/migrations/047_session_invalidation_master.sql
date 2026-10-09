-- 047 KAL-032: same revocation column for platform_admins (master DB)

SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has_tbl := (SELECT COUNT(*) FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_admins');
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_admins'
                    AND COLUMN_NAME = 'session_invalidated_at');
SET @sql := IF(@has_tbl > 0 AND @has_col = 0,
  'ALTER TABLE platform_admins ADD COLUMN session_invalidated_at DATETIME NULL DEFAULT NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

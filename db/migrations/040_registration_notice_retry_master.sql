-- 040 Remember whether the platform was actually told about an application

-- Some managed MySQL services enable ANSI_QUOTES, under which "..." is an identifier rather
-- than a string.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has_tbl := (SELECT COUNT(*) FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_registrations');
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_registrations'
                    AND COLUMN_NAME = 'notified_at');

SET @sql := IF(@has_tbl > 0 AND @has_col = 0,
  'ALTER TABLE tenant_registrations ADD COLUMN notified_at DATETIME NULL
     COMMENT ''When the platform admins were successfully emailed about this''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Back-fill, so the first retry pass does not re-announce history.
SET @sql := IF(@has_tbl > 0 AND @has_col = 0,
  'UPDATE tenant_registrations SET notified_at = COALESCE(created_at, NOW())
    WHERE notified_at IS NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The retry pass asks "pending, and never notified" on every run.
SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_registrations'
                    AND INDEX_NAME = 'idx_reg_notice_pending');
SET @sql := IF(@has_tbl > 0 AND @has_idx = 0,
  'CREATE INDEX idx_reg_notice_pending ON tenant_registrations (notified_at, status)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

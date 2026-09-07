-- 029 Access logs are deleted once they pass the retention window

-- Portability note Some MySQL deployments (Aiven's default among them) run with
-- ANSI_QUOTES, in which "..." is an IDENTIFIER, not a string.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has := (SELECT COUNT(*) FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_settings');

SET @sql := IF(@has > 0,
  'INSERT INTO platform_settings (key_name, value) VALUES (''log_retention_months'', ''24'')
     ON DUPLICATE KEY UPDATE value = value',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

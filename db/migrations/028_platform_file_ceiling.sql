-- 028 The attachment ceiling moves from the environment to the console

-- Portability note Some managed MySQL services run with
-- ANSI_QUOTES, in which "..." is an IDENTIFIER, not a string.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has := (SELECT COUNT(*) FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_settings');

SET @sql := IF(@has > 0,
  'INSERT INTO platform_settings (key_name, value) VALUES (''platform_max_file_mb'', ''10'')
     ON DUPLICATE KEY UPDATE value = value',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 037 Turn notification email ON - it was never off on purpose

-- Some managed MySQL services enable ANSI_QUOTES, under which "..." is an identifier rather
-- than a string.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has_settings := (SELECT COUNT(*) FROM information_schema.TABLES
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_settings');

SET @sql := IF(@has_settings > 0,
  'UPDATE org_settings SET value = ''1''
    WHERE key_name = ''email_enabled'' AND value = ''0''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- A tenant provisioned before the key existed has no row at all, and would read as "not
-- set".
SET @sql := IF(@has_settings > 0,
  'INSERT INTO org_settings (key_name, value)
     SELECT ''email_enabled'', ''1'' FROM DUAL
      WHERE NOT EXISTS (SELECT 1 FROM org_settings WHERE key_name = ''email_enabled'')',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Retire the backlog that accumulated while nothing was draining Same three-day rule the
-- code now applies, applied once to what is already there.
SET @has_queue := (SELECT COUNT(*) FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_queue');

SET @sql := IF(@has_queue > 0,
  'UPDATE email_queue SET status = ''failed''
    WHERE status = ''pending'' AND created_at < NOW() - INTERVAL 3 DAY',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

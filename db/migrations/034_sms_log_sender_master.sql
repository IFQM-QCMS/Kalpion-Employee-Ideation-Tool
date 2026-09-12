-- 034 Record which sender header an SMS actually went out under

-- Portability note Some managed MySQL services run with
-- ANSI_QUOTES, in which "..." is an IDENTIFIER, not a string.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has_log := (SELECT COUNT(*) FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sms_delivery_log');

SET @sql := IF(@has_log > 0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sms_delivery_log'
                   AND COLUMN_NAME = 'sender') = 0,
  'ALTER TABLE sms_delivery_log ADD COLUMN sender VARCHAR(16) NULL DEFAULT NULL AFTER provider',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

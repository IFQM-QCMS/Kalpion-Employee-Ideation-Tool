-- 038 email_queue.status needs the value the code has always written

-- Aiven's default sql_mode includes ANSI_QUOTES, under which "..." is an identifier rather
-- than a string.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has_queue := (SELECT COUNT(*) FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_queue');

SET @sql := IF(@has_queue > 0,
  'ALTER TABLE email_queue
     MODIFY COLUMN status ENUM(''pending'',''processing'',''sent'',''failed'')
     NOT NULL DEFAULT ''pending''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Any row a permissive server truncated to '' was mid-send when it happened and has been
-- invisible ever since: not pending, so never retried; not sent, so nobody got it.
SET @sql := IF(@has_queue > 0,
  'UPDATE email_queue SET status = ''pending'' WHERE status = ''''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

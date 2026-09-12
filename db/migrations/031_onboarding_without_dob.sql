-- 031 Onboarding without a date of birth; welcome emails counted

-- Portability note Some managed MySQL services run with
-- ANSI_QUOTES, in which "..." is an IDENTIFIER, not a string.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @is_tenant := (SELECT COUNT(*) FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users');

-- users.date_of_birth / year_of_birth: allow NULL Only touched if the column is currently
-- NOT NULL, so re-running is free.

SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
                   AND COLUMN_NAME = 'date_of_birth' AND IS_NULLABLE = 'NO') > 0,
  'ALTER TABLE users MODIFY COLUMN date_of_birth DATE NULL DEFAULT NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
                   AND COLUMN_NAME = 'year_of_birth' AND IS_NULLABLE = 'NO') > 0,
  'ALTER TABLE users MODIFY COLUMN year_of_birth SMALLINT NULL DEFAULT NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- user_import_jobs: how many welcome emails actually went out

SET @has_jobs := (SELECT COUNT(*) FROM information_schema.TABLES
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_import_jobs');

SET @sql := IF(@has_jobs > 0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_import_jobs'
                   AND COLUMN_NAME = 'emailed_count') = 0,
  'ALTER TABLE user_import_jobs ADD COLUMN emailed_count INT NOT NULL DEFAULT 0 AFTER created_count',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@has_jobs > 0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_import_jobs'
                   AND COLUMN_NAME = 'email_failed_count') = 0,
  'ALTER TABLE user_import_jobs ADD COLUMN email_failed_count INT NOT NULL DEFAULT 0 AFTER emailed_count',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 'emailing' is a new phase value.

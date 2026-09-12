-- 025 Sign in with a username; email is no longer compulsory

-- Tenant databases

-- Portability note Some managed MySQL services run with
-- ANSI_QUOTES, in which "..." is an IDENTIFIER, not a string.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @is_tenant := (SELECT COUNT(*) FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users');

-- username: nullable, unique.
SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
                   AND COLUMN_NAME = 'username') = 0,
  'ALTER TABLE users ADD COLUMN username VARCHAR(50) NULL DEFAULT NULL AFTER employee_id',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
                   AND INDEX_NAME = 'uq_users_username') = 0,
  'ALTER TABLE users ADD UNIQUE KEY uq_users_username (username)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- email: NOT NULL -> NULL. The UNIQUE index is kept and, like username above, goes on
-- tolerating as many NULLs as there are accounts without an address.
SET @sql := IF(@is_tenant > 0 AND (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
                   AND COLUMN_NAME = 'email') = 'NO',
  'ALTER TABLE users MODIFY COLUMN email VARCHAR(150) NULL DEFAULT NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- An account created before this migration may carry '' rather than a real address
-- (nothing enforced a format on import).
SET @sql := IF(@is_tenant > 0,
  'UPDATE users SET email = NULL WHERE email IS NOT NULL AND LENGTH(email) = 0',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Master registry

SET @has_dir := (SELECT COUNT(*) FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'login_directory');

SET @sql := IF(@has_dir > 0,
  'ALTER TABLE login_directory MODIFY COLUMN id_type ENUM(''email'',''phone'',''username'') NOT NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

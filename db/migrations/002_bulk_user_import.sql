-- Migration 002 - Bulk employee import (per-TENANT database)

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'must_change_password') = 0,
  'ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'date_of_birth') = 0,
  'ALTER TABLE users ADD COLUMN date_of_birth DATE NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'activated_at') = 0,
  'ALTER TABLE users ADD COLUMN activated_at DATETIME NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Existing accounts were created before this flag existed and already have a password
-- their owner chose; do not force them to change it.
UPDATE users SET must_change_password = 0 WHERE must_change_password IS NULL;

-- The admin console lists/searches users by name, employee id and email.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND INDEX_NAME = 'idx_users_name') = 0,
  'ALTER TABLE users ADD INDEX idx_users_name (name)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND INDEX_NAME = 'idx_users_manager') = 0,
  'ALTER TABLE users ADD INDEX idx_users_manager (manager_id)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Import job tracking
CREATE TABLE IF NOT EXISTS user_import_jobs (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  actor_id        INT NULL,                    -- who ran it (audit)
  actor_name      VARCHAR(100) NULL,           -- denormalised: survives actor deletion
  filename        VARCHAR(255) NULL,
  status          ENUM('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
  phase           VARCHAR(24) NULL,            -- parsing | validating | hashing | inserting
  total_rows      INT NOT NULL DEFAULT 0,
  processed_rows  INT NOT NULL DEFAULT 0,      -- drives the progress bar
  created_count   INT NOT NULL DEFAULT 0,
  skipped_count   INT NOT NULL DEFAULT 0,
  error_message   TEXT NULL,
  started_at      DATETIME NULL,
  finished_at     DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_import_status (status),
  INDEX idx_import_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-row rejections, so the admin can be told exactly which line was wrong and why, and
-- download the list as a CSV.
CREATE TABLE IF NOT EXISTS user_import_errors (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  job_id       INT NOT NULL,
  `row_number` INT NOT NULL,                   -- 1-based row in the sheet (quoted: reserved word in MariaDB 10.11)
  employee_id  VARCHAR(191) NULL,
  email        VARCHAR(191) NULL,
  message      VARCHAR(255) NOT NULL,
  FOREIGN KEY (job_id) REFERENCES user_import_jobs(id) ON DELETE CASCADE,
  INDEX idx_import_err_job (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

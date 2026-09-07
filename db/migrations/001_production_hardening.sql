-- Migration 001 - Production hardening

-- 1-3: run against each TENANT database

-- MySQL has no "ADD COLUMN IF NOT EXISTS", so guard each one.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'password_changed_at') = 0,
  'ALTER TABLE users ADD COLUMN password_changed_at DATETIME NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'deactivated_at') = 0,
  'ALTER TABLE users ADD COLUMN deactivated_at DATETIME NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Existing accounts: treat "now" as their last password change so that tokens minted
-- before this migration are not all invalidated retroactively.
UPDATE users SET password_changed_at = NOW() WHERE password_changed_at IS NULL;

-- Some tenants were provisioned before this table existed, which made password reset fail
-- outright for them.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  selector    CHAR(32) NULL,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  DATETIME NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'password_reset_tokens'
       AND COLUMN_NAME = 'selector') = 0,
  'ALTER TABLE password_reset_tokens ADD COLUMN selector CHAR(32) NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Any token issued under the old (selector-less) scheme can no longer be verified, so
-- clear them out; users simply request a new link.
DELETE FROM password_reset_tokens WHERE selector IS NULL;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'password_reset_tokens'
       AND INDEX_NAME = 'uniq_prt_selector') = 0,
  'ALTER TABLE password_reset_tokens ADD UNIQUE INDEX uniq_prt_selector (selector)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'password_reset_tokens'
       AND INDEX_NAME = 'idx_prt_expires') = 0,
  'ALTER TABLE password_reset_tokens ADD INDEX idx_prt_expires (expires_at)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Hot-path indexes. Login hits users(email,status) on every attempt; the idea lists filter
-- and sort on these constantly.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND INDEX_NAME = 'idx_users_email_status') = 0,
  'ALTER TABLE users ADD INDEX idx_users_email_status (email, status)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND INDEX_NAME = 'idx_ideas_status_submitted') = 0,
  'ALTER TABLE ideas ADD INDEX idx_ideas_status_submitted (status, submitted_at)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND INDEX_NAME = 'idx_ideas_submitter') = 0,
  'ALTER TABLE ideas ADD INDEX idx_ideas_submitter (submitter_id)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

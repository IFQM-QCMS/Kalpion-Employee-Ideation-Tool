-- Migration 001 (master) - apply to ifqm_master ONLY.

CREATE TABLE IF NOT EXISTS login_attempts (
  login_id      VARCHAR(191) NOT NULL PRIMARY KEY,  -- '<email>|<slug>'
  attempts      INT          NOT NULL DEFAULT 0,
  locked_until  DATETIME     NULL DEFAULT NULL,
  last_attempt  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_login_attempts_last (last_attempt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The tenants table stored db_user/db_pass in plaintext - a list of live database
-- credentials (in practice, root) sitting in the registry.
UPDATE tenants SET db_pass = '' WHERE db_pass <> '';

-- ─────────────────────────────────────────────────────────────────────────────
--  Migration 010 — MOM 29 Jul 2026, MASTER database
--
--    mysql -u root -p ifqm_master < db/migrations/010_mom_29jul_master.sql
--
--  Idempotent: safe to re-run.
--  Covers MOM §12.3 (archive tickets), §12.12 (login activity), §8.3/§8.5
--  (per-tenant API quota and storage cap).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── §12.3 Archive support tickets ────────────────────────────────────────────
-- Distinct from `closed`: closing is the outcome of the conversation, archiving
-- is the operator saying "stop showing me this". A closed ticket still belongs
-- in the recent list; an archived one does not.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'support_tickets'
       AND COLUMN_NAME = 'archived_at') = 0,
  'ALTER TABLE support_tickets ADD COLUMN archived_at DATETIME NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'support_tickets'
       AND INDEX_NAME = 'idx_tickets_archived') = 0,
  'CREATE INDEX idx_tickets_archived ON support_tickets(archived_at)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── §12.12 Platform login activity ───────────────────────────────────────────
-- login_attempts already exists but is lockout state: it is cleared on every
-- successful sign-in, so it can never answer "who signed in, and when". This is
-- the append-only record that can.
CREATE TABLE IF NOT EXISTS platform_login_activity (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  actor_type    ENUM('platform_admin','tenant_user') NOT NULL,
  actor_id      VARCHAR(40)  NULL,        -- platform_admins.id, or users.id within a tenant
  actor_name    VARCHAR(120) NULL,
  actor_email   VARCHAR(255) NULL,
  tenant_id     INT          NULL,
  tenant_slug   VARCHAR(50)  NULL,
  outcome       ENUM('success','failure','lockout') NOT NULL,
  ip            VARCHAR(45)  NULL,
  user_agent    VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pla_created (created_at),
  INDEX idx_pla_outcome (outcome, created_at),
  INDEX idx_pla_tenant (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── §8.3 / §8.5 Per-tenant API quota and storage cap ─────────────────────────
-- The MOM specifies 10,000 requests total and 2,000 per month. Both are counted
-- here rather than in memory: an in-process counter resets on every deploy and
-- does not exist for a second worker, which is the same mistake the brute-force
-- lockout already had to be moved out of.
CREATE TABLE IF NOT EXISTS tenant_api_usage (
  tenant_id     INT          NOT NULL,
  period        CHAR(7)      NOT NULL,   -- 'YYYY-MM', or 'total' for the lifetime counter
  request_count INT          NOT NULL DEFAULT 0,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-tenant limits, overridable per organisation. NULL means "use the platform
-- default from platform_settings", so raising the default lifts every tenant
-- that has not been given a bespoke number.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
       AND COLUMN_NAME = 'api_quota_total') = 0,
  'ALTER TABLE tenants ADD COLUMN api_quota_total INT NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
       AND COLUMN_NAME = 'api_quota_monthly') = 0,
  'ALTER TABLE tenants ADD COLUMN api_quota_monthly INT NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
       AND COLUMN_NAME = 'storage_quota_mb') = 0,
  'ALTER TABLE tenants ADD COLUMN storage_quota_mb INT NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Platform-wide defaults the MOM named.
INSERT IGNORE INTO platform_settings (key_name, value) VALUES
  ('api_quota_total',    '10000'),
  ('api_quota_monthly',  '2000'),
  ('storage_quota_mb',   '2048'),
  ('max_platform_admins', '5');

-- 030 Pay as you go - billed per active user, per month

-- Portability note Some managed MySQL services run with
-- ANSI_QUOTES, in which "..." is an IDENTIFIER, not a string.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has_plans := (SELECT COUNT(*) FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans');

SET @sql := IF(@has_plans > 0,
  'ALTER TABLE plans MODIFY COLUMN billing_cycle
     ENUM(''monthly'',''quarterly'',''half_yearly'',''yearly'',''one_time'',''lifetime'',''payg'')
     NOT NULL DEFAULT ''yearly''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- One row per organisation per month.
CREATE TABLE IF NOT EXISTS tenant_active_users (
  tenant_id     INT      NOT NULL,
  period        CHAR(7)  NOT NULL,          -- 'YYYY-MM'
  active_users  INT      NOT NULL DEFAULT 0,
  -- What each active user cost in that month, captured at the same moment.
  unit_paise    BIGINT   NOT NULL DEFAULT 0,
  computed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, period),
  KEY idx_tau_period (period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A starting PAYG plan: Rs.49 per active user per month, no user ceiling.
SET @sql := IF(@has_plans > 0,
  'INSERT IGNORE INTO plans
     (code, name, description, tier, amount_paise, billing_cycle, gst_percent, gst_mode,
      max_users, max_departments, storage_gb, api_quota_monthly, support_level, status)
   VALUES
     (''PAYG'', ''Pay As You Go'',
      ''Billed monthly for the people who actually signed in. No seat count to manage.'',
      ''custom'', 4900, ''payg'', 18.00, ''included'', NULL, NULL, 25, NULL, ''standard'', ''active'')',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ============================================================================
--  030  Pay as you go — billed per active user, per month
--
--    mysql -u root -p ifqm_master < db/migrations/030_pay_as_you_go.sql
--
--  Master registry only.
--
--  ── The meter ──────────────────────────────────────────────────────────────
--
--  An "active user" is somebody who actually signed in during the month. Not
--  somebody with an account — an organisation that provisions four hundred
--  employees and has thirty using the tool should be billed for thirty, or the
--  plan is a seat licence wearing a different name.
--
--  A PAYG plan's amount_paise is therefore the price of ONE active user for ONE
--  month, not the price of the plan.
--
--  ── Why the count is snapshotted rather than computed on demand ────────────
--
--  It is derived from platform_login_activity, which migration 029 now purges
--  after the retention window. Recomputing an old month would silently return a
--  smaller number once its sign-in rows had gone — an invoice that quietly
--  shrinks when re-opened is worse than one that is wrong, because nobody can
--  tell which figure was actually charged.
--
--  So each month is counted once and kept. tenant_active_users outlives the log
--  it was derived from, which is exactly what a billing record has to do.
-- ============================================================================

-- ── Portability note ────────────────────────────────────────────────────────
-- Some MySQL deployments (Aiven's default among them) run with ANSI_QUOTES, in
-- which "..." is an IDENTIFIER, not a string. The guarded statements below build
-- SQL as text and would be read as column names there — the failure looks like
-- `Unknown column 'ALTER TABLE ...'`, which is baffling until you know why.
-- Dropped for this session only, so the file parses identically everywhere.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has_plans := (SELECT COUNT(*) FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans');

SET @sql := IF(@has_plans > 0,
  'ALTER TABLE plans MODIFY COLUMN billing_cycle
     ENUM(''monthly'',''quarterly'',''half_yearly'',''yearly'',''one_time'',''lifetime'',''payg'')
     NOT NULL DEFAULT ''yearly''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- One row per organisation per month. Written once when the month is billed and
-- never recomputed, so the figure an invoice was raised against stays readable
-- after the sign-in rows behind it have been purged.
CREATE TABLE IF NOT EXISTS tenant_active_users (
  tenant_id     INT      NOT NULL,
  period        CHAR(7)  NOT NULL,          -- 'YYYY-MM'
  active_users  INT      NOT NULL DEFAULT 0,
  -- What each active user cost in that month, captured at the same moment. A
  -- price change must not rewrite what an earlier month was charged.
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

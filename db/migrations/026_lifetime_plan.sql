-- 026 A lifetime plan: paid once (or free), never expires

-- Portability note Some MySQL deployments (Aiven's default among them) run with
-- ANSI_QUOTES, in which "..." is an IDENTIFIER, not a string.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has_plans := (SELECT COUNT(*) FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans');

SET @sql := IF(@has_plans > 0,
  'ALTER TABLE plans MODIFY COLUMN billing_cycle
     ENUM(''monthly'',''quarterly'',''half_yearly'',''yearly'',''one_time'',''lifetime'')
     NOT NULL DEFAULT ''yearly''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- A free, perpetual plan. INSERT IGNORE so re-running leaves an operator's own edits to it
-- - price, caps, description - exactly as they left them.
SET @sql := IF(@has_plans > 0,
  'INSERT IGNORE INTO plans
     (code, name, description, tier, amount_paise, billing_cycle, gst_percent, gst_mode,
      max_users, max_departments, storage_gb, api_quota_monthly, support_level, status)
   VALUES
     (''LIFETIME'', ''Lifetime (Free)'',
      ''Permanent access at no charge. Never expires and is never billed.'',
      ''custom'', 0, ''lifetime'', 18.00, ''included'', NULL, NULL, 25, NULL, ''standard'', ''active'')',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

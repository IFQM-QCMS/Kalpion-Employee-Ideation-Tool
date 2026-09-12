-- 035 The Lifetime plan is what founding members are held on - make it

-- Some managed MySQL services enable ANSI_QUOTES, under which "..." is an identifier rather
-- than a string.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has_plans := (SELECT COUNT(*) FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans');

-- 1. The row exists INSERT IGNORE, so a deployment that already ran 026 is untouched here
-- and a deployment where somebody hard-deleted the row gets it back.
SET @sql := IF(@has_plans > 0,
  'INSERT IGNORE INTO plans
     (code, name, description, tier, amount_paise, billing_cycle, gst_percent, gst_mode,
      max_users, max_departments, storage_gb, api_quota_monthly, support_level, status)
   VALUES
     (''LIFETIME'', ''Lifetime (Founding Member)'',
      ''Permanent free access for IFQM founding members. Never expires and is never billed.'',
      ''custom'', 0, ''lifetime'', 18.00, ''included'', NULL, NULL, 25, NULL, ''priority'', ''active'')',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. It is active Unconditional: the plan is permanent from here on, so a deployment where
-- it was retired before this rule existed is brought back into line.
SET @sql := IF(@has_plans > 0,
  'UPDATE plans SET status = ''active'' WHERE code = ''LIFETIME'' AND status <> ''active''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 3. It says who it is for Matched against 026's exact seeded text, so an operator who has
-- since written their own name or description keeps it.
SET @sql := IF(@has_plans > 0,
  'UPDATE plans
      SET name = ''Lifetime (Founding Member)'',
          description = ''Permanent free access for IFQM founding members. Never expires and is never billed.''
    WHERE code = ''LIFETIME''
      AND name = ''Lifetime (Free)''
      AND description = ''Permanent access at no charge. Never expires and is never billed.''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

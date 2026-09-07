-- Migration 018 - the request allowance belongs to the plan (MASTER schema)

-- The allowance itself. NULL means unlimited, and is distinguished from 0, which would be
-- a real limit meaning "no requests at all".
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
                   AND COLUMN_NAME = 'api_quota_monthly') = 0,
  'ALTER TABLE plans ADD COLUMN api_quota_monthly INT NULL DEFAULT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
                   AND COLUMN_NAME = 'api_quota_total') = 0,
  'ALTER TABLE plans ADD COLUMN api_quota_total INT NULL DEFAULT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Seed the shipped plans. Only where nobody has set a figure already, so an operator who
-- has tuned their own numbers keeps them.
UPDATE plans SET api_quota_monthly = 1500000
 WHERE code = 'STARTER' AND api_quota_monthly IS NULL;
UPDATE plans SET api_quota_monthly = 22500000
 WHERE code = 'PRO' AND api_quota_monthly IS NULL;
-- TRIAL is left NULL on purpose.

-- Policy
INSERT IGNORE INTO platform_settings (key_name, value) VALUES
  -- Whether going past the allowance actually refuses requests.
  ('quota_enforce',        '1'),
  -- How far past the allowance is tolerated before anything is refused.
  ('quota_grace_percent',  '20'),
  -- Where the warning starts, as a percentage of the allowance.
  ('quota_warn_percent',   '80');

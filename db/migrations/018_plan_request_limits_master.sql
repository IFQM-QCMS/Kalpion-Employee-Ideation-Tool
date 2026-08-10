-- ─────────────────────────────────────────────────────────────────────────────
--  Migration 018 — the request allowance belongs to the plan  (MASTER schema)
--
--    mysql -u root -p ifqm_master < db/migrations/018_plan_request_limits_master.sql
--
--  Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────
--
--  Migration 017 removed the platform-wide cap after it took a live customer
--  offline. This puts a real allowance back, on the plan, where a commercial
--  limit belongs — a bigger plan buys more of the platform.
--
--  ── How the numbers were arrived at ─────────────────────────────────────────
--
--  The last cap failed because nobody worked out what normal use costs. So:
--
--    notification poll     30 requests/hour while signed in
--    a screen open         up to 60 requests/hour
--    ordinary navigation   roughly 150 requests over a working day
--
--  That is about 500 requests per person per working day, or ~11,000 a month
--  over 22 working days. Rounded up to 15,000 per permitted user per month,
--  which leaves room for a heavy user, bulk imports and exports.
--
--  So each plan's allowance is 15,000 × its user cap, with a floor of 100,000
--  for the smallest plans. A plan with no user cap gets no request cap either:
--  a limit derived from "unlimited" is a contradiction.
--
--    TRIAL    unlimited users → NULL      (evaluating, never blocked)
--    STARTER  100 users       → 1,500,000
--    PRO      1,500 users     → 22,500,000
--
--  For comparison, the cap that caused the outage was 2,000 a month.

-- The allowance itself. NULL means unlimited, and is distinguished from 0,
-- which would be a real limit meaning "no requests at all".
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

-- Seed the shipped plans. Only where nobody has set a figure already, so an
-- operator who has tuned their own numbers keeps them.
UPDATE plans SET api_quota_monthly = 1500000
 WHERE code = 'STARTER' AND api_quota_monthly IS NULL;
UPDATE plans SET api_quota_monthly = 22500000
 WHERE code = 'PRO' AND api_quota_monthly IS NULL;
-- TRIAL is left NULL on purpose. An organisation deciding whether to buy the
-- product should never meet a limit while doing so.

-- ── Policy ──────────────────────────────────────────────────────────────────
INSERT IGNORE INTO platform_settings (key_name, value) VALUES
  -- Whether going past the allowance actually refuses requests.
  ('quota_enforce',        '1'),
  -- How far past the allowance is tolerated before anything is refused. The
  -- allowance is an estimate of normal use, not a measurement of it, so a
  -- customer who is 5% over is more likely to be busy than abusive. They are
  -- warned across this band and refused past the end of it.
  ('quota_grace_percent',  '20'),
  -- Where the warning starts, as a percentage of the allowance. Somebody should
  -- hear about this from us before they hear about it from their staff.
  ('quota_warn_percent',   '80');

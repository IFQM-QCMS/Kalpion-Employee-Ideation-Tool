-- ============================================================================
--  026  A lifetime plan: paid once (or free), never expires
--
--    mysql -u root -p ifqm_master < db/migrations/026_lifetime_plan.sql
--
--  Master registry only — plans and billing live nowhere else.
--
--  ── Why 'one_time' was not already this ────────────────────────────────────
--
--  billing_cycle already had 'one_time', mapped to 3650 days and commented
--  "effectively perpetual; still has an end date on file". Effectively is the
--  problem: the date is real, the nightly sweep reads it, and in ten years it
--  would expire an organisation that was sold a plan that does not expire.
--  Ten years is long enough that nobody would remember why, and short enough
--  that it will actually arrive.
--
--  'lifetime' has no end date at all. Assigning it writes period_end = NULL and
--  billing_status = 'exempt', which the sweep already skips — sweepLapsed only
--  selects trial/active/past_due, so an exempt organisation is never examined,
--  never chased and never suspended.
--
--  ── Free, and also not necessarily free ────────────────────────────────────
--
--  The seeded LIFETIME plan is ₹0: a permanent no-charge account for a pilot
--  site, a partner or an internal organisation, which is what it is most wanted
--  for. The cycle itself carries no opinion about price — a paid one-off
--  perpetual licence is the same cycle with an amount on it, and the invoice
--  and tax handling need no special case because the amount is charged once.
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
     ENUM(''monthly'',''quarterly'',''half_yearly'',''yearly'',''one_time'',''lifetime'')
     NOT NULL DEFAULT ''yearly''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- A free, perpetual plan. INSERT IGNORE so re-running leaves an operator's own
-- edits to it — price, caps, description — exactly as they left them.
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

-- ============================================================================
--  035  The Lifetime plan is what founding members are held on — make it
--       permanent, and say so on the row
--
--    mysql -u root -p ifqm_master < db/migrations/035_founding_lifetime_master.sql
--
--  Master registry only — plans live nowhere else. The _master suffix is what
--  the runner routes on; without it this would be run against every tenant
--  database, where `plans` does not exist.
--
--  ── What this changes ──────────────────────────────────────────────────────
--
--  026 created a free perpetual plan and described it as "permanent access at
--  no charge". True, and it does not say who it is for. IFQM's founding members
--  — L&T, TVS and the others who backed the platform before it had customers —
--  were promised lifetime free access, and the only place that promise is
--  written down is the plan they are put on. An operator looking at a row
--  labelled "Lifetime (Free)" a year from now has no way to tell whether it is
--  a live commitment or an experiment somebody left behind, and the safe-looking
--  action on an experiment is to delete it.
--
--  Deleting it would not cut anybody off on the day: organisations on it keep
--  billing_status = 'exempt' and period_end = NULL, and sweepLapsed only looks
--  at trial/active/past_due, so it never examines them. That is what makes it
--  dangerous rather than obvious. The plan would simply stop appearing in the
--  list an approver picks from, and the next founding member onboarded would be
--  put on something that expires — surfacing months later as a renewal notice
--  sent to a company that was promised it would never get one.
--
--  planService now refuses to retire it (see PERMANENT_PLANS). This migration
--  handles the rest: the row exists, it is active, and it names its purpose.
--
--  Idempotent, and it does not overwrite an operator's own wording — the
--  description is only rewritten if it is still the text 026 seeded.
-- ============================================================================

-- Aiven's default sql_mode includes ANSI_QUOTES, under which "..." is an
-- identifier rather than a string. The guarded statements below build SQL as
-- text, so they would be read as column names there. Dropped for this session
-- only, so the file behaves identically on every deployment.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has_plans := (SELECT COUNT(*) FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans');

-- ── 1. The row exists ───────────────────────────────────────────────────────
-- INSERT IGNORE, so a deployment that already ran 026 is untouched here and a
-- deployment where somebody hard-deleted the row gets it back.
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

-- ── 2. It is active ─────────────────────────────────────────────────────────
-- Unconditional: the plan is permanent from here on, so a deployment where it
-- was retired before this rule existed is brought back into line.
SET @sql := IF(@has_plans > 0,
  'UPDATE plans SET status = ''active'' WHERE code = ''LIFETIME'' AND status <> ''active''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── 3. It says who it is for ────────────────────────────────────────────────
-- Matched against 026's exact seeded text, so an operator who has since written
-- their own name or description keeps it. Anyone still on the original wording
-- never chose it, and the clearer sentence is strictly better for them.
SET @sql := IF(@has_plans > 0,
  'UPDATE plans
      SET name = ''Lifetime (Founding Member)'',
          description = ''Permanent free access for IFQM founding members. Never expires and is never billed.''
    WHERE code = ''LIFETIME''
      AND name = ''Lifetime (Free)''
      AND description = ''Permanent access at no charge. Never expires and is never billed.''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

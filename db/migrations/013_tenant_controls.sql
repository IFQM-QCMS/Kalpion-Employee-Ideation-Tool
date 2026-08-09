-- ─────────────────────────────────────────────────────────────────────────────
--  Migration 013 — per-tenant controls and idea-level patentability flag
--
--    mysql -u root -p ifqm_<slug> < db/migrations/013_tenant_controls.sql
--
--  Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Patentable, as claimed by a person ───────────────────────────────────────
-- Distinct from `patentability`, which is the ORGANISATION'S assessment made by
-- an admin. This is the submitter (or a senior) saying "I think there is
-- something protectable here" at the moment the idea is raised. Keeping them
-- apart matters: an employee flagging an idea is a prompt to look, not a
-- decision, and overwriting the admin's verdict with an optimistic tick would
-- destroy the very judgement the other column exists to record.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'patentable_flag') = 0,
  'ALTER TABLE ideas ADD COLUMN patentable_flag TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'patentable_flagged_by') = 0,
  'ALTER TABLE ideas ADD COLUMN patentable_flagged_by INT NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── Per-organisation settings ────────────────────────────────────────────────
INSERT IGNORE INTO org_settings (key_name, value) VALUES
  -- Each organisation sets its own attachment ceiling. Still bounded by the
  -- platform-wide maximum, so one tenant cannot decide to accept 2 GB uploads.
  ('max_file_mb', '10'),
  -- Screenshot and copy deterrents on the screens that list ideas. On by
  -- default now, because idea text is the thing the product is protecting.
  ('idea_screen_protection', '1'),
  -- How much of the problem statement somebody who is not involved may read.
  ('situation_preview_chars', '180');

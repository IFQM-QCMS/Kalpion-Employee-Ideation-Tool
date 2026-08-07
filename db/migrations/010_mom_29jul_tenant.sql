-- ─────────────────────────────────────────────────────────────────────────────
--  Migration 010 — MOM 29 Jul 2026, per-TENANT changes
--
--    mysql -u root -p ifqm_<slug> < db/migrations/010_mom_29jul_tenant.sql
--
--  Idempotent: safe to re-run. Every ALTER is guarded on information_schema
--  because MySQL 8 has no ADD COLUMN IF NOT EXISTS (see migration 001).
--
--  Covers MOM §13.4, §13.10, §13.2, §14.5, §14.6, §14.8, §13.1.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── §13.10 Patentability decision on an idea ─────────────────────────────────
-- A separate axis from approval: an idea can be approved and not patentable, or
-- rejected outright and still worth a provisional filing. Conflating it with
-- `status` would lose exactly the cases the business cares about.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'patentability') = 0,
  'ALTER TABLE ideas ADD COLUMN patentability ENUM(''not_assessed'',''not_patentable'',''possible'',''recommended'',''filed'') NOT NULL DEFAULT ''not_assessed''',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'patentability_note') = 0,
  'ALTER TABLE ideas ADD COLUMN patentability_note TEXT NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── §13.2 Archive old ideas ──────────────────────────────────────────────────
-- Archiving hides an idea from the working lists without deleting it: the points
-- already awarded, the audit trail and the ROI figures all stay intact, which
-- deletion would destroy. NULL = live.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'archived_at') = 0,
  'ALTER TABLE ideas ADD COLUMN archived_at DATETIME NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'archived_by') = 0,
  'ALTER TABLE ideas ADD COLUMN archived_by INT NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Every list filters on it, so it needs to be indexed rather than scanned.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND INDEX_NAME = 'idx_ideas_archived') = 0,
  'CREATE INDEX idx_ideas_archived ON ideas(archived_at)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── §14.5 Time Required ──────────────────────────────────────────────────────
-- The MOM specifies three fixed bands. `implementation_duration` already exists
-- as free text and is left alone: it holds real data on existing ideas, and a
-- free-text field cannot be safely coerced into an enum.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'time_required') = 0,
  'ALTER TABLE ideas ADD COLUMN time_required ENUM(''lt_3m'',''3_6m'',''6_12m'') NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── §14.6 Solution category tags ─────────────────────────────────────────────
-- Process Improvement and QCD (Quality, Cost, Delivery). Stored as a CSV of tag
-- keys rather than a join table: the set is fixed, small, and never queried
-- relationally — a table here would be ceremony with no payoff.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'solution_tags') = 0,
  'ALTER TABLE ideas ADD COLUMN solution_tags VARCHAR(255) NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── §13.4 Year of birth instead of full date ─────────────────────────────────
-- The bulk-import temporary password was derived from name + birth year, so the
-- full date was never needed — it was extra personal data held for no purpose.
-- The new column is back-filled from the old one; date_of_birth is deliberately
-- NOT dropped in this migration so a rollback is possible. Dropping it is a
-- separate, later step once this has run everywhere.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'year_of_birth') = 0,
  'ALTER TABLE users ADD COLUMN year_of_birth SMALLINT NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

UPDATE users
   SET year_of_birth = YEAR(date_of_birth)
 WHERE year_of_birth IS NULL AND date_of_birth IS NOT NULL;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'salutation') = 0,
  'ALTER TABLE users ADD COLUMN salutation VARCHAR(10) NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'first_name') = 0,
  'ALTER TABLE users ADD COLUMN first_name VARCHAR(60) NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'last_name') = 0,
  'ALTER TABLE users ADD COLUMN last_name VARCHAR(60) NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── §13.1 / §14.8 New organisation settings ──────────────────────────────────
-- solution_visibility: who may read the full proposed solution. Until now this
-- was a constant in ideaService; the MOM asks the org admin to control it.
--   authors_reviewers  author, co-suggesters, assigned reviewers, managers+
--   managers_only      managers and above only (author still sees their own)
--   everyone           no redaction (the pre-MOM behaviour)
--
-- anonymous_allowed flips to '0': §14.8 removes anonymous submission. Kept as a
-- setting rather than ripped out, because the existing ideas that WERE submitted
-- anonymously must keep that promise — the column and the masking logic stay.
INSERT IGNORE INTO org_settings (key_name, value) VALUES
  ('solution_visibility',   'authors_reviewers'),
  ('idea_tags_enabled',     '1'),
  ('patentability_enabled', '1');

UPDATE org_settings SET value = '0' WHERE key_name = 'anonymous_allowed';

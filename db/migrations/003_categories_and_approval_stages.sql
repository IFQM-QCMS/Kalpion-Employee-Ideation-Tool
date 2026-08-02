-- ─────────────────────────────────────────────────────────────────────────────
--  Migration 003 — Per-organisation idea categories, named approval stages,
--                  and the business case an idea is submitted with
--                  (per-TENANT database)
--
--    mysql -u root -p ifqm_<slug> < db/migrations/003_categories_and_approval_stages.sql
--
--  Idempotent: safe to re-run.
--
--  1. idea_categories
--     The submission wizard used to offer seven hard-coded "impact areas"
--     compiled into the frontend bundle, identical for every organisation. They
--     are now rows every organisation owns and can add to or delete from.
--     Seeded with the standard set: Safety, Quality, Productivity, Delivery,
--     Sustenance.
--
--     ideas.impact_areas keeps storing the chosen names as comma-separated
--     TEXT, exactly as before — so deleting a category never rewrites history:
--     an idea submitted under "Delivery" still reads "Delivery" after the
--     category row is gone. That is deliberate. It also means the column needs
--     no migration and every existing idea keeps rendering unchanged.
--
--  2. users.role — two new members: department_manager, plant_head
--     Needed by the named approval stages (Originator → Immediate Manager →
--     Department Manager → Plant Head). Appended at the END of the ENUM on
--     purpose: MySQL/MariaDB stores an ENUM as the ordinal of its member, so
--     inserting a member in the middle would renumber everything after it and
--     silently change the role of every existing user. Appending cannot.
--     Display order is driven by explicit FIELD(...) lists in the queries, not
--     by this declaration order.
--
--  3. org_settings.approval_stages
--     The ordered chain an idea walks, as stage keys. The first stage is always
--     the originator (whoever submits); each following stage is an approver.
--     Reviewer/final roles are derived from this list at read time, so the
--     escalation engine is unchanged — see backend/src/services/approvalStages.js.
--     Seeded but NOT activated: approval_mode is left alone, so an organisation
--     keeps whatever chain it runs today until an admin switches mode.
--
--  4. ideas.* — the business case
--     Investment required, feasibility, time to implement, benefits expected and
--     support required. All NULLable and all optional on the form: every idea
--     already in the table predates them, and a required field would have made
--     every one of those rows retrospectively invalid.
--
--     "Time required to implement (date or duration)" is two columns, not one.
--     A target date and "about 6 weeks" are different kinds of answer, and
--     squeezing both into one string would make neither sortable nor reportable.
--     Either, both, or neither may be filled in.
--
--     expected_implementation_date is the SUBMITTER's estimate and is distinct
--     from implementation_target_date, which the implementation owner sets after
--     approval. Keeping them apart is what lets you compare what was promised
--     with what was planned.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Per-organisation idea categories ──────────────────────────────
CREATE TABLE IF NOT EXISTS idea_categories (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(80) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_idea_category_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO idea_categories (name, sort_order) VALUES
  ('Safety',       1),
  ('Quality',      2),
  ('Productivity', 3),
  ('Delivery',     4),
  ('Sustenance',   5);

-- ── 2. Two new roles for the named approval stages ───────────────────
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'role' AND COLUMN_TYPE LIKE '%plant_head%') = 0,
  'ALTER TABLE users MODIFY COLUMN role ENUM(''trainee'',''employee'',''team_lead'',''project_lead'',''manager'',''senior_manager'',''executive'',''admin'',''super_admin'',''department_manager'',''plant_head'') NOT NULL DEFAULT ''employee''',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── 3. Default approval stage chain ──────────────────────────────────
INSERT IGNORE INTO org_settings (key_name, value) VALUES
  ('approval_stages', 'originator,immediate_manager,department_manager,plant_head');

-- ── 4. Business case columns on ideas ────────────────────────────────
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'investment_required') = 0,
  'ALTER TABLE ideas ADD COLUMN investment_required VARCHAR(255) NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'feasibility') = 0,
  'ALTER TABLE ideas ADD COLUMN feasibility ENUM(''Low'',''Medium'',''High'') NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'implementation_duration') = 0,
  'ALTER TABLE ideas ADD COLUMN implementation_duration VARCHAR(120) NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'expected_implementation_date') = 0,
  'ALTER TABLE ideas ADD COLUMN expected_implementation_date DATE NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'benefits_expected') = 0,
  'ALTER TABLE ideas ADD COLUMN benefits_expected TEXT NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'support_required') = 0,
  'ALTER TABLE ideas ADD COLUMN support_required TEXT NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

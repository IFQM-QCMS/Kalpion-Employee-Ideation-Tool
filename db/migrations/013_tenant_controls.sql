-- Migration 013 - per-tenant controls and idea-level patentability flag

-- Patentable, as claimed by a person Distinct from `patentability`, which is the
-- ORGANISATION'S assessment made by an admin.
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

-- Per-organisation settings
INSERT IGNORE INTO org_settings (key_name, value) VALUES
  -- Each organisation sets its own attachment ceiling.
  ('max_file_mb', '10'),
  -- Screenshot and copy deterrents on the screens that list ideas.
  ('idea_screen_protection', '1'),
  -- How much of the problem statement somebody who is not involved may read.
  ('situation_preview_chars', '180');

-- Migration 003 - Per-organisation idea categories, named approval stages

-- 1. Per-organisation idea categories
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

-- 2. Two new roles for the named approval stages
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'role' AND COLUMN_TYPE LIKE '%plant_head%') = 0,
  'ALTER TABLE users MODIFY COLUMN role ENUM(''trainee'',''employee'',''team_lead'',''project_lead'',''manager'',''senior_manager'',''executive'',''admin'',''super_admin'',''department_manager'',''plant_head'') NOT NULL DEFAULT ''employee''',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 3. Default approval stage chain
INSERT IGNORE INTO org_settings (key_name, value) VALUES
  ('approval_stages', 'originator,immediate_manager,department_manager,plant_head');

-- 4. Business case columns on ideas
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

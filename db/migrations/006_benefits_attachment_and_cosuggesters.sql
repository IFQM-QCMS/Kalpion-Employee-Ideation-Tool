-- Migration 006 - Benefits-Expected attachment + more than two co-suggesters

-- 1. 'benefits' attachment section
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'idea_attachments'
       AND COLUMN_NAME = 'section' AND COLUMN_TYPE LIKE '%benefits%') = 0,
  'ALTER TABLE idea_attachments MODIFY COLUMN section ENUM(''situation'',''solution'',''support'',''benefits'') NOT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. Co-suggesters junction table
CREATE TABLE IF NOT EXISTS idea_co_suggesters (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  idea_id    INT NOT NULL,
  user_id    INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_idea_cosuggester (idea_id, user_id),
  KEY idx_cosuggester_idea (idea_id),
  FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Back-fill the junction from the two legacy columns for existing ideas.
INSERT IGNORE INTO idea_co_suggesters (idea_id, user_id)
  SELECT id, co_suggester_1_id FROM ideas WHERE co_suggester_1_id IS NOT NULL;
INSERT IGNORE INTO idea_co_suggesters (idea_id, user_id)
  SELECT id, co_suggester_2_id FROM ideas WHERE co_suggester_2_id IS NOT NULL;

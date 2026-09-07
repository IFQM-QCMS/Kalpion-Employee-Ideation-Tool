-- Migration 008 - Index ideas.updated_at (per-TENANT database)

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND INDEX_NAME = 'idx_ideas_updated_at') = 0,
  'CREATE INDEX idx_ideas_updated_at ON ideas(updated_at)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Migration 004 - Allow a "support" attachment section (per-TENANT database)

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'idea_attachments'
       AND COLUMN_NAME = 'section' AND COLUMN_TYPE LIKE '%support%') = 0,
  'ALTER TABLE idea_attachments MODIFY COLUMN section ENUM(''situation'',''solution'',''support'') NOT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Migration 007 - QCMS push tracking on ideas (per-TENANT database)

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'qcms_pushed_at') = 0,
  'ALTER TABLE ideas ADD COLUMN qcms_pushed_at DATETIME NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'qcms_push_status') = 0,
  'ALTER TABLE ideas ADD COLUMN qcms_push_status VARCHAR(30) NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'qcms_push_message') = 0,
  'ALTER TABLE ideas ADD COLUMN qcms_push_message VARCHAR(255) NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

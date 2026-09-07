-- 023 Keep the organisation logo in the registry, not only on disk

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
                   AND COLUMN_NAME = 'logo_blob') = 0,
  'ALTER TABLE tenants ADD COLUMN logo_blob MEDIUMBLOB NULL DEFAULT NULL AFTER logo_url',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

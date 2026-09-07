-- Migration 015 - approximate location on the sign-in record (MASTER schema)

-- Where the person appeared to be signing in from.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_login_activity'
       AND COLUMN_NAME = 'location') = 0,
  'ALTER TABLE platform_login_activity ADD COLUMN location VARCHAR(120) NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The kind of network the request arrived on: 'public', 'private' (an office LAN, or a
-- hosting provider's internal proxy) or 'local'.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_login_activity'
       AND COLUMN_NAME = 'network') = 0,
  'ALTER TABLE platform_login_activity ADD COLUMN network VARCHAR(16) NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The console's main view is IFQM staff sign-ins, so that is what this indexes.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_login_activity'
       AND INDEX_NAME = 'idx_pla_actor_created') = 0,
  'CREATE INDEX idx_pla_actor_created ON platform_login_activity(actor_type, created_at)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

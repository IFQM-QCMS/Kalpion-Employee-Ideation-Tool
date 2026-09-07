-- 032 An idea remembers which approval stage it is waiting at

-- Portability note Some MySQL deployments (Aiven's default among them) run with
-- ANSI_QUOTES, in which "..." is an IDENTIFIER, not a string.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @is_tenant := (SELECT COUNT(*) FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas');

-- ideas.current_stage

SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
                   AND COLUMN_NAME = 'current_stage') = 0,
  'ALTER TABLE ideas ADD COLUMN current_stage VARCHAR(40) NULL DEFAULT NULL AFTER escalation_level',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The review queue asks "which ideas are waiting at my stage" on every load.
SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
                   AND INDEX_NAME = 'idx_ideas_current_stage') = 0,
  'CREATE INDEX idx_ideas_current_stage ON ideas(current_stage, status)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Back-fill ideas that are mid-flight

SET @first_stage := NULL;

SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_settings') > 0,
  'SELECT TRIM(SUBSTRING_INDEX(
       TRIM(BOTH '','' FROM REPLACE(REPLACE(value, ''originator,'', ''''), '' '', '''')),
       '','', 1))
     INTO @first_stage
     FROM org_settings WHERE key_name = ''approval_stages'' LIMIT 1',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @first_stage := IFNULL(NULLIF(@first_stage, ''), 'team_lead');

SET @sql := IF(@is_tenant > 0,
  'UPDATE ideas SET current_stage = ?
     WHERE status IN (''Submitted'', ''Under Review'')
       AND current_stage IS NULL
       AND (workflow_type IS NULL OR workflow_type = ''hierarchical'')',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s USING @first_stage; DEALLOCATE PREPARE s;

-- The default chain gains team_lead

SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_settings') > 0,
  'UPDATE org_settings
      SET value = ''originator,team_lead,immediate_manager,department_manager,plant_head''
    WHERE key_name = ''approval_stages''
      AND REPLACE(value, '' '', '''') = ''originator,immediate_manager,department_manager,plant_head''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- And a tenant with no row at all gets one, so the settings screen opens on the truth
-- rather than on an empty control that implies no chain exists.
SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_settings') > 0,
  'INSERT INTO org_settings (key_name, value)
     VALUES (''approval_stages'', ''originator,team_lead,immediate_manager,department_manager,plant_head'')
     ON DUPLICATE KEY UPDATE value = value',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Custom stage names Empty JSON object: no overrides, every stage shows its built-in name.

SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_settings') > 0,
  'INSERT INTO org_settings (key_name, value)
     VALUES (''approval_stage_labels'', ''{}'')
     ON DUPLICATE KEY UPDATE value = value',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The approval threshold is gone

SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
                   AND COLUMN_NAME = 'approval_threshold') > 0,
  'ALTER TABLE ideas DROP COLUMN approval_threshold',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_settings') > 0,
  'DELETE FROM org_settings WHERE key_name = ''approval_threshold''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 024 One approval chain, not four descriptions of it

-- Tenant databases keep the chain in org_settings.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has_org := (SELECT COUNT(*) FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_settings');
SET @sql := IF(@has_org > 0,
  'DELETE FROM org_settings WHERE key_name IN
     (''approval_mode'', ''approval_reviewer_roles'',
      ''approval_final_approver_roles'', ''approval_threshold'')',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Every tenant needs a chain to fall back on.
SET @sql := IF(@has_org > 0,
  'INSERT INTO org_settings (key_name, value)
     VALUES (''approval_stages'', ''originator,immediate_manager,department_manager,plant_head'')
     ON DUPLICATE KEY UPDATE value = value',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The master registry keeps the same keys as new-tenant defaults.
SET @has_plat := (SELECT COUNT(*) FROM information_schema.TABLES
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_settings');
SET @sql := IF(@has_plat > 0,
  'DELETE FROM platform_settings WHERE key_name IN
     (''approval_mode'', ''approval_reviewer_roles'',
      ''approval_final_approver_roles'', ''approval_threshold'')',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@has_plat > 0,
  'INSERT INTO platform_settings (key_name, value)
     VALUES (''approval_stages'', ''originator,immediate_manager,department_manager,plant_head'')
     ON DUPLICATE KEY UPDATE value = value',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ============================================================================
--  028  The attachment ceiling moves from the environment to the console
--
--    mysql -u root -p ifqm_master < db/migrations/028_platform_file_ceiling.sql
--
--  Master registry only.
--
--  The largest attachment any organisation could allow was MAX_FILE_MB, an
--  environment variable. Raising it for one customer meant editing the
--  deployment and restarting, which is not a thing a platform admin should
--  need in order to say "this customer may attach CAD drawings".
--
--  It is now a platform setting. MAX_FILE_MB stays the hard limit and the
--  console value is clamped by it in both directions of the flow — the console
--  decides policy, the server decides what it will physically accept, and a
--  console able to promise more than multer accepts would be promising uploads
--  that fail at the door.
--
--  Deliberately named apart from the tenant's own `max_file_mb`. The two live
--  in different tables and mean different things — the most any organisation
--  MAY be allowed, versus what one organisation HAS chosen — and giving both
--  the same name is how they would come to be read as one setting.
-- ============================================================================

SET @has := (SELECT COUNT(*) FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_settings');

SET @sql := IF(@has > 0,
  "INSERT INTO platform_settings (key_name, value) VALUES ('platform_max_file_mb', '10')
     ON DUPLICATE KEY UPDATE value = value",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

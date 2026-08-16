-- ============================================================================
--  023  Keep the organisation logo in the registry, not only on disk
--
--    mysql -u root -p ifqm_master < db/migrations/023_logo_in_registry_master.sql
--
--  ── The bug this fixes ─────────────────────────────────────────────────────
--
--  An uploaded logo reverted to the default IFQM mark "after some time".
--
--  The PNG was written to uploads/<slug>/logo_*.png and only its FILENAME was
--  stored in tenants.logo_url. The row survived; the file did not. The hosting
--  tier this runs on has an ephemeral disk and sleeps when idle, so every wake
--  is a fresh container with an empty uploads folder — and readLogoDataUri,
--  finding nothing to read, logged a warning and returned null, which the
--  sidebar renders as the default logo.
--
--  Nothing was corrupt and nothing needed re-uploading; the bytes had simply
--  never been anywhere durable. So they go in the registry, which is the only
--  storage this deployment has that outlives a restart.
--
--  MEDIUMBLOB holds 16MB and the upload is capped at 1MB, so the column is
--  three orders of magnitude clear of its limit. A logo is small, read rarely,
--  and already sent to the browser inline as a data: URI — it was never going
--  to be served from a CDN.
--
--  The file on disk is kept as a cache. It costs nothing when it survives and
--  is simply missed when it does not.
-- ============================================================================

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
                   AND COLUMN_NAME = 'logo_blob') = 0,
  'ALTER TABLE tenants ADD COLUMN logo_blob MEDIUMBLOB NULL DEFAULT NULL AFTER logo_url',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

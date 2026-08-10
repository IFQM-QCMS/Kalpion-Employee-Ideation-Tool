-- ─────────────────────────────────────────────────────────────────────────────
--  Migration 015 — approximate location on the sign-in record  (MASTER schema)
--
--    mysql -u root -p ifqm_master < db/migrations/015_login_activity_location.sql
--
--  Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- Where the person appeared to be signing in from.
--
-- This is NOT looked up from the IP address. Doing that would mean sending our
-- administrators' addresses to somebody else's geolocation service on every
-- sign-in, and behind a hosting provider's proxy the address is a private one
-- (10.x) that no lookup could resolve anyway — which is exactly what the live
-- records show.
--
-- Instead the browser reports its own time zone at sign-in, which it already
-- knows and which no third party has to be told about. "Asia/Kolkata (UTC+5:30)"
-- is genuinely useful for spotting a sign-in from somewhere unexpected, and it
-- is honest about being approximate: a time zone is a band of the world, not a
-- place, and anyone using a VPN or travelling will report wherever their machine
-- is set to.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_login_activity'
       AND COLUMN_NAME = 'location') = 0,
  'ALTER TABLE platform_login_activity ADD COLUMN location VARCHAR(120) NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The kind of network the request arrived on: 'public', 'private' (an office
-- LAN, or a hosting provider's internal proxy) or 'local'. Cheap to derive from
-- the address itself, and it explains at a glance why an address looks odd.
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

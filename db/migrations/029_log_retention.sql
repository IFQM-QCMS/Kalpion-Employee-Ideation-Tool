-- ============================================================================
--  029  Access logs are deleted once they pass the retention window
--
--    mysql -u root -p ifqm_master < db/migrations/029_log_retention.sql
--
--  Master registry only — every purgeable log lives here.
--
--  ── What this does and does not touch ──────────────────────────────────────
--
--  The window applies to records of ACCESS, which grow without bound, are only
--  ever read for the recent past, and carry personal data (IP addresses, user
--  agents, phone numbers) there is no reason to hold for years:
--
--      platform_login_activity, login_attempts, sms_delivery_log, login_otps
--
--  It does NOT touch records of DECISIONS or MONEY at any age:
--
--      idea_workflow          who approved each idea and what they said. This
--                             is Section H of the closure PDF and the whole of
--                             the org Audit page. Deleting it would not tidy a
--                             log, it would erase the evidence that a decision
--                             was made properly.
--      tenant_billing_events  the accounting record.
--      payment_attempts       the record of money actually moving.
--
--  "Delete the audit logs" reads as one instruction and is really two, and the
--  half that sounds most like housekeeping is the half that must never happen.
--
--  The window is a setting rather than a constant so it can be moved without a
--  deployment. The service floors it at 6 months regardless of what is stored.
-- ============================================================================

SET @has := (SELECT COUNT(*) FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_settings');

SET @sql := IF(@has > 0,
  "INSERT INTO platform_settings (key_name, value) VALUES ('log_retention_months', '24')
     ON DUPLICATE KEY UPDATE value = value",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

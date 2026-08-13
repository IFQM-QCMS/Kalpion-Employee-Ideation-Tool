-- ============================================================================
--  022  One-time codes beyond sign-in: registration, password reset, SMS
--
--    mysql -u root -p ifqm_master < db/migrations/022_sms_otp_master.sql
--
--  ── The bug this fixes ─────────────────────────────────────────────────────
--
--  `purpose` was ENUM('login','dev_access'). The registration screen issues a
--  code with purpose 'registration_verify', so every request to
--  /api/registrations/send-otp died on "Data truncated for column 'purpose'"
--  and answered 500. Email verification at sign-up has never once worked.
--
--  It is a VARCHAR now rather than a wider ENUM. Every new use of a one-time
--  code — and this migration adds four — otherwise needs a schema change to
--  go with it, and the failure mode when somebody forgets is this one: a 500
--  from a column definition, at the far end of a feature that looks finished.
--  The set of accepted purposes is enforced in verificationService instead,
--  where it can say which values are allowed.
--
--  Purposes in use after this migration:
--    login                sign in with a code instead of a password
--    dev_access           unchanged, pre-existing
--    registration_verify  prove the applicant owns the email address
--    registration_phone   prove the applicant owns the mobile number
--    password_reset       reset a password with a code (email or SMS)
--    phone_verify         prove a number belongs to the person adding it
-- ============================================================================

ALTER TABLE login_otps
  MODIFY COLUMN purpose VARCHAR(32) NOT NULL DEFAULT 'login';

-- Registration checks "was this address verified in the last half hour", which
-- is a lookup by identifier + purpose over consumed rows. Without this it is a
-- table scan on the busiest table in the registry.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'login_otps'
                   AND INDEX_NAME = 'idx_otp_purpose') = 0,
  'ALTER TABLE login_otps ADD INDEX idx_otp_purpose (identifier, purpose, consumed_at)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Which channel actually carried the code. id_type says what the identifier
-- looks like; this says how it travelled, so "the SMS gateway is dropping
-- everything" is answerable without correlating against the delivery log.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'login_otps'
                   AND COLUMN_NAME = 'channel') = 0,
  'ALTER TABLE login_otps ADD COLUMN channel VARCHAR(16) NULL DEFAULT NULL AFTER id_type',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Whether the applicant proved they hold the address and the number they gave.
-- Recorded on the application rather than inferred later: the codes expire and
-- are pruned, so an approver reading the queue next week would otherwise have
-- no way to tell a verified application from an unverified one.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_registrations'
                   AND COLUMN_NAME = 'contact_phone_verified') = 0,
  'ALTER TABLE tenant_registrations ADD COLUMN contact_phone_verified TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_registrations'
                   AND COLUMN_NAME = 'contact_email_verified') = 0,
  'ALTER TABLE tenant_registrations ADD COLUMN contact_email_verified TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- A number is now required of every applicant, so the column stops being
-- optional. Existing rows predate the rule and are left alone; NOT NULL would
-- reject them outright and this is a queue of real applications.
UPDATE tenant_registrations SET contact_phone = '' WHERE contact_phone IS NULL;

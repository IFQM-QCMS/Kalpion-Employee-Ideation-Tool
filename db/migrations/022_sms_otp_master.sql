-- 022 One-time codes beyond sign-in: registration, password reset, SMS

ALTER TABLE login_otps
  MODIFY COLUMN purpose VARCHAR(32) NOT NULL DEFAULT 'login';

-- Registration checks "was this address verified in the last half hour", which is a lookup
-- by identifier + purpose over consumed rows.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'login_otps'
                   AND INDEX_NAME = 'idx_otp_purpose') = 0,
  'ALTER TABLE login_otps ADD INDEX idx_otp_purpose (identifier, purpose, consumed_at)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Which channel actually carried the code. id_type says what the identifier looks like;
-- this says how it travelled, so "the SMS gateway is dropping everything" is answerable
-- without correlating against the delivery log.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'login_otps'
                   AND COLUMN_NAME = 'channel') = 0,
  'ALTER TABLE login_otps ADD COLUMN channel VARCHAR(16) NULL DEFAULT NULL AFTER id_type',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Whether the applicant proved they hold the address and the number they gave.
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

-- A number is now required of every applicant, so the column stops being optional.
UPDATE tenant_registrations SET contact_phone = '' WHERE contact_phone IS NULL;

-- 019 SMS / OTP delivery via an Indian DLT gateway (Jio)

-- Every value is a row in the existing key/value table, so no schema change is needed -
-- only seeds.
INSERT IGNORE INTO platform_settings (key_name, value) VALUES
  -- The connector's own switch, separate from otp_enabled.
  ('sms_dlt_enabled',       '0'),
  ('sms_dlt_entity_id',     ''),
  ('sms_dlt_sender_id',     ''),
  ('sms_dlt_template_id',   ''),
  -- The registered wording. {#var#} is the DLT placeholder convention; the code is
  -- substituted into it at send time.
  ('sms_dlt_template_text', '{#var#} is your Kalpion sign-in code. It expires in {#var#} minute(s). Do not share it with anyone.'),
  ('sms_dlt_endpoint',      'https://api.jiodlt.com/sms/v1/send'),
  -- Secret. Never returned by the read endpoint; see platformSettingsService.
  ('sms_dlt_api_key',       ''),
  -- Written by the test-send path so the console can show when the gateway was last proven
  -- to work, rather than only that somebody typed a key in.
  ('sms_dlt_last_test_at',  ''),
  ('sms_dlt_last_test_ok',  ''),
  ('sms_dlt_last_test_note', '');

-- 012 seeded these; repeated here with IGNORE so a database that somehow missed that
-- migration still ends up with a complete policy rather than falling back to the
-- hard-coded defaults in otpService.
INSERT IGNORE INTO platform_settings (key_name, value) VALUES
  ('otp_enabled',        '0'),
  ('otp_length',         '6'),
  ('otp_ttl_seconds',    '300'),
  ('otp_max_attempts',   '5'),
  ('otp_resend_seconds', '60'),
  ('otp_provider',       'log');

-- Delivery log Every send attempt, so an operator can tell "the gateway rejected it" from
-- "the carrier accepted it and the user still says nothing arrived" - which is the single
-- most common DLT complaint and is impossible to diagnose from an application log that has
-- been rotated away.
CREATE TABLE IF NOT EXISTS sms_delivery_log (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  provider      VARCHAR(32)  NOT NULL,
  purpose       VARCHAR(32)  NOT NULL DEFAULT 'login',
  -- Masked before it reaches this table: last four digits only.
  recipient     VARCHAR(32)  NOT NULL,
  tenant_slug   VARCHAR(64)  NULL,
  template_id   VARCHAR(40)  NULL,
  ok            TINYINT(1)   NOT NULL DEFAULT 0,
  http_status   INT          NULL,
  -- The gateway's own reference, for raising a ticket with them.
  gateway_ref   VARCHAR(120) NULL,
  detail        VARCHAR(255) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sms_log_time (created_at),
  INDEX idx_sms_log_ok (ok, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

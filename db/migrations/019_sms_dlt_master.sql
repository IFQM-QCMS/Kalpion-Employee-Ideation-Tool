-- ============================================================================
--  019  SMS / OTP delivery via an Indian DLT gateway (Jio)
--
--    mysql -u root -p ifqm_master < db/migrations/019_sms_dlt_master.sql
--
--  Migration 012 created the one-time-code machinery and seeded its policy
--  rows, but nothing in the application could ever write them: `otp_*` was
--  absent from the platform-settings whitelist, so `otp_enabled` was stuck at
--  '0' with no screen and no endpoint able to change it. The feature was
--  complete and unreachable.
--
--  This adds the settings a real Indian gateway needs, so the console can turn
--  the feature on.
--
--  ── Why these particular fields ────────────────────────────────────────────
--
--  Under TRAI's DLT regime an enterprise cannot simply send text to an Indian
--  mobile. It registers on an operator's DLT portal (Jio's is TrueConnect) and
--  receives three identifiers, all of which must travel with every message:
--
--    Principal Entity ID   the registered business, ~19 digits
--    Header / Sender ID    the 6-character string the recipient sees
--    Content Template ID   the specific approved wording, ~19 digits
--
--  If the text sent does not match the registered template — including its
--  punctuation — the carrier drops the message silently. There is no error and
--  no delivery report: it simply never arrives. That failure looks exactly like
--  a bug in this application, which is why the approved template body is stored
--  here too and checked against the message before it is sent.
-- ============================================================================

-- Every value is a row in the existing key/value table, so no schema change is
-- needed — only seeds. INSERT IGNORE so re-running is harmless, and so an
-- operator who has already configured a gateway is never reset to blank.
INSERT IGNORE INTO platform_settings (key_name, value) VALUES
  -- The connector's own switch, separate from otp_enabled. A gateway can be
  -- configured and verified before one-time-code sign-in is offered to users,
  -- which is the order anybody sane would do it in.
  ('sms_dlt_enabled',       '0'),
  ('sms_dlt_entity_id',     ''),
  ('sms_dlt_sender_id',     ''),
  ('sms_dlt_template_id',   ''),
  -- The registered wording. {#var#} is the DLT placeholder convention; the
  -- code is substituted into it at send time.
  ('sms_dlt_template_text', '{#var#} is your Kalpion sign-in code. It expires in {#var#} minute(s). Do not share it with anyone.'),
  ('sms_dlt_endpoint',      'https://api.jiodlt.com/sms/v1/send'),
  -- Secret. Never returned by the read endpoint; see platformSettingsService.
  ('sms_dlt_api_key',       ''),
  -- Written by the test-send path so the console can show when the gateway was
  -- last proven to work, rather than only that somebody typed a key in.
  ('sms_dlt_last_test_at',  ''),
  ('sms_dlt_last_test_ok',  ''),
  ('sms_dlt_last_test_note', '');

-- 012 seeded these; repeated here with IGNORE so a database that somehow missed
-- that migration still ends up with a complete policy rather than falling back
-- to the hard-coded defaults in otpService.
INSERT IGNORE INTO platform_settings (key_name, value) VALUES
  ('otp_enabled',        '0'),
  ('otp_length',         '6'),
  ('otp_ttl_seconds',    '300'),
  ('otp_max_attempts',   '5'),
  ('otp_resend_seconds', '60'),
  ('otp_provider',       'log');

-- ── Delivery log ────────────────────────────────────────────────────────────
-- Every send attempt, so an operator can tell "the gateway rejected it" from
-- "the carrier accepted it and the user still says nothing arrived" — which is
-- the single most common DLT complaint and is impossible to diagnose from an
-- application log that has been rotated away.
--
-- The message body is NOT stored. It contains the code.
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

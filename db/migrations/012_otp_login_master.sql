-- Migration 012 - OTP login (MASTER database)

CREATE TABLE IF NOT EXISTS login_otps (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  -- The normalised phone or email the code was sent to, matching the key format
  -- login_directory already uses, so the two agree on what "the same person" is.
  identifier    VARCHAR(255) NOT NULL,
  id_type       ENUM('phone','email') NOT NULL DEFAULT 'phone',
  code_hash     VARCHAR(255) NOT NULL,
  tenant_id     INT          NULL,
  tenant_slug   VARCHAR(50)  NULL,
  user_id       INT          NULL,
  purpose       ENUM('login','dev_access') NOT NULL DEFAULT 'login',
  -- Wrong guesses against THIS code.
  attempts      TINYINT      NOT NULL DEFAULT 0,
  consumed_at   DATETIME     NULL,
  expires_at    DATETIME     NOT NULL,
  requested_ip  VARCHAR(45)  NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_otp_identifier (identifier, expires_at),
  INDEX idx_otp_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Platform-wide OTP policy.
INSERT IGNORE INTO platform_settings (key_name, value) VALUES
  ('otp_enabled',          '0'),   -- off until an SMS provider is contracted
  ('otp_length',           '6'),
  ('otp_ttl_seconds',      '300'), -- 5 minutes
  ('otp_max_attempts',     '5'),
  ('otp_resend_seconds',   '60'),
  -- 'log' writes the code to the server log instead of sending it.
  ('otp_provider',         'log');

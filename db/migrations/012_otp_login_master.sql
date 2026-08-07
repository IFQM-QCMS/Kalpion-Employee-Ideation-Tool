-- ─────────────────────────────────────────────────────────────────────────────
--  Migration 012 — OTP login (MASTER database)
--
--    mysql -u root -p ifqm_master < db/migrations/012_otp_login_master.sql
--
--  Idempotent: safe to re-run. Covers MOM §4.1 and §4.2.
--
--  Codes live in the master registry rather than a tenant schema for the same
--  reason the login directory does: a person requesting a code has not been
--  authenticated yet, so which organisation they belong to is not established
--  until the code is verified.
--
--  The code itself is stored HASHED. A plaintext six-digit column would mean
--  anyone with read access to this table could sign in as any user who happened
--  to have a code outstanding — the same mistake as storing passwords in clear.
-- ─────────────────────────────────────────────────────────────────────────────

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
  -- Wrong guesses against THIS code. Without a per-code counter, a six-digit
  -- code is 1,000,000 guesses and an attacker has the whole validity window to
  -- work through them.
  attempts      TINYINT      NOT NULL DEFAULT 0,
  consumed_at   DATETIME     NULL,
  expires_at    DATETIME     NOT NULL,
  requested_ip  VARCHAR(45)  NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_otp_identifier (identifier, expires_at),
  INDEX idx_otp_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Platform-wide OTP policy. Kept as settings rather than constants so the
-- validity window can be tuned during UAT without a deploy.
INSERT IGNORE INTO platform_settings (key_name, value) VALUES
  ('otp_enabled',          '0'),   -- off until an SMS provider is contracted
  ('otp_length',           '6'),
  ('otp_ttl_seconds',      '300'), -- 5 minutes
  ('otp_max_attempts',     '5'),
  ('otp_resend_seconds',   '60'),
  -- 'log' writes the code to the server log instead of sending it. That is what
  -- makes §4.1's "mock test" possible before any SMS contract exists — and it is
  -- refused outright when NODE_ENV=production, because a provider that logs
  -- login codes in a live system is a credential leak, not a fallback.
  ('otp_provider',         'log');

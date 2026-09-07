-- 027 Domain-based approval for registrations, with an explicit allow list

-- Portability note Some MySQL deployments (Aiven's default among them) run with
-- ANSI_QUOTES, in which "..." is an IDENTIFIER, not a string.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

CREATE TABLE IF NOT EXISTS email_whitelist (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  -- Lower-cased on write. Either 'name@provider.com' or 'provider.com'.
  entry       VARCHAR(190) NOT NULL,
  entry_type  ENUM('address','domain') NOT NULL,
  -- Why this exception exists.
  note        VARCHAR(255) NULL,
  created_by  VARCHAR(150) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email_whitelist_entry (entry),
  KEY idx_email_whitelist_type (entry_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

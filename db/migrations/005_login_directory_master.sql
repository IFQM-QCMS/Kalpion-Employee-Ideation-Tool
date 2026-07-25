-- ─────────────────────────────────────────────────────────────────────────────
--  Migration 005 (master) — Global login directory
--
--    mysql -u root -p ifqm_master < db/migrations/005_login_directory_master.sql
--
--  Idempotent: safe to re-run.
--
--  Login no longer asks for an organisation code. A user signs in with just their
--  email OR their registered phone number, and the platform works out which
--  organisation they belong to. That mapping lives here: one globally-unique
--  identifier (a lowercased email, or a phone reduced to its last 10 digits) →
--  the tenant that owns it.
--
--  It is populated as users are created/imported/updated, and self-heals for
--  pre-existing users the first time they sign in (authService falls back to a
--  scan of active tenants and writes the row it finds). So no data back-fill is
--  required for the feature to work — the directory simply gets faster over time.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS login_directory (
  identifier   VARCHAR(190) NOT NULL,
  id_type      ENUM('email','phone') NOT NULL,
  tenant_id    INT NOT NULL,
  tenant_slug  VARCHAR(50)  NOT NULL,
  user_id      INT NOT NULL,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (identifier),
  KEY idx_login_dir_tenant_user (tenant_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

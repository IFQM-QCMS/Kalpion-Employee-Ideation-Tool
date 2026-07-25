-- ============================================================
--  IFQM Master Database – Tenant Registry
-- ============================================================
CREATE DATABASE IF NOT EXISTS ifqm_master CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ifqm_master;

CREATE TABLE IF NOT EXISTS tenants (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  slug          VARCHAR(50)  NOT NULL UNIQUE,
  domain        VARCHAR(255) NOT NULL,
  db_host       VARCHAR(100) NOT NULL DEFAULT 'localhost',
  db_name       VARCHAR(100) NOT NULL,
  db_user       VARCHAR(100) NOT NULL DEFAULT 'root',
  db_pass       VARCHAR(255) NOT NULL DEFAULT '',
  status        ENUM('active','suspended','pending') NOT NULL DEFAULT 'active',
  is_default    TINYINT(1) NOT NULL DEFAULT 0,
  logo_url      VARCHAR(500) NULL,
  primary_color VARCHAR(7)   NOT NULL DEFAULT '#4f46e5',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_domain (domain)
);

-- Default IFQM tenant for local development
INSERT IGNORE INTO tenants (name, slug, domain, db_host, db_name, db_user, db_pass, status, is_default)
VALUES ('IFQM', 'ifqm', 'localhost', 'localhost', 'ifqm_ideation', 'root', '', 'active', 1);

-- ── Platform Admins (IFQM vendor staff — NOT tenant users) ────────────────
-- These are the SaaS platform operators. They live in ifqm_master,
-- not inside any tenant database, and can only see aggregate stats.
CREATE TABLE IF NOT EXISTS platform_admins (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed: password = "password"
INSERT IGNORE INTO platform_admins (name, email, password_hash)
VALUES (
  'IFQM Platform Admin',
  'platform@ifqm.io',
  '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'
);

-- ── Brute-force lockout state ────────────────────────────────────────────────
-- Persisted rather than held in process memory: an in-memory counter reset on
-- every restart or deploy, did not exist for a second worker process, and grew
-- without bound. Keyed '<email>|<org-slug>' so a single account locks, not an
-- entire office behind one NAT'd IP.
CREATE TABLE IF NOT EXISTS login_attempts (
  login_id      VARCHAR(191) NOT NULL PRIMARY KEY,
  attempts      INT          NOT NULL DEFAULT 0,
  locked_until  DATETIME     NULL DEFAULT NULL,
  last_attempt  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_login_attempts_last (last_attempt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Global login directory ──────────────────────────────────────────────────
-- Login no longer asks for an organisation code. A user signs in with just their
-- email OR their registered phone number; this table maps that globally-unique
-- identifier (lowercased email, or a phone reduced to its last 10 digits) to the
-- tenant that owns it. Maintained as users are created/imported/updated, and
-- self-healed for pre-existing users on their first sign-in (see directoryService).
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

-- ── Tenant branding (organisation display name + PNG logo) ───────────────────
-- `name` and `logo_url` already exist above. logo_url was declared but never
-- populated; it now holds the *stored filename* of the tenant's uploaded PNG,
-- not a public URL. The bytes live under backend/uploads/<slug>/ next to idea
-- attachments, which is deliberately NOT web-accessible — they are served
-- inline (as a data: URI) from the authenticated GET /api/branding.
-- logo_updated_at is what lets a client tell that an admin replaced the file.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_updated_at DATETIME NULL;

-- ── Support tickets ─────────────────────────────────────────────────────────
-- These live in the MASTER registry, not in tenant databases, and that is the
-- whole point: a platform admin must be able to read and answer them without
-- ever opening a customer's database. A ticket is also the one place a tenant
-- user's name and words are deliberately shown to the vendor — the user chose to
-- contact support, so it is disclosure by consent rather than a back door. It
-- stays scoped to what they typed: no ideas, no files, no directory.
--
-- requester_user_id is the user's id INSIDE their tenant DB. It is intentionally
-- not a foreign key — master cannot reference a table in another schema, and the
-- name/email are denormalised so a ticket survives the account being deleted.
CREATE TABLE IF NOT EXISTS support_tickets (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ticket_code      VARCHAR(20)  NOT NULL UNIQUE,
  tenant_id        INT          NULL,          -- NULL = raised by IFQM itself
  tenant_slug      VARCHAR(50)  NULL,
  requester_user_id INT         NULL,
  requester_name   VARCHAR(100) NOT NULL,
  requester_email  VARCHAR(150) NULL,
  requester_role   VARCHAR(30)  NULL,
  raised_by        ENUM('tenant','platform') NOT NULL DEFAULT 'tenant',
  subject          VARCHAR(200) NOT NULL,
  category         ENUM('bug','question','access','feature','other') NOT NULL DEFAULT 'question',
  priority         ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  status           ENUM('open','in_progress','waiting','resolved','closed') NOT NULL DEFAULT 'open',
  assignee_id      INT          NULL,          -- platform_admins.id
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  resolved_at      DATETIME NULL,
  FOREIGN KEY (assignee_id) REFERENCES platform_admins(id) ON DELETE SET NULL,
  INDEX idx_tickets_status (status),
  INDEX idx_tickets_tenant (tenant_id),
  INDEX idx_tickets_requester (tenant_id, requester_user_id),
  INDEX idx_tickets_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The conversation. is_internal marks a note only IFQM staff may read; every
-- read path for a tenant user MUST filter it out (see supportService).
CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id   INT NOT NULL,
  author_type ENUM('tenant','platform') NOT NULL,
  author_name VARCHAR(100) NOT NULL,
  body        TEXT NOT NULL,
  is_internal TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
  INDEX idx_ticket_messages (ticket_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Platform settings (defaults applied to newly provisioned tenants) ────────
-- createTenant() used to seed a hardcoded APPROVAL_DEFAULTS list, so changing
-- what a new organisation starts with meant editing JavaScript and redeploying.
-- These rows are that list, made editable. They are DEFAULTS ONLY: an existing
-- tenant's org_settings are its own, and changing a default here never reaches
-- back into an organisation that already exists.
CREATE TABLE IF NOT EXISTS platform_settings (
  key_name   VARCHAR(100) NOT NULL PRIMARY KEY,
  value      TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO platform_settings (key_name, value) VALUES
  ('review_sla_days',               '7'),
  ('escalation_days',               '14'),
  ('anonymous_allowed',             '1'),
  ('public_board_enabled',          '1'),
  ('challenges_enabled',            '1'),
  ('approval_mode',                 'default'),
  ('approval_reviewer_roles',       'team_lead,project_lead,manager,senior_manager'),
  ('approval_final_approver_roles', 'executive,admin,super_admin'),
  ('approval_threshold',            '100');

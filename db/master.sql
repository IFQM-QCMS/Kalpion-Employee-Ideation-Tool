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
  -- When anybody from this organisation last signed in. Reported, never
  -- enforced: the platform console shows which organisations have gone quiet
  -- without anything being switched off behind their back. `status` stays the
  -- operator's deliberate choice; inactivity is derived from this.
  last_login_at DATETIME NULL DEFAULT NULL,
  -- Per-organisation limits. NULL means "use the platform default", so raising
  -- the default lifts every organisation that has not been given its own number.
  api_quota_total   INT NULL DEFAULT NULL,
  api_quota_monthly INT NULL DEFAULT NULL,
  storage_quota_mb  INT NULL DEFAULT NULL,
  -- ── Billing ──
  -- Which plan this organisation is on, where the money stands, and until when.
  -- billing_status is held apart from `status` above on purpose: `status` is
  -- what a PERSON did to this organisation, billing_status is where the money
  -- stands. An operator may suspend an account for a reason unrelated to
  -- payment, and paying must not silently undo that.
  plan_id        INT NULL DEFAULT NULL,
  billing_status ENUM('trial','active','past_due','expired','exempt') NOT NULL DEFAULT 'trial',
  trial_days     INT NOT NULL DEFAULT 14,
  trial_ends_at  DATETIME NULL DEFAULT NULL,
  period_start   DATETIME NULL DEFAULT NULL,
  period_end     DATETIME NULL DEFAULT NULL,
  billing_note   VARCHAR(500) NULL DEFAULT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_domain (domain),
  KEY idx_tenants_billing (billing_status, period_end)
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
-- `ADD COLUMN IF NOT EXISTS` is MariaDB-only — it parses on a local XAMPP box
-- and is a syntax error on real MySQL 8. Guard on information_schema instead so
-- this file stays idempotent on both engines (same idiom as migration 001).
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
       AND COLUMN_NAME = 'logo_updated_at') = 0,
  'ALTER TABLE tenants ADD COLUMN logo_updated_at DATETIME NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

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
  INDEX idx_tickets_updated (updated_at),
  -- Archiving is not closing. Closing is the outcome of the conversation;
  -- archiving is the operator saying "stop showing me this". Reversible.
  archived_at DATETIME NULL DEFAULT NULL,
  INDEX idx_tickets_archived (archived_at)
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


-- ═══════════════════════════════════════════════════════════════════════════
-- Tables introduced by migrations 009, 010 and 012, folded in so a new
-- registry starts complete. An existing registry gets them from the migration
-- files instead; the two definitions are kept identical on purpose.
-- ═══════════════════════════════════════════════════════════════════════════

-- MSME applications for a workspace. Nothing here becomes a tenant until a
-- platform admin approves it.
CREATE TABLE IF NOT EXISTS tenant_registrations (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  company_name          VARCHAR(150) NOT NULL,
  proposed_slug         VARCHAR(50)  NOT NULL,
  email_domain          VARCHAR(255) NOT NULL,
  website               VARCHAR(255) NULL,
  udyam_number          VARCHAR(30)  NULL,
  gstin                 VARCHAR(20)  NULL,
  pan                   VARCHAR(12)  NULL,
  cin                   VARCHAR(30)  NULL,
  entity_type           ENUM('proprietorship','partnership','llp','private_limited',
                             'public_limited','cooperative','trust','society','other') NULL,
  enterprise_category   ENUM('micro','small','medium') NULL,
  sector                VARCHAR(100) NULL,
  nic_code              VARCHAR(10)  NULL,
  employee_count        INT          NULL,
  annual_turnover_band  VARCHAR(40)  NULL,
  year_established      SMALLINT     NULL,
  address_line          VARCHAR(255) NULL,
  city                  VARCHAR(100) NULL,
  state                 VARCHAR(100) NULL,
  pincode               VARCHAR(12)  NULL,
  country               VARCHAR(80)  NOT NULL DEFAULT 'India',
  contact_name          VARCHAR(120) NOT NULL,
  contact_designation   VARCHAR(120) NULL,
  contact_email         VARCHAR(255) NOT NULL,
  contact_phone         VARCHAR(20)  NULL,
  accepted_terms        TINYINT(1)   NOT NULL DEFAULT 0,
  status                ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  review_note           TEXT         NULL,
  reviewed_by           INT          NULL,
  reviewed_at           DATETIME     NULL,
  tenant_id             INT          NULL,
  submitted_ip          VARCHAR(45)  NULL,
  -- Chosen by the approver at the moment they say yes, when the company's size
  -- and turnover are in front of them.
  assigned_plan_id      INT          NULL,
  assigned_trial_days   INT          NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_treg_status (status, created_at),
  KEY idx_treg_domain (email_domain),
  KEY idx_treg_email (contact_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only record of every sign-in attempt, across every organisation.
-- `login_attempts` above is lockout STATE and is cleared on success, so it can
-- never answer "who signed in, and when". This can.
CREATE TABLE IF NOT EXISTS platform_login_activity (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  actor_type    ENUM('platform_admin','tenant_user') NOT NULL,
  actor_id      VARCHAR(40)  NULL,
  actor_name    VARCHAR(120) NULL,
  actor_email   VARCHAR(255) NULL,
  tenant_id     INT          NULL,
  tenant_slug   VARCHAR(50)  NULL,
  outcome       ENUM('success','failure','lockout') NOT NULL,
  ip            VARCHAR(45)  NULL,
  user_agent    VARCHAR(255) NULL,
  -- Roughly where the sign-in came from, from the time zone the browser reports
  -- about itself. The IP is deliberately not looked up anywhere: that would mean
  -- sending administrators addresses to a third-party service on every sign-in,
  -- and behind a hosting proxy the address is private and unresolvable anyway.
  location      VARCHAR(120) NULL,
  -- public / private / local, derived from the address itself. Explains at a
  -- glance why every sign-in appears to come from 10.x behind a load balancer.
  network       VARCHAR(16)  NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pla_created (created_at),
  INDEX idx_pla_outcome (outcome, created_at),
  INDEX idx_pla_actor_created (actor_type, created_at),
  INDEX idx_pla_tenant (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Request counters per organisation. Counted here rather than in memory: an
-- in-process counter resets on every deploy and does not exist for a second
-- worker, which is the same mistake the brute-force lockout had to be moved out of.
CREATE TABLE IF NOT EXISTS tenant_api_usage (
  tenant_id     INT          NOT NULL,
  period        CHAR(7)      NOT NULL,   -- 'YYYY-MM', or 'total' for the lifetime counter
  request_count INT          NOT NULL DEFAULT 0,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One-time sign-in codes.
CREATE TABLE IF NOT EXISTS login_otps (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  identifier    VARCHAR(255) NOT NULL,
  id_type       ENUM('phone','email') NOT NULL DEFAULT 'phone',
  code_hash     VARCHAR(255) NOT NULL,
  tenant_id     INT          NULL,
  tenant_slug   VARCHAR(50)  NULL,
  user_id       INT          NULL,
  purpose       ENUM('login','dev_access') NOT NULL DEFAULT 'login',
  -- Wrong guesses against THIS code. Without a per-code counter a six-digit
  -- code is a million guesses and an attacker has the whole window to try them.
  attempts      TINYINT      NOT NULL DEFAULT 0,
  consumed_at   DATETIME     NULL,
  expires_at    DATETIME     NOT NULL,
  requested_ip  VARCHAR(45)  NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_otp_identifier (identifier, expires_at),
  INDEX idx_otp_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One-time-code policy. Settings rather than constants so the validity window
-- can be tuned during acceptance testing without a deploy.
INSERT IGNORE INTO platform_settings (key_name, value) VALUES
  ('otp_enabled',        '0'),
  ('otp_length',         '6'),
  ('otp_ttl_seconds',    '300'),
  ('otp_max_attempts',   '5'),
  ('otp_resend_seconds', '60'),
  -- 'log' writes the code to the server log instead of sending it, which is
  -- what makes testing possible before an SMS contract exists. It is refused
  -- outright under NODE_ENV=production: a provider that logs sign-in codes in a
  -- live system is a credential leak, not a fallback.
  ('otp_provider',       'log');


-- ═══════════════════════════════════════════════════════════════════════════
-- Billing (migration 016), folded in so a new registry starts complete.
-- ═══════════════════════════════════════════════════════════════════════════

-- What IFQM sells.
--
-- Money is stored in paise as a whole number, never as a decimal. A price is an
-- exact quantity and floating point is not: 2500.10 has no exact binary form,
-- and the error compounds the moment 18% tax is applied to it and part of it is
-- later refunded. Everything monetary here is an integer count of the smallest
-- unit, converted only for display.
CREATE TABLE IF NOT EXISTS plans (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  code           VARCHAR(40)  NOT NULL UNIQUE,
  name           VARCHAR(80)  NOT NULL,
  description    VARCHAR(255) NULL,
  long_description TEXT       NULL,
  tier           ENUM('trial','starter','professional','enterprise','custom')
                 NOT NULL DEFAULT 'starter',
  amount_paise   BIGINT       NOT NULL DEFAULT 0,
  billing_cycle  ENUM('monthly','quarterly','half_yearly','yearly','one_time')
                 NOT NULL DEFAULT 'yearly',
  gst_percent    DECIMAL(5,2) NOT NULL DEFAULT 18.00,
  -- Whether the stored amount already contains the tax or the tax is added to
  -- it. Recorded per plan rather than assumed: getting it wrong is an 18% error
  -- on every invoice.
  gst_mode       ENUM('included','excluded') NOT NULL DEFAULT 'included',
  is_custom      TINYINT(1)   NOT NULL DEFAULT 0,
  -- NULL means no limit. Zero would be a real limit meaning nobody may join,
  -- which is never what an operator means by leaving a box empty.
  max_users      INT          NULL DEFAULT NULL,
  max_departments INT         NULL DEFAULT NULL,
  max_ideas      INT          NULL DEFAULT NULL,
  storage_gb     INT          NULL DEFAULT NULL,
  support_level  ENUM('basic','standard','priority','dedicated') NOT NULL DEFAULT 'standard',
  status         ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_plans_status (status, tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO plans
  (code, name, description, tier, amount_paise, billing_cycle, gst_percent, gst_mode,
   max_users, max_departments, storage_gb, support_level, status)
VALUES
  ('TRIAL',   'Free Trial',   'Full access while the organisation evaluates the platform.',
   'trial',        0,        'monthly',   18.00, 'included', NULL, NULL, 5,  'standard', 'active'),
  ('STARTER', 'Starter',      'For a single plant getting started with structured ideation.',
   'starter',      250000,   'monthly',   18.00, 'included', 100,  10,   10, 'standard', 'active'),
  ('PRO',     'Professional', 'For multi-plant MSMEs running ideation across departments.',
   'professional', 5000000,  'quarterly', 18.00, 'included', 1500, 50,   50, 'priority', 'active');

-- Who changed an organisation's plan, when, from what to what, and why. A
-- billing dispute is answered from a record or it is answered from memory.
CREATE TABLE IF NOT EXISTS tenant_billing_events (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id      INT          NOT NULL,
  event          ENUM('plan_assigned','plan_changed','trial_extended','trial_shortened',
                      'period_renewed','marked_paid','lapsed','put_on_hold','reinstated','note')
                 NOT NULL,
  from_plan_id   INT          NULL,
  to_plan_id     INT          NULL,
  from_value     VARCHAR(120) NULL,
  to_value       VARCHAR(120) NULL,
  note           VARCHAR(500) NULL,
  actor_id       INT          NULL,          -- NULL when the nightly sweep did it
  actor_name     VARCHAR(120) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tbe_tenant (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO platform_settings (key_name, value) VALUES
  ('default_trial_days',    '14'),
  ('billing_warn_days',     '5'),
  -- Off in a fresh install: nobody should be locked out of a system whose
  -- prices have not been set yet.
  ('billing_enforce',       '0'),
  ('billing_contact_email', ''),
  ('billing_contact_phone', '');

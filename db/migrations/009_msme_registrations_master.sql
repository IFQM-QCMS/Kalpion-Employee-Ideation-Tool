-- ─────────────────────────────────────────────────────────────────────────────
--  Migration 009 — MSME self-registration queue (MASTER database)
--
--    mysql -u root -p ifqm_master < db/migrations/009_msme_registrations_master.sql
--
--  Idempotent: safe to re-run.
--
--  Until now an organisation could only exist if a platform admin typed it into
--  the console. This table is the front door: an MSME applies for itself, the
--  application sits here as `pending`, and a platform admin approves it — at
--  which point (and only then) the tenant database is provisioned and the
--  applicant can sign in. Nothing self-serve touches a tenant schema.
--
--  The field set follows what an Indian MSME already holds after Udyam
--  registration, so an applicant is transcribing a certificate rather than
--  hunting for answers: Udyam number, PAN, optional GSTIN, entity type,
--  micro/small/medium category, NIC activity code, headcount and turnover band,
--  registered address. Only the fields needed to identify and contact the
--  business are NOT NULL — an over-strict form is abandoned, and a rejected
--  application costs the reviewer nothing.
--
--  Deliberately NOT collected: Aadhaar, bank account details and any document
--  scans. Udyam itself needs them; an ideation tool does not, and holding them
--  would turn this table into a target for no product benefit.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_registrations (
  id                    INT AUTO_INCREMENT PRIMARY KEY,

  -- ── Identity of the organisation ──
  company_name          VARCHAR(150) NOT NULL,
  -- Requested org code. Not applied until approval, so two pending applications
  -- may ask for the same one; the reviewer resolves it.
  proposed_slug         VARCHAR(50)  NOT NULL,
  -- The corporate email domain the application was made from. Every user this
  -- organisation later creates is expected to sit on it, and it is what makes a
  -- second application from the same company detectable.
  email_domain          VARCHAR(255) NOT NULL,
  website               VARCHAR(255) NULL,

  -- ── Statutory identity ──
  -- Udyam Registration Number: the MSME's own proof of being an MSME.
  udyam_number          VARCHAR(30)  NULL,
  gstin                 VARCHAR(20)  NULL,   -- optional: not every MSME crosses the threshold
  pan                   VARCHAR(12)  NULL,
  cin                   VARCHAR(30)  NULL,   -- companies only
  entity_type           ENUM('proprietorship','partnership','llp','private_limited',
                             'public_limited','cooperative','trust','society','other') NULL,
  -- Micro / Small / Medium, per the investment + turnover limits the applicant
  -- self-declares at Udyam. Stored as given: this is a business profile, not an
  -- eligibility gate the platform enforces.
  enterprise_category   ENUM('micro','small','medium') NULL,

  -- ── Business profile ──
  sector                VARCHAR(100) NULL,
  nic_code              VARCHAR(10)  NULL,   -- NIC 2-digit activity code
  employee_count        INT          NULL,
  annual_turnover_band  VARCHAR(40)  NULL,
  year_established      SMALLINT     NULL,

  -- ── Registered address ──
  address_line          VARCHAR(255) NULL,
  city                  VARCHAR(100) NULL,
  state                 VARCHAR(100) NULL,
  pincode               VARCHAR(12)  NULL,
  country               VARCHAR(80)  NOT NULL DEFAULT 'India',

  -- ── The person applying — becomes the organisation's first admin ──
  contact_name          VARCHAR(120) NOT NULL,
  contact_designation   VARCHAR(120) NULL,
  contact_email         VARCHAR(255) NOT NULL,
  contact_phone         VARCHAR(20)  NULL,

  accepted_terms        TINYINT(1)   NOT NULL DEFAULT 0,

  -- ── Review workflow ──
  status                ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  review_note           TEXT         NULL,
  reviewed_by           INT          NULL,   -- platform_admins.id
  reviewed_at           DATETIME     NULL,
  -- Set on approval: the tenant this application became.
  tenant_id             INT          NULL,

  submitted_ip          VARCHAR(45)  NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- One live application per applicant. A rejected application must be
  -- resubmittable, so this is not a plain UNIQUE on the email.
  KEY idx_treg_status (status, created_at),
  KEY idx_treg_domain (email_domain),
  KEY idx_treg_email (contact_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Organisation activity tracking ───────────────────────────────────────────
-- "Inactive" is reported, never enforced: the platform admin sees which orgs
-- have gone quiet without anything being switched off behind their back. That
-- is why this is a timestamp rather than a status — the status column stays the
-- operator's deliberate choice (active / on hold), and inactivity is derived.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
       AND COLUMN_NAME = 'last_login_at') = 0,
  'ALTER TABLE tenants ADD COLUMN last_login_at DATETIME NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

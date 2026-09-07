-- Migration 009 - MSME self-registration queue (MASTER database)

CREATE TABLE IF NOT EXISTS tenant_registrations (
  id                    INT AUTO_INCREMENT PRIMARY KEY,

  -- Identity of the organisation
  company_name          VARCHAR(150) NOT NULL,
  -- Requested org code. Not applied until approval, so two pending applications may ask for
  -- the same one; the reviewer resolves it.
  proposed_slug         VARCHAR(50)  NOT NULL,
  -- The corporate email domain the application was made from.
  email_domain          VARCHAR(255) NOT NULL,
  website               VARCHAR(255) NULL,

  -- Statutory identity Udyam Registration Number: the MSME's own proof of being an MSME.
  udyam_number          VARCHAR(30)  NULL,
  gstin                 VARCHAR(20)  NULL,   -- optional: not every MSME crosses the threshold
  pan                   VARCHAR(12)  NULL,
  cin                   VARCHAR(30)  NULL,   -- companies only
  entity_type           ENUM('proprietorship','partnership','llp','private_limited',
                             'public_limited','cooperative','trust','society','other') NULL,
  -- Micro / Small / Medium, per the investment + turnover limits the applicant self-declares
  -- at Udyam.
  enterprise_category   ENUM('micro','small','medium') NULL,

  -- Business profile
  sector                VARCHAR(100) NULL,
  nic_code              VARCHAR(10)  NULL,   -- NIC 2-digit activity code
  employee_count        INT          NULL,
  annual_turnover_band  VARCHAR(40)  NULL,
  year_established      SMALLINT     NULL,

  -- Registered address
  address_line          VARCHAR(255) NULL,
  city                  VARCHAR(100) NULL,
  state                 VARCHAR(100) NULL,
  pincode               VARCHAR(12)  NULL,
  country               VARCHAR(80)  NOT NULL DEFAULT 'India',

  -- The person applying - becomes the organisation's first admin
  contact_name          VARCHAR(120) NOT NULL,
  contact_designation   VARCHAR(120) NULL,
  contact_email         VARCHAR(255) NOT NULL,
  contact_phone         VARCHAR(20)  NULL,

  accepted_terms        TINYINT(1)   NOT NULL DEFAULT 0,

  -- Review workflow
  status                ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  review_note           TEXT         NULL,
  reviewed_by           INT          NULL,   -- platform_admins.id
  reviewed_at           DATETIME     NULL,
  -- Set on approval: the tenant this application became.
  tenant_id             INT          NULL,

  submitted_ip          VARCHAR(45)  NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- One live application per applicant.
  KEY idx_treg_status (status, created_at),
  KEY idx_treg_domain (email_domain),
  KEY idx_treg_email (contact_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Organisation activity tracking "Inactive" is reported, never enforced: the platform
-- admin sees which orgs have gone quiet without anything being switched off behind their
-- back.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
       AND COLUMN_NAME = 'last_login_at') = 0,
  'ALTER TABLE tenants ADD COLUMN last_login_at DATETIME NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

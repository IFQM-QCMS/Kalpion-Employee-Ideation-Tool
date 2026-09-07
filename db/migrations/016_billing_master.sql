-- Migration 016 - subscription plans, trials and billing state (MASTER)

-- The plan catalogue What IFQM sells.
CREATE TABLE IF NOT EXISTS plans (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  -- Short code the platform team uses in conversation and in exports.
  code           VARCHAR(40)  NOT NULL UNIQUE,
  name           VARCHAR(80)  NOT NULL,
  description    VARCHAR(255) NULL,
  long_description TEXT       NULL,
  tier           ENUM('trial','starter','professional','enterprise','custom')
                 NOT NULL DEFAULT 'starter',

  -- Price
  amount_paise   BIGINT       NOT NULL DEFAULT 0,
  billing_cycle  ENUM('monthly','quarterly','half_yearly','yearly','one_time')
                 NOT NULL DEFAULT 'yearly',
  gst_percent    DECIMAL(5,2) NOT NULL DEFAULT 18.00,
  -- Whether `amount_paise` already contains the tax, or the tax is added to it.
  gst_mode       ENUM('included','excluded') NOT NULL DEFAULT 'included',
  -- A custom plan is quoted privately and is not shown in any public list.
  is_custom      TINYINT(1)   NOT NULL DEFAULT 0,

  -- Limits NULL means "no limit".
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

-- Three to start with. INSERT IGNORE, so an operator who has already edited them keeps
-- their own figures.
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

-- Which plan an organisation is on, and until when
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
                   AND COLUMN_NAME = 'plan_id') = 0,
  'ALTER TABLE tenants ADD COLUMN plan_id INT NULL DEFAULT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- trial paying lapsed. Held apart from `tenants.status`, which stays what a human
-- deliberately did to the organisation.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
                   AND COLUMN_NAME = 'billing_status') = 0,
  -- Single-quoted with doubled internal quotes, not double-quoted.
  'ALTER TABLE tenants ADD COLUMN billing_status ENUM(''trial'',''active'',''past_due'',''expired'',''exempt'') NOT NULL DEFAULT ''trial''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- When the free evaluation runs out. NULL means no trial was granted.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
                   AND COLUMN_NAME = 'trial_ends_at') = 0,
  'ALTER TABLE tenants ADD COLUMN trial_ends_at DATETIME NULL DEFAULT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- How many days were granted.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
                   AND COLUMN_NAME = 'trial_days') = 0,
  'ALTER TABLE tenants ADD COLUMN trial_days INT NOT NULL DEFAULT 14', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The paid period currently in force.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
                   AND COLUMN_NAME = 'period_start') = 0,
  'ALTER TABLE tenants ADD COLUMN period_start DATETIME NULL DEFAULT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
                   AND COLUMN_NAME = 'period_end') = 0,
  'ALTER TABLE tenants ADD COLUMN period_end DATETIME NULL DEFAULT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Free-text note for whatever was actually agreed on the phone.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
                   AND COLUMN_NAME = 'billing_note') = 0,
  'ALTER TABLE tenants ADD COLUMN billing_note VARCHAR(500) NULL DEFAULT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'
                   AND INDEX_NAME = 'idx_tenants_billing') = 0,
  'CREATE INDEX idx_tenants_billing ON tenants(billing_status, period_end)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- What the platform admin chose when approving the application
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_registrations'
                   AND COLUMN_NAME = 'assigned_plan_id') = 0,
  'ALTER TABLE tenant_registrations ADD COLUMN assigned_plan_id INT NULL DEFAULT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_registrations'
                   AND COLUMN_NAME = 'assigned_trial_days') = 0,
  'ALTER TABLE tenant_registrations ADD COLUMN assigned_trial_days INT NULL DEFAULT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- An audit of every billing decision Who changed an organisation's plan, when, from what
-- to what, and why.
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
  -- NULL when the platform itself did it (the nightly lapse sweep).
  actor_id       INT          NULL,
  actor_name     VARCHAR(120) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tbe_tenant (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Platform defaults
INSERT IGNORE INTO platform_settings (key_name, value) VALUES
  -- What a newly approved organisation gets unless the approver says otherwise.
  ('default_trial_days',     '14'),
  -- How many days before the end to start warning the organisation.
  ('billing_warn_days',      '5'),
  -- Whether a lapsed organisation is actually blocked, or only warned.
  ('billing_enforce',        '0'),
  ('billing_contact_email',  ''),
  ('billing_contact_phone',  '');

-- Existing organisations must not suddenly be treated as unpaid.
UPDATE tenants SET billing_status = 'exempt'
 WHERE billing_status = 'trial' AND plan_id IS NULL AND trial_ends_at IS NULL;

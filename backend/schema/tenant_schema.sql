-- ============================================================
--  IFQM Consolidated Per-Tenant Schema (used for provisioning)
--
--  This is the source schema.sql + the tables that previously lived only in
--  schema_updates.sql (idea_comments, challenges, email_queue). The original
--  schema.sql referenced idea_comments in an index but never created the
--  table, so provisioning a new tenant from schema.sql alone failed. This
--  consolidated file produces a tenant identical to the existing working DBs.
--
--  KEEP THIS FILE IN STEP WITH db/migrations/*.sql.
--  createTenant() provisions a new organisation from THIS FILE ALONE — it never
--  runs the migrations, which exist to upgrade databases that already exist. So
--  anything a migration adds must also be born here, or every organisation
--  created from the UI starts life missing it. That is not hypothetical: the
--  columns from migrations 001 and 002 were absent here, and "Create New
--  Organisation" died on `Unknown column 'password_changed_at' in 'field list'`
--  while the modal showed only a generic "Server error. Please try again."
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  employee_id     VARCHAR(20)  NOT NULL UNIQUE,
  -- Sign-in name, unique across the WHOLE platform (migration 025), because
  -- login_directory resolves an identifier to an organisation through a single
  -- primary key — that is what allows signing in without an org code.
  username        VARCHAR(50)  NULL DEFAULT NULL,
  name            VARCHAR(100) NOT NULL,
  -- Nullable since migration 025: an employee with no company mailbox had to be
  -- given a fabricated address before an account could exist. An account needs
  -- at least one of username/email, enforced in userService so the error can
  -- name the field to fill in.
  email           VARCHAR(150) NULL DEFAULT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  phone           VARCHAR(20),
  department      VARCHAR(100),
  business_unit   VARCHAR(100),
  location        VARCHAR(100),
  -- department_manager / plant_head are appended at the END on purpose: an ENUM
  -- is stored as the ordinal of its member, so a tenant created from this file
  -- must number its members exactly as migration 003 leaves an upgraded one.
  role            ENUM('trainee','employee','team_lead','project_lead','manager','senior_manager','executive','admin','super_admin','department_manager','plant_head') NOT NULL DEFAULT 'employee',
  manager_id      INT NULL,
  points          INT NOT NULL DEFAULT 0,
  avatar_initials VARCHAR(4),
  status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- ── from migration 001 (production hardening) ──
  -- Stamped into every token so the auth middleware can reject sessions opened
  -- before the password last changed. createTenant writes it on the org's first
  -- admin, so a tenant born without this column cannot be created at all.
  password_changed_at DATETIME NULL DEFAULT NULL,
  deactivated_at      DATETIME NULL DEFAULT NULL,
  -- ── from migration 002 (bulk user import) ──
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  date_of_birth        DATE NULL DEFAULT NULL,
  -- Neither of these is written any more (migration 031).
  --
  -- MOM 29 Jul 2026 §13.4 first narrowed this from a full date to a birth YEAR,
  -- because the derived temporary password only ever used the year and the rest
  -- was personal data held for no purpose. The same argument then applied to the
  -- year: it was required of every employee in order to build one throwaway
  -- credential, and nothing else in the product read it. The password is built
  -- from the phone number now, which every account already has.
  --
  -- Both columns are kept, not dropped: organisations onboarded under the old
  -- rule have real values here, and erasing them is a decision for the customer
  -- to ask for rather than something to do quietly in an unrelated release.
  salutation           VARCHAR(10) NULL DEFAULT NULL,
  first_name           VARCHAR(60) NULL DEFAULT NULL,
  last_name            VARCHAR(60) NULL DEFAULT NULL,
  year_of_birth        SMALLINT NULL DEFAULT NULL,

  activated_at         DATETIME NULL DEFAULT NULL,
  FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_users_username (username),
  INDEX idx_users_email_status (email, status),
  INDEX idx_users_name (name),
  INDEX idx_users_manager (manager_id)
);

CREATE TABLE IF NOT EXISTS ideas (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  idea_code                VARCHAR(20)  NOT NULL UNIQUE,
  title                    VARCHAR(255) NOT NULL,
  present_situation        TEXT NOT NULL,
  proposed_solution        TEXT NOT NULL,
  impact_areas             VARCHAR(255),
  impact_level             ENUM('Low','Medium','High') DEFAULT 'Medium',
  tangible_benefit         TEXT,
  intangible_benefit       TEXT,
  -- ── business case, captured at submission (from migration 003) ──
  -- All optional: every idea filed before these existed would otherwise have
  -- become retrospectively invalid. expected_implementation_date is the
  -- SUBMITTER's estimate; implementation_target_date below is what the
  -- implementation owner commits to after approval — deliberately separate.
  investment_required      VARCHAR(255) NULL DEFAULT NULL,
  feasibility              ENUM('Low','Medium','High') NULL DEFAULT NULL,
  implementation_duration  VARCHAR(120) NULL DEFAULT NULL,
  expected_implementation_date DATE NULL DEFAULT NULL,
  benefits_expected        TEXT NULL DEFAULT NULL,
  support_required         TEXT NULL DEFAULT NULL,
  -- ── MOM 29 Jul 2026 (migration 010) ──
  -- Time Required: three fixed bands. implementation_duration above stays as
  -- free text — it holds real data on older ideas and cannot be coerced safely.
  time_required            ENUM('lt_3m','3_6m','6_12m') NULL DEFAULT NULL,
  -- Process Improvement / QCD. CSV of tag keys: the set is fixed and small, and
  -- is never queried relationally, so a join table would be ceremony.
  solution_tags            VARCHAR(255) NULL DEFAULT NULL,
  -- Patentability is a separate axis from approval: an idea can be approved and
  -- unpatentable, or rejected and still worth a provisional filing.
  patentability            ENUM('not_assessed','not_patentable','possible','recommended','filed') NOT NULL DEFAULT 'not_assessed',
  -- Claimed by a person at submission, as distinct from the organisation's
  -- assessment above. An employee ticking this is a prompt to look, not a
  -- verdict, so it must never overwrite the admin's decision.
  patentable_flag          TINYINT(1) NOT NULL DEFAULT 0,
  patentable_flagged_by    INT NULL DEFAULT NULL,
  patentability_note       TEXT NULL DEFAULT NULL,
  -- Archiving hides an idea from working lists without destroying its points,
  -- audit trail or ROI figures. NULL = live.
  archived_at              DATETIME NULL DEFAULT NULL,
  archived_by              INT NULL DEFAULT NULL,
  ai_score                 INT DEFAULT 0,
  ai_reason                TEXT,
  workflow_type            ENUM('hierarchical','multi_reviewer') NOT NULL DEFAULT 'hierarchical',
  -- Historical only (migration 024). Committee decisions are unanimous; nothing
  -- reads or writes this. Kept so the record of how already-decided ideas were
  -- judged is not rewritten.
  upvotes                  INT NOT NULL DEFAULT 0,
  downvotes                INT NOT NULL DEFAULT 0,
  escalation_level         INT NOT NULL DEFAULT 0,
  -- ── from migration 032 ──
  -- The approval stage this idea is waiting at ('team_lead', 'plant_head'...),
  -- NULL for drafts, closed ideas and committee ideas — none of which travel
  -- the chain. The KEY, not an index: an admin may reorder or remove stages
  -- while ideas are in flight, and a stored index would silently come to mean
  -- a different stage.
  current_stage            VARCHAR(40) NULL DEFAULT NULL,
  current_reviewer_id      INT NULL,
  review_due_date          DATE NULL,
  is_anonymous             TINYINT(1) NOT NULL DEFAULT 0,
  implementation_owner_id  INT NULL,
  implementation_target_date DATE NULL,
  implementation_status    ENUM('not_started','in_progress','completed','on_hold') NULL,
  roi_value                DECIMAL(15,2) NULL,
  roi_type                 ENUM('cost_saving','time_saving','quality_improvement','revenue_increase','other') NULL,
  roi_description          TEXT NULL,
  challenge_id             INT NULL,
  template_type            VARCHAR(50) NULL,
  points_awarded           INT DEFAULT 0,
  -- QCMS integration: approved ideas are pushed to the QCMS tool for implementation.
  qcms_pushed_at           DATETIME NULL DEFAULT NULL,
  qcms_push_status         VARCHAR(30) NULL DEFAULT NULL,
  qcms_push_message        VARCHAR(255) NULL DEFAULT NULL,
  status                   ENUM('Draft','Submitted','Under Review','Approved','Rejected','Implemented') DEFAULT 'Draft',
  submitter_id             INT NOT NULL,
  co_suggester_1_id       INT NULL,
  co_suggester_2_id       INT NULL,
  submitted_at             DATETIME NULL,
  created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (submitter_id)      REFERENCES users(id),
  FOREIGN KEY (co_suggester_1_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (co_suggester_2_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS idea_reviewers (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  idea_id      INT NOT NULL,
  reviewer_id  INT NOT NULL,
  decision     ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  comment      TEXT,
  decided_at   DATETIME NULL,
  assigned_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reviewer (idea_id, reviewer_id),
  FOREIGN KEY (idea_id)    REFERENCES ideas(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS idea_attachments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  idea_id     INT NOT NULL,
  section     ENUM('situation','solution','support','benefits') NOT NULL,
  filename    VARCHAR(255) NOT NULL,
  filepath    VARCHAR(500) NOT NULL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE
);

-- Co-suggesters beyond the two legacy ideas.co_suggester_*_id columns. An idea
-- can credit any number of colleagues; the first two are also mirrored into the
-- legacy columns so existing read paths keep working.
CREATE TABLE IF NOT EXISTS idea_co_suggesters (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  idea_id    INT NOT NULL,
  user_id    INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_idea_cosuggester (idea_id, user_id),
  KEY idx_cosuggester_idea (idea_id),
  FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS idea_workflow (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  idea_id    INT NOT NULL,
  actor_id   INT NOT NULL,
  action     ENUM('Submitted','Reviewed','Approved','Rejected','Implemented','Commented','Reopened') NOT NULL,
  comment    TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (idea_id)  REFERENCES ideas(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS idea_votes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  idea_id    INT NOT NULL,
  user_id    INT NOT NULL,
  rating     TINYINT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vote (idea_id, user_id),
  FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_rating CHECK (rating BETWEEN 1 AND 5)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  title      VARCHAR(255) NOT NULL,
  message    TEXT,
  idea_id    INT NULL DEFAULT NULL,
  is_read    TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS idea_community_votes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  idea_id    INT NOT NULL,
  user_id    INT NOT NULL,
  vote_type  ENUM('up','down') NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cv (idea_id, user_id),
  FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── Discussion threads (was schema_updates.sql only) ─────────────────
CREATE TABLE IF NOT EXISTS idea_comments (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  idea_id    INT NOT NULL,
  user_id    INT NOT NULL,
  parent_id  INT NULL,
  content    TEXT NOT NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (idea_id)   REFERENCES ideas(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)   REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES idea_comments(id) ON DELETE SET NULL
);

-- ── Innovation challenges (was schema_updates.sql only) ──────────────
CREATE TABLE IF NOT EXISTS challenges (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  description TEXT,
  created_by  INT NOT NULL,
  deadline    DATE NULL,
  status      ENUM('active','closed','draft') NOT NULL DEFAULT 'active',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- ── Idea categories (from migration 003) ─────────────────────────────
-- Every organisation owns its own list and may add to or delete from it.
-- ideas.impact_areas still stores the chosen names as comma-separated text, so
-- deleting a category never rewrites the ideas that were submitted under it.
CREATE TABLE IF NOT EXISTS idea_categories (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(80) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_idea_category_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO idea_categories (name, sort_order) VALUES
  ('Safety',       1),
  ('Quality',      2),
  ('Productivity', 3),
  ('Delivery',     4),
  ('Sustenance',   5);

-- ── Email queue (was schema_updates.sql only) ────────────────────────
CREATE TABLE IF NOT EXISTS email_queue (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  to_email   VARCHAR(150) NOT NULL,
  to_name    VARCHAR(100),
  subject    VARCHAR(255) NOT NULL,
  body       TEXT NOT NULL,
  status     ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  attempts   INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at    DATETIME NULL
);

CREATE OR REPLACE VIEW leaderboard AS
SELECT
  u.id, u.name, u.department, u.business_unit, u.points,
  COUNT(DISTINCT i.id)                                          AS idea_count,
  SUM(CASE WHEN i.status = 'Implemented' THEN 1 ELSE 0 END)    AS implemented_count,
  ROUND(AVG(CASE WHEN i.status != 'Draft' THEN i.ai_score ELSE NULL END), 1) AS avg_score
FROM users u
LEFT JOIN ideas i ON i.submitter_id = u.id AND i.status != 'Draft'
GROUP BY u.id
ORDER BY u.points DESC;

CREATE TABLE IF NOT EXISTS org_settings (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  key_name   VARCHAR(100) NOT NULL UNIQUE,
  value      TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO org_settings (key_name, value) VALUES
  ('review_sla_days',           '7'),
  ('escalation_days',           '14'),
  -- §14.8 removed anonymous submission. Kept as a setting, not ripped out:
  -- ideas already filed anonymously must keep that promise.
  ('anonymous_allowed',         '0'),
  ('public_board_enabled',      '1'),
  ('challenges_enabled',        '1'),
  ('email_enabled',             '0'),
  ('smtp_host',                 ''),
  ('smtp_port',                 '587'),
  ('smtp_user',                 ''),
  ('smtp_pass',                 ''),
  ('smtp_from',                 ''),
  ('smtp_from_name',            'Kalpion'),
  -- The approval chain, as one ordered sequence (migration 024). It replaced
  -- approval_mode / approval_reviewer_roles / approval_final_approver_roles /
  -- approval_threshold, which described this same chain three different ways
  -- and disagreed with each other.
  -- Migration 032: the default chain includes the team lead, and the labels
  -- are a per-tenant override so an organisation can call a stage whatever it
  -- calls it without the stored keys changing.
  ('approval_stages',           'originator,team_lead,immediate_manager,department_manager,plant_head'),
  ('approval_stage_labels',     '{}'),
  -- MOM 29 Jul 2026. solution_visibility replaces what used to be a constant in
  -- ideaService: authors_reviewers | managers_only | everyone.
  ('solution_visibility',       'authors_reviewers'),
  ('idea_tags_enabled',         '1'),
  ('patentability_enabled',     '1'),
  -- §14.10: voting is open to all; this governs the AI's written reasoning only.
  ('prediction_visibility',     'seniors'),
  -- §7.2: deterrents against casually copying idea text. Off by default.
  ('content_protection',        '0'),
  -- Each organisation sets its own attachment ceiling, bounded by the
  -- platform-wide maximum so one tenant cannot decide to accept 2 GB uploads.
  ('max_file_mb',               '10'),
  -- Deterrents on the screens that list ideas. On by default: idea text is the
  -- thing this product exists to protect.
  ('idea_screen_protection',    '1'),
  ('situation_preview_chars',   '180'),
  -- Which parts of somebody else's idea an ordinary colleague may read. See
  -- ideaSections.js for the vocabulary; empty means title only.
  ('employee_visible_sections', 'solution');

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  -- selector: from migration 001. Reset verification used to bcrypt-compare the
  -- candidate against every unexpired row — O(n) key-stretching per request.
  -- Tokens are `selector.verifier`: an indexed lookup, then one bcrypt compare.
  selector    CHAR(32) NULL,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  DATETIME NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_prt_selector (selector),
  INDEX idx_prt_expires (expires_at)
);

-- ── Bulk employee import (from migration 002) ────────────────────────
CREATE TABLE IF NOT EXISTS user_import_jobs (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  actor_id        INT NULL,
  actor_name      VARCHAR(100) NULL,
  filename        VARCHAR(255) NULL,
  status          ENUM('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
  phase           VARCHAR(24) NULL,
  total_rows      INT NOT NULL DEFAULT 0,
  processed_rows  INT NOT NULL DEFAULT 0,
  created_count   INT NOT NULL DEFAULT 0,
  -- ── from migration 031 ──
  -- An import sends welcome emails, and mail fails in ways an INSERT does not.
  -- Those accounts are created and valid, so the job must not report failure —
  -- but an admin still has to be able to find out that fifty people never got
  -- the password they are waiting for.
  emailed_count      INT NOT NULL DEFAULT 0,
  email_failed_count INT NOT NULL DEFAULT 0,
  skipped_count   INT NOT NULL DEFAULT 0,
  error_message   TEXT NULL,
  started_at      DATETIME NULL,
  finished_at     DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_import_status (status),
  INDEX idx_import_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_import_errors (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  job_id       INT NOT NULL,
  `row_number` INT NOT NULL,
  employee_id  VARCHAR(191) NULL,
  email        VARCHAR(191) NULL,
  message      VARCHAR(255) NOT NULL,
  FOREIGN KEY (job_id) REFERENCES user_import_jobs(id) ON DELETE CASCADE,
  INDEX idx_import_err_job (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Secondary indexes ────────────────────────────────────────────────────────
-- These were `CREATE INDEX IF NOT EXISTS`, which is MariaDB-only syntax: it runs
-- on a local XAMPP box and fails with a bare syntax error on real MySQL 8 (any
-- managed host). The guarded form below is the same idiom migration 001 uses,
-- is idempotent on both engines, and keeps this file re-runnable as a repair
-- tool for a half-built schema.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND INDEX_NAME = 'idx_ideas_status') = 0,
  'CREATE INDEX idx_ideas_status ON ideas(status)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND INDEX_NAME = 'idx_ideas_submitted_at') = 0,
  'CREATE INDEX idx_ideas_submitted_at ON ideas(submitted_at)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND INDEX_NAME = 'idx_ideas_submitter_status') = 0,
  'CREATE INDEX idx_ideas_submitter_status ON ideas(submitter_id, status)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND INDEX_NAME = 'idx_ideas_current_reviewer') = 0,
  'CREATE INDEX idx_ideas_current_reviewer ON ideas(current_reviewer_id)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
-- The review queue asks "which ideas are waiting at my stage" on every load.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND INDEX_NAME = 'idx_ideas_current_stage') = 0,
  'CREATE INDEX idx_ideas_current_stage ON ideas(current_stage, status)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications'
       AND INDEX_NAME = 'idx_notifications_user_read') = 0,
  'CREATE INDEX idx_notifications_user_read ON notifications(user_id, is_read)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'idea_votes'
       AND INDEX_NAME = 'idx_idea_votes_idea') = 0,
  'CREATE INDEX idx_idea_votes_idea ON idea_votes(idea_id)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'idea_community_votes'
       AND INDEX_NAME = 'idx_idea_community_votes_idea') = 0,
  'CREATE INDEX idx_idea_community_votes_idea ON idea_community_votes(idea_id)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'idea_comments'
       AND INDEX_NAME = 'idx_idea_comments_idea') = 0,
  'CREATE INDEX idx_idea_comments_idea ON idea_comments(idea_id)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'idea_workflow'
       AND INDEX_NAME = 'idx_idea_workflow_idea') = 0,
  'CREATE INDEX idx_idea_workflow_idea ON idea_workflow(idea_id)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'idea_reviewers'
       AND INDEX_NAME = 'idx_idea_reviewers_idea_reviewer') = 0,
  'CREATE INDEX idx_idea_reviewers_idea_reviewer ON idea_reviewers(idea_id, reviewer_id)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'password_reset_tokens'
       AND INDEX_NAME = 'idx_password_reset_tokens_user') = 0,
  'CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens(user_id)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
-- from migration 001
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND INDEX_NAME = 'idx_ideas_status_submitted') = 0,
  'CREATE INDEX idx_ideas_status_submitted ON ideas(status, submitted_at)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND INDEX_NAME = 'idx_ideas_submitter') = 0,
  'CREATE INDEX idx_ideas_submitter ON ideas(submitter_id)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
-- The ideas list orders by updated_at DESC (LIMIT 100). Without this the query
-- full-scans + filesorts every request; under load that caused 500s. With it the
-- optimiser reads the index in order and stops at 100 rows (verified by EXPLAIN).
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND INDEX_NAME = 'idx_ideas_updated_at') = 0,
  'CREATE INDEX idx_ideas_updated_at ON ideas(updated_at)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND INDEX_NAME = 'idx_ideas_archived') = 0,
  'CREATE INDEX idx_ideas_archived ON ideas(archived_at)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

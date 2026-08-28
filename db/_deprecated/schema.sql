-- ============================================================
--  IFQM Per-Tenant Schema Template (no seed data)
--  Run this against a new tenant database.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  employee_id     VARCHAR(20)  NOT NULL UNIQUE,
  name            VARCHAR(100) NOT NULL,
  email           VARCHAR(150) NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  phone           VARCHAR(20),
  department      VARCHAR(100),
  business_unit   VARCHAR(100),
  location        VARCHAR(100),
  role            ENUM('trainee','employee','team_lead','project_lead','manager','senior_manager','executive','admin','super_admin') NOT NULL DEFAULT 'employee',
  manager_id      INT NULL,
  points          INT NOT NULL DEFAULT 0,
  avatar_initials VARCHAR(4),
  status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
  -- Any JWT issued before this moment is rejected, so a password reset
  -- actually terminates sessions opened with the old password.
  password_changed_at DATETIME NULL DEFAULT NULL,
  deactivated_at  DATETIME NULL DEFAULT NULL,
  -- Bulk-imported employees start with a derived temporary password and must
  -- replace it before they can use anything (enforced in the auth middleware).
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  date_of_birth   DATE NULL DEFAULT NULL,
  activated_at    DATETIME NULL DEFAULT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_users_email_status (email, status),
  INDEX idx_users_name (name),
  INDEX idx_users_manager (manager_id)
);

-- ── Bulk employee import ────────────────────────────────────────────────────
-- A 10,000-row import cannot run inside an HTTP request, so it runs as a
-- background job and the UI polls it. The job row doubles as the audit record
-- of a privileged action (who mass-created accounts, when, and how many).
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
  skipped_count   INT NOT NULL DEFAULT 0,
  error_message   TEXT NULL,
  started_at      DATETIME NULL,
  finished_at     DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_import_status (status),
  INDEX idx_import_created (created_at)
);

CREATE TABLE IF NOT EXISTS user_import_errors (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  job_id       INT NOT NULL,
  `row_number` INT NOT NULL,
  employee_id  VARCHAR(191) NULL,
  email        VARCHAR(191) NULL,
  message      VARCHAR(255) NOT NULL,
  FOREIGN KEY (job_id) REFERENCES user_import_jobs(id) ON DELETE CASCADE,
  INDEX idx_import_err_job (job_id)
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
  ai_score                 INT DEFAULT 0,
  ai_reason                TEXT,
  workflow_type            ENUM('hierarchical','multi_reviewer') NOT NULL DEFAULT 'hierarchical',
  approval_threshold       TINYINT NOT NULL DEFAULT 100,
  upvotes                  INT NOT NULL DEFAULT 0,
  downvotes                INT NOT NULL DEFAULT 0,
  escalation_level         INT NOT NULL DEFAULT 0,
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
  section     ENUM('situation','solution') NOT NULL,
  filename    VARCHAR(255) NOT NULL,
  filepath    VARCHAR(500) NOT NULL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE
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

-- ── Org Settings ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_settings (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  key_name   VARCHAR(100) NOT NULL UNIQUE,
  value      TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO org_settings (key_name, value) VALUES
  ('review_sla_days',           '7'),
  ('escalation_days',           '14'),
  ('anonymous_allowed',         '1'),
  ('public_board_enabled',      '1'),
  ('challenges_enabled',        '1'),
  ('email_enabled',             '0'),
  ('smtp_host',                 ''),
  ('smtp_port',                 '587'),
  ('smtp_user',                 ''),
  ('smtp_pass',                 ''),
  ('smtp_from',                 ''),
  ('smtp_from_name',            'Kalpion'),
  ('approval_mode',             'default'),
  ('approval_reviewer_roles',   'team_lead,project_lead,manager,senior_manager'),
  ('approval_final_approver_roles', 'executive,admin,super_admin'),
  ('approval_threshold',        '100');

-- ── Password Reset Tokens ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  -- Tokens are <selector>.<verifier>. The selector is an indexed lookup so
  -- verification runs exactly one bcrypt compare instead of one per row.
  selector    CHAR(32) NOT NULL,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  DATETIME NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE INDEX uniq_prt_selector (selector),
  INDEX idx_prt_expires (expires_at)
);

-- ── Performance Indexes (idempotent — MariaDB supports IF NOT EXISTS) ──
CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
CREATE INDEX IF NOT EXISTS idx_ideas_submitted_at ON ideas(submitted_at);
CREATE INDEX IF NOT EXISTS idx_ideas_submitter_status ON ideas(submitter_id, status);
CREATE INDEX IF NOT EXISTS idx_ideas_current_reviewer ON ideas(current_reviewer_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_idea_votes_idea ON idea_votes(idea_id);
CREATE INDEX IF NOT EXISTS idx_idea_community_votes_idea ON idea_community_votes(idea_id);
CREATE INDEX IF NOT EXISTS idx_idea_comments_idea ON idea_comments(idea_id);
CREATE INDEX IF NOT EXISTS idx_idea_workflow_idea ON idea_workflow(idea_id);
CREATE INDEX IF NOT EXISTS idx_idea_reviewers_idea_reviewer ON idea_reviewers(idea_id, reviewer_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);

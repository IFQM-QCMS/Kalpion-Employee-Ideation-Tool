-- ============================================================
--  DEPRECATED — do not use this file to provision a machine.
--
--  It aborted on import for months (a type-less `user_id` column at what was
--  line 111) — meaning nobody had successfully used it — and it predates the
--  columns migrations 001/002 added, which auth reads on every request. The
--  column is fixed so the file at least imports, but the canonical sources are:
--
--    db/master.sql                     the registry (ifqm_master)
--    backend/schema/tenant_schema.sql  one complete tenant schema
--    npm run setup (backend/)          builds all of it in one command
-- ============================================================

-- ============================================================
--  IFQM Employee Ideation Tool – Database Schema
--  9-role system: trainee, employee, team_lead, project_lead,
--  manager, senior_manager, executive, admin, super_admin
-- ============================================================

CREATE DATABASE IF NOT EXISTS ifqm_ideation CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ifqm_ideation;

-- ── Users / Employees ─────────────────────────────────────────
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
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ── Ideas ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ideas (
  id                        INT AUTO_INCREMENT PRIMARY KEY,
  idea_code                 VARCHAR(20)  NOT NULL UNIQUE,
  title                     VARCHAR(255) NOT NULL,
  present_situation         TEXT NOT NULL,
  proposed_solution         TEXT NOT NULL,
  impact_areas              VARCHAR(255),
  impact_level              ENUM('Low','Medium','High') DEFAULT 'Medium',
  tangible_benefit          TEXT,
  intangible_benefit        TEXT,
  ai_score                  INT DEFAULT 0,
  ai_reason                 TEXT,
  workflow_type             ENUM('hierarchical','multi_reviewer') NOT NULL DEFAULT 'hierarchical',
  approval_threshold        TINYINT NOT NULL DEFAULT 100,
  upvotes                   INT NOT NULL DEFAULT 0,
  downvotes                 INT NOT NULL DEFAULT 0,
  escalation_level          INT NOT NULL DEFAULT 0,
  current_reviewer_id       INT NULL,
  review_due_date           DATE NULL,
  is_anonymous              TINYINT(1) NOT NULL DEFAULT 0,
  implementation_owner_id   INT NULL,
  implementation_target_date DATE NULL,
  implementation_status     ENUM('not_started','in_progress','completed','on_hold') NULL,
  roi_value                 DECIMAL(15,2) NULL,
  roi_type                  ENUM('cost_saving','time_saving','quality_improvement','revenue_increase','other') NULL,
  roi_description           TEXT NULL,
  challenge_id              INT NULL,
  template_type             VARCHAR(50) NULL,
  points_awarded            INT DEFAULT 0,
  status                    ENUM('Draft','Submitted','Under Review','Approved','Rejected','Implemented') DEFAULT 'Draft',
  submitter_id              INT NOT NULL,
  co_suggester_1_id         INT NULL,
  co_suggester_2_id         INT NULL,
  submitted_at              DATETIME NULL,
  created_at                DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (submitter_id)      REFERENCES users(id),
  FOREIGN KEY (co_suggester_1_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (co_suggester_2_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ── Idea Attachments ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS idea_attachments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  idea_id     INT NOT NULL,
  section     ENUM('situation','solution') NOT NULL,
  filename    VARCHAR(255) NOT NULL,
  filepath    VARCHAR(500) NOT NULL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE
);

-- ── Idea Reviewers (multi-reviewer workflow) ──────────────────
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

-- ── Approval Workflow Log ─────────────────────────────────────
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

-- ── Idea Votes (1-5 star rating) ────────────────────────────────
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

-- ── Community Votes (upvote / downvote) ───────────────────────
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

-- ── Notifications ─────────────────────────────────────────────
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

-- ── Idea Comments ─────────────────────────────────────────────
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

-- ── Challenges ─────────────────────────────────────────────────
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

-- ── Org Settings ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_settings (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  key_name   VARCHAR(100) NOT NULL UNIQUE,
  value      TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ── Email Queue ────────────────────────────────────────────────
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

-- ── Leaderboard View ──────────────────────────────────────────
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

-- ============================================================
-- SEED DATA
-- All passwords = "password"
-- Fresh start — no users. Create your first org via platform admin.
-- ============================================================

-- ── Approval Workflow Defaults ─────────────────────────────────────────
-- approval_mode: 'default' = platform hardcoded logic, 'custom' = use stored roles
INSERT INTO org_settings (key_name, value) VALUES ('approval_mode', 'default') ON DUPLICATE KEY UPDATE value=value;
INSERT INTO org_settings (key_name, value) VALUES ('approval_reviewer_roles', 'team_lead,project_lead,manager,senior_manager') ON DUPLICATE KEY UPDATE value=value;
INSERT INTO org_settings (key_name, value) VALUES ('approval_final_approver_roles', 'executive,admin,super_admin') ON DUPLICATE KEY UPDATE value=value;
INSERT INTO org_settings (key_name, value) VALUES ('approval_threshold', '100') ON DUPLICATE KEY UPDATE value=value;

-- ── Password Reset Tokens ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  DATETIME NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
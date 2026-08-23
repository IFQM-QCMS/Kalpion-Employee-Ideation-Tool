-- ============================================================
--  IFQM Cleanup Script
--  Wipes all sample data from ifqm_ideation.
--  Run this ONCE before deploying to production.
--  Keeps schema intact; deletes all rows.
-- ============================================================

USE ifqm_ideation;

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE idea_community_votes;
TRUNCATE TABLE idea_votes;
TRUNCATE TABLE notifications;
TRUNCATE TABLE idea_reviewers;
TRUNCATE TABLE idea_workflow;
TRUNCATE TABLE idea_attachments;
TRUNCATE TABLE ideas;
TRUNCATE TABLE users;

-- Add status column if not already present (idempotent)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status ENUM('active','inactive') NOT NULL DEFAULT 'active';

-- Expand role ENUM to include full hierarchy
ALTER TABLE users
  MODIFY COLUMN role ENUM('trainee','employee','team_lead','project_lead','manager','senior_manager','executive','admin','super_admin') NOT NULL DEFAULT 'employee';

-- Add upvotes/downvotes columns if not already present
ALTER TABLE ideas
  ADD COLUMN IF NOT EXISTS upvotes   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS downvotes INT NOT NULL DEFAULT 0;

-- Add community votes table if missing
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

SET FOREIGN_KEY_CHECKS = 1;

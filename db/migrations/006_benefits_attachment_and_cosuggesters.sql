-- ─────────────────────────────────────────────────────────────────────────────
--  Migration 006 — Benefits-Expected attachment + more than two co-suggesters
--                  (per-TENANT database)
--
--    mysql -u root -p ifqm_<slug> < db/migrations/006_benefits_attachment_and_cosuggesters.sql
--
--  Idempotent: safe to re-run.
--
--  1. idea_attachments.section gains 'benefits' — a document can now be attached
--     under Business Case → Benefits Expected, alongside situation/solution/support.
--     Appended at the END of the ENUM (ordinals of existing rows are preserved).
--
--  2. idea_co_suggesters — an idea could name at most two co-suggesters, held in
--     ideas.co_suggester_1_id / _2_id. This junction table lifts that cap: an idea
--     can now credit any number of colleagues. The two legacy columns are kept in
--     step (the first two co-suggesters still land there) so every existing read
--     path keeps working; the full list lives here.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. 'benefits' attachment section ─────────────────────────────────
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'idea_attachments'
       AND COLUMN_NAME = 'section' AND COLUMN_TYPE LIKE '%benefits%') = 0,
  'ALTER TABLE idea_attachments MODIFY COLUMN section ENUM(''situation'',''solution'',''support'',''benefits'') NOT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── 2. Co-suggesters junction table ──────────────────────────────────
CREATE TABLE IF NOT EXISTS idea_co_suggesters (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  idea_id    INT NOT NULL,
  user_id    INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_idea_cosuggester (idea_id, user_id),
  KEY idx_cosuggester_idea (idea_id),
  FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Back-fill the junction from the two legacy columns for existing ideas.
INSERT IGNORE INTO idea_co_suggesters (idea_id, user_id)
  SELECT id, co_suggester_1_id FROM ideas WHERE co_suggester_1_id IS NOT NULL;
INSERT IGNORE INTO idea_co_suggesters (idea_id, user_id)
  SELECT id, co_suggester_2_id FROM ideas WHERE co_suggester_2_id IS NOT NULL;

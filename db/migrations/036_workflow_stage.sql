-- ============================================================================
--  036  Record WHICH STAGE an approval was given at, on the approval itself
--
--    mysql -u root -p <tenant_db> < db/migrations/036_workflow_stage.sql
--
--  Runs against every tenant database (no _master suffix) — idea_workflow is a
--  tenant table.
--
--  ── Why the role on the user row is not good enough ────────────────────────
--
--  The closure PDF has to say who signed an idea off and in what capacity:
--  "employee submitted, team lead approved and passed it to the immediate
--  manager", and so on down the chain. Until now the only way to answer "in
--  what capacity" was to join users and read `role` — which answers a
--  different question. It says what that person's job is TODAY.
--
--  Somebody promoted from team lead to plant head in March would silently
--  rewrite every approval they gave in January: the PDF would show a plant head
--  approving at step one, three stages before a plant head is supposed to touch
--  anything, and the document would be describing a chain that never happened.
--  On an audit record that is not a cosmetic problem. It is the record being
--  wrong.
--
--  So the stage is written at the moment of the decision and never derived
--  again. A stage KEY, not a label: an organisation can rename "Team Lead" to
--  "Shift Incharge" whenever it likes, and renaming a stage must not rewrite
--  history either — the label is resolved for display, the key is what happened.
--
--  ── Existing rows ──────────────────────────────────────────────────────────
--
--  Left NULL, deliberately. There is no honest way to recover the stage an old
--  approval was given at: the chain may have changed since, and the approver's
--  role may have too, so any back-fill would be a guess printed as a fact. The
--  PDF falls back to the actor's current role for those rows and marks them as
--  inferred rather than recorded.
-- ============================================================================

-- Aiven's default sql_mode includes ANSI_QUOTES, under which "..." is an
-- identifier rather than a string. The guarded statements below build SQL as
-- text and would be read as column names there. Dropped for this session only.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'idea_workflow'
                    AND COLUMN_NAME = 'stage');

SET @sql := IF(@has_col = 0,
  'ALTER TABLE idea_workflow
     ADD COLUMN stage VARCHAR(40) NULL COMMENT ''Approval stage key this action was taken at''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The submitter's entry is the one case that CAN be recovered without guessing:
-- 'Submitted' is always the originator stage, whatever the chain looks like and
-- whatever role the author holds now. Everything else stays NULL.
SET @sql := IF(@has_col = 0,
  'UPDATE idea_workflow SET stage = ''originator''
    WHERE action = ''Submitted'' AND stage IS NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── The queue reads current_reviewer_id now, so it has to be indexed ────────
-- Ideas are routed to a named person rather than offered to a whole role, which
-- turns "what is waiting on me" into a lookup on this column. Without the index
-- it is a full scan of every open idea on every load of the review queue.
SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
                  WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'ideas'
                    AND INDEX_NAME = 'idx_ideas_reviewer_stage');

SET @sql := IF(@has_idx = 0,
  'CREATE INDEX idx_ideas_reviewer_stage ON ideas (current_reviewer_id, current_stage, status)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 036 Record WHICH STAGE an approval was given at, on the approval itself

-- Aiven's default sql_mode includes ANSI_QUOTES, under which "..." is an identifier rather
-- than a string.
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
-- 'Submitted' is always the originator stage, whatever the chain looks like and whatever
-- role the author holds now.
SET @sql := IF(@has_col = 0,
  'UPDATE idea_workflow SET stage = ''originator''
    WHERE action = ''Submitted'' AND stage IS NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The queue reads current_reviewer_id now, so it has to be indexed Ideas are routed to a
-- named person rather than offered to a whole role, which turns "what is waiting on me"
-- into a lookup on this column.
SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
                  WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'ideas'
                    AND INDEX_NAME = 'idx_ideas_reviewer_stage');

SET @sql := IF(@has_idx = 0,
  'CREATE INDEX idx_ideas_reviewer_stage ON ideas (current_reviewer_id, current_stage, status)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

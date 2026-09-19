-- 043 Send back for improvement, forward past the final stage, undo a rejection

-- Some managed MySQL services enable ANSI_QUOTES, under which "..." is an identifier rather
-- than a string.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

-- An approver can now hand an idea back to its author for changes instead of rejecting it.
-- The idea returns to Draft; these four columns say who sent it back, from which stage, and
-- why, so the author sees the request and the resubmission re-enters the chain at the stage
-- that asked - not at the beginning.
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
                    AND COLUMN_NAME = 'returned_at');
SET @sql := IF(@has_col = 0,
  'ALTER TABLE ideas
     ADD COLUMN returned_at DATETIME NULL,
     ADD COLUMN returned_by INT NULL,
     ADD COLUMN returned_stage VARCHAR(40) NULL,
     ADD COLUMN return_reason TEXT NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The final approver can approve AND forward to a further role (executive, project lead,
-- ...) instead of closing. Those extra stages belong to the one idea, not to the
-- organisation's chain, and are appended to it for that idea only. Comma-separated stage
-- keys from the stage catalogue, in the order they were added.
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
                    AND COLUMN_NAME = 'forward_stages');
SET @sql := IF(@has_col = 0,
  'ALTER TABLE ideas ADD COLUMN forward_stages VARCHAR(255) NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Two new things the trail can record. 'Reopened' already existed and is what undoing a
-- rejection writes.
ALTER TABLE idea_workflow
  MODIFY COLUMN action ENUM('Submitted','Reviewed','Approved','Rejected','Implemented',
                            'Commented','Reopened','Returned','Resubmitted') NOT NULL;

-- 044 One record of who raised an idea jointly, instead of two that disagree

-- Some managed MySQL services enable ANSI_QUOTES, under which "..." is an identifier rather
-- than a string.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

/*
 * An idea's co-suggesters were held in two places at once: idea_co_suggesters, which holds
 * all of them, and ideas.co_suggester_1_id / _2_id, which hold only the first two. Anything
 * reading the pair silently lost the third person onward - which is why a third co-suggester
 * could not export their own idea and did not appear in the rewards register.
 *
 * The table becomes the single record. Anything the two columns hold that the table does not
 * is copied across first, so nothing is lost from an idea written before the table existed;
 * then the columns go, so that no future query can read a half-answer from them.
 */

-- Copy across anything the columns know that the table does not. INSERT IGNORE leans on the
-- unique key, so re-running this changes nothing.
INSERT IGNORE INTO idea_co_suggesters (idea_id, user_id)
SELECT i.id, i.co_suggester_1_id FROM ideas i
 WHERE i.co_suggester_1_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM users u WHERE u.id = i.co_suggester_1_id);

INSERT IGNORE INTO idea_co_suggesters (idea_id, user_id)
SELECT i.id, i.co_suggester_2_id FROM ideas i
 WHERE i.co_suggester_2_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM users u WHERE u.id = i.co_suggester_2_id);

-- Now drop them. Guarded so the migration is safe to re-run, and the foreign keys that name
-- the columns have to go first.
SET @fk1 := (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
                AND COLUMN_NAME = 'co_suggester_1_id' AND REFERENCED_TABLE_NAME IS NOT NULL
              LIMIT 1);
SET @sql := IF(@fk1 IS NULL, 'SELECT 1', CONCAT('ALTER TABLE ideas DROP FOREIGN KEY `', @fk1, '`'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @fk2 := (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
                AND COLUMN_NAME = 'co_suggester_2_id' AND REFERENCED_TABLE_NAME IS NOT NULL
              LIMIT 1);
SET @sql := IF(@fk2 IS NULL, 'SELECT 1', CONCAT('ALTER TABLE ideas DROP FOREIGN KEY `', @fk2, '`'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has1 := (SELECT COUNT(*) FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
                 AND COLUMN_NAME = 'co_suggester_1_id');
SET @sql := IF(@has1 = 0, 'SELECT 1', 'ALTER TABLE ideas DROP COLUMN co_suggester_1_id');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has2 := (SELECT COUNT(*) FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
                 AND COLUMN_NAME = 'co_suggester_2_id');
SET @sql := IF(@has2 = 0, 'SELECT 1', 'ALTER TABLE ideas DROP COLUMN co_suggester_2_id');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

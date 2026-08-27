-- ============================================================================
--  032  An idea remembers which approval stage it is waiting at
--
--    FOR EACH TENANT DATABASE:
--      mysql -u root -p ifqm_<slug> < db/migrations/032_sequential_approval_chain.sql
--
--  Tenant databases only.
--
--  ── The bug this exists to fix ─────────────────────────────────────────────
--
--  The approval chain was stored as an ordered list of stages, and the engine
--  ignored the order. Approving walked the REPORTING TREE instead: it looked up
--  the approver's own manager_id, escalated to them if their role happened to
--  appear anywhere in the chain, and otherwise fell through to Approved.
--
--  So an organisation whose chain read
--
--      originator -> team lead -> immediate manager -> department manager -> plant head
--
--  did not get that journey. A team lead with no manager on file, or whose
--  manager was a department manager, either approved the idea outright or
--  skipped two stages. Since the QCMS push is gated on status = 'Approved',
--  a single team-lead approval could also make an idea eligible to be pushed to
--  the external quality system.
--
--  Fixing it needs one thing the row did not carry: WHERE the idea is. The
--  chain is a list, so an idea travelling along it has a position, and without
--  storing that position the engine has to guess — which is what walking
--  manager_id was.
--
--  ── ideas.current_stage ────────────────────────────────────────────────────
--
--  The stage KEY the idea is waiting at ('team_lead', 'plant_head', ...), or
--  NULL for a draft, a closed idea, or a committee (multi_reviewer) idea, none
--  of which travel the chain.
--
--  The key, not an index. An administrator may reorder or remove stages while
--  ideas are in flight; a stored index would silently point at a different
--  stage after any edit, and an idea would appear to have been approved at a
--  step nobody approved it at. A key that has been removed from the chain is
--  recoverable — approvalStages.nextStage() finds what would have come after it
--  — and a key is readable in the database, which an index is not.
--
--  ── Back-filling ideas that are already in flight ──────────────────────────
--
--  Anything Submitted or Under Review needs a starting position, and the honest
--  one is the FIRST approver stage. Two reasons it is not something cleverer:
--
--  1. There is no record of which stage a past approval was given at. The
--     workflow log has "Approved" rows with an escalation level, and escalation
--     level was a count of manager_id hops, not a position in the chain — the
--     two are different numbers and one cannot be derived from the other.
--
--  2. If the guess is wrong, being wrong EARLY is recoverable and being wrong
--     LATE is not. Restarting an idea at stage one costs an approver a second
--     click. Placing it at the final stage would hand it to the plant head as
--     though four people had already agreed, which is the exact failure this
--     migration exists to end.
--
--  Approved, Rejected and Implemented ideas are left NULL: they have finished
--  travelling and nothing should put them back on the chain.
--
--  ── org_settings.approval_stage_labels ─────────────────────────────────────
--
--  Not every organisation calls the person a "Team Lead". The label is now a
--  per-tenant override, stored as JSON keyed by stage, so the name on screen can
--  change without rewriting the stage keys stored on every idea and in every
--  settings row.
-- ============================================================================

-- ── Portability note ────────────────────────────────────────────────────────
-- Some MySQL deployments (Aiven's default among them) run with ANSI_QUOTES, in
-- which "..." is an IDENTIFIER, not a string. The guarded statements below build
-- SQL as text and would be read as column names there — the failure looks like
-- `Unknown column 'ALTER TABLE ...'`, which is baffling until you know why.
-- Dropped for this session only, so the file parses identically everywhere.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @is_tenant := (SELECT COUNT(*) FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas');

-- ── ideas.current_stage ─────────────────────────────────────────────────────

SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
                   AND COLUMN_NAME = 'current_stage') = 0,
  'ALTER TABLE ideas ADD COLUMN current_stage VARCHAR(40) NULL DEFAULT NULL AFTER escalation_level',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The review queue asks "which ideas are waiting at my stage" on every load.
SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
                   AND INDEX_NAME = 'idx_ideas_current_stage') = 0,
  'CREATE INDEX idx_ideas_current_stage ON ideas(current_stage, status)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── Back-fill ideas that are mid-flight ─────────────────────────────────────
--
-- The first approver stage of THIS tenant's own chain, read from its own
-- settings. A tenant that has stored nothing gets the platform default, which
-- is what the engine would fall back to anyway.

SET @first_stage := NULL;

SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_settings') > 0,
  'SELECT TRIM(SUBSTRING_INDEX(
       TRIM(BOTH '','' FROM REPLACE(REPLACE(value, ''originator,'', ''''), '' '', '''')),
       '','', 1))
     INTO @first_stage
     FROM org_settings WHERE key_name = ''approval_stages'' LIMIT 1',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @first_stage := IFNULL(NULLIF(@first_stage, ''), 'team_lead');

SET @sql := IF(@is_tenant > 0,
  'UPDATE ideas SET current_stage = ?
     WHERE status IN (''Submitted'', ''Under Review'')
       AND current_stage IS NULL
       AND (workflow_type IS NULL OR workflow_type = ''hierarchical'')',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s USING @first_stage; DEALLOCATE PREPARE s;

-- ── The default chain gains team_lead ───────────────────────────────────────
--
-- A tenant that never edited its chain is on the platform default, which did
-- not include the team lead. The default is now
--   originator, team_lead, immediate_manager, department_manager, plant_head
-- and a tenant still sitting on the OLD default is moved to the new one.
--
-- Matched exactly, so an organisation that customised its chain — even to
-- something that merely resembles the old default — is left alone. Their chain
-- is their decision.

SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_settings') > 0,
  'UPDATE org_settings
      SET value = ''originator,team_lead,immediate_manager,department_manager,plant_head''
    WHERE key_name = ''approval_stages''
      AND REPLACE(value, '' '', '''') = ''originator,immediate_manager,department_manager,plant_head''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- And a tenant with no row at all gets one, so the settings screen opens on the
-- truth rather than on an empty control that implies no chain exists.
SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_settings') > 0,
  'INSERT INTO org_settings (key_name, value)
     VALUES (''approval_stages'', ''originator,team_lead,immediate_manager,department_manager,plant_head'')
     ON DUPLICATE KEY UPDATE value = value',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── Custom stage names ──────────────────────────────────────────────────────
-- Empty JSON object: no overrides, every stage shows its built-in name.

SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_settings') > 0,
  'INSERT INTO org_settings (key_name, value)
     VALUES (''approval_stage_labels'', ''{}'')
     ON DUPLICATE KEY UPDATE value = value',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── The approval threshold is gone ──────────────────────────────────────────
--
-- Migration 024 removed the settings keys; this removes the last of it. The
-- per-idea snapshot column is dropped rather than kept, because unlike a birth
-- date it holds no record of anything a customer might later ask for: it was a
-- copy of a setting that no longer exists, read by code that no longer exists.

SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
                   AND COLUMN_NAME = 'approval_threshold') > 0,
  'ALTER TABLE ideas DROP COLUMN approval_threshold',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@is_tenant > 0 AND (SELECT COUNT(*) FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_settings') > 0,
  'DELETE FROM org_settings WHERE key_name = ''approval_threshold''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

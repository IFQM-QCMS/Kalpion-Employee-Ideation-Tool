-- ─────────────────────────────────────────────────────────────────────────────
--  Migration 007 — QCMS push tracking on ideas (per-TENANT database)
--
--    mysql -u root -p ifqm_<slug> < db/migrations/007_qcms_push_tracking.sql
--
--  Idempotent: safe to re-run.
--
--  Approved ideas are pushed from Kalpion into the QCMS tool for
--  implementation. These columns record, per idea, whether it has been pushed,
--  when, and the outcome — so the org admin's "Approved Ideas" screen can show a
--  push status and avoid pushing the same idea twice (QCMS also de-dupes on
--  ideaCode and returns 409, which we record as 'duplicate').
--
--    qcms_push_status : NULL (not pushed) | 'imported' | 'duplicate' | 'failed'
-- ─────────────────────────────────────────────────────────────────────────────

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'qcms_pushed_at') = 0,
  'ALTER TABLE ideas ADD COLUMN qcms_pushed_at DATETIME NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'qcms_push_status') = 0,
  'ALTER TABLE ideas ADD COLUMN qcms_push_status VARCHAR(30) NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ideas'
       AND COLUMN_NAME = 'qcms_push_message') = 0,
  'ALTER TABLE ideas ADD COLUMN qcms_push_message VARCHAR(255) NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

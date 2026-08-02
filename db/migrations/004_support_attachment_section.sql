-- ─────────────────────────────────────────────────────────────────────────────
--  Migration 004 — Allow a "support" attachment section (per-TENANT database)
--
--    mysql -u root -p ifqm_<slug> < db/migrations/004_support_attachment_section.sql
--
--  Idempotent: safe to re-run.
--
--  The submission wizard could attach a document to the Situation or the
--  Solution only. Employees also need to attach the document(s) that back up the
--  "Support Required" they describe on the business-case step (a quote, a spec,
--  an approval note). idea_attachments.section was ENUM('situation','solution');
--  a third member 'support' is appended.
--
--  Appended at the END of the ENUM on purpose: MySQL/MariaDB stores an ENUM as
--  the ordinal of its member, so inserting a member in the middle would renumber
--  everything after it and silently relabel existing rows. Appending cannot.
-- ─────────────────────────────────────────────────────────────────────────────

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'idea_attachments'
       AND COLUMN_NAME = 'section' AND COLUMN_TYPE LIKE '%support%') = 0,
  'ALTER TABLE idea_attachments MODIFY COLUMN section ENUM(''situation'',''solution'',''support'') NOT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

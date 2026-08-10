-- ─────────────────────────────────────────────────────────────────────────────
--  Migration 014 — what an ordinary colleague may read on somebody else's idea
--
--    mysql -u root -p ifqm_<slug> < db/migrations/014_section_visibility.sql
--
--  Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- A comma-separated allowlist of sections. Empty string means "nothing beyond
-- the title"; absent means the built-in default, which is the same 'solution'
-- seeded here.
--
-- The title, code, status, department, impact and score are never governed by
-- this. They are what makes an idea findable and what the leaderboard counts;
-- hiding them would leave a list of blank rows rather than a shorter one.
--
-- Recognised names, and what each one covers:
--   situation      the extract of the problem statement
--   solution       the one-line gist of the proposal
--   benefits       tangible and intangible benefit text
--   business_case  investment, feasibility, timeline, recorded return
--   attachments    the files
--   comments       the discussion thread
--   co_suggesters  who raised the idea with them
--   timeline       the approval history
--
-- INSERT IGNORE, so an organisation that has already chosen its own list is
-- left exactly as it is.
INSERT IGNORE INTO org_settings (key_name, value) VALUES
  ('employee_visible_sections', 'solution');

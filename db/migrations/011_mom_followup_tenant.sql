-- ─────────────────────────────────────────────────────────────────────────────
--  Migration 011 — MOM 29 Jul 2026 follow-up, per-TENANT
--
--    mysql -u root -p ifqm_<slug> < db/migrations/011_mom_followup_tenant.sql
--
--  Idempotent: safe to re-run.
--  Covers §14.10 (who may read the AI's assessment) and §7.2 (content
--  protection), both as organisation settings rather than hard-coded rules.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT IGNORE INTO org_settings (key_name, value) VALUES
  -- §14.10. Voting stays open to everyone; this governs the AI's written
  -- reasoning only. The minutes say "confirm scope", so the default is the
  -- cautious reading and an organisation can widen it without a code change.
  ('prediction_visibility', 'seniors'),
  -- §7.2. Deterrents against casually copying an idea's text: right-click,
  -- text selection and drag are suppressed on idea content, and a watermark
  -- carrying the reader's name is shown. Off by default — see the note in
  -- docs/TECHNICAL_MANUAL.md about what this can and cannot do.
  ('content_protection', '0');

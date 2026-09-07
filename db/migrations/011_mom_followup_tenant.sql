-- Migration 011 - MOM 29 Jul 2026 follow-up, per-TENANT

INSERT IGNORE INTO org_settings (key_name, value) VALUES
  -- §14.10. Voting stays open to everyone; this governs the AI's written reasoning only.
  ('prediction_visibility', 'seniors'),
  -- §7.2. Deterrents against casually copying an idea's text: right-click, text selection
  -- and drag are suppressed on idea content, and a watermark carrying the reader's name is
  -- shown.
  ('content_protection', '0');

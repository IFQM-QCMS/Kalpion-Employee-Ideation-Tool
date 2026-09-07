-- Migration 014 - what an ordinary colleague may read on somebody else's idea

-- A comma-separated allowlist of sections.
INSERT IGNORE INTO org_settings (key_name, value) VALUES
  ('employee_visible_sections', 'solution');

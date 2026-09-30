-- 045 Business Case and Co-Suggesters become steps an org admin may switch on

-- Off by default: the submission wizard now runs four steps everywhere unless an
-- organisation's own admin opts back into either one, on the Settings tab. That opt-in
-- applies to that tenant alone; no other organisation is affected.
INSERT IGNORE INTO org_settings (key_name, value) VALUES
  ('business_case_enabled', '0'),
  ('co_suggesters_enabled', '0');

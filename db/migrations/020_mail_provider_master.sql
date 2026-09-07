-- 020 ZeptoMail as a platform-wide email provider

INSERT IGNORE INTO platform_settings (key_name, value) VALUES
  -- 'smtp' keep today's behaviour: per-tenant SMTP only.
  ('mail_provider',          'smtp'),
  ('mail_zepto_enabled',     '0'),
  -- Zoho issue this per Mail Agent.
  ('mail_zepto_token',       ''),
  -- .in for the India data centre,.com for the rest.
  ('mail_zepto_endpoint',    'https://api.zeptomail.in/v1.1/email'),
  -- Must be an address on a domain verified in ZeptoMail.
  ('mail_zepto_from',        ''),
  ('mail_zepto_from_name',   'Kalpion'),
  ('mail_zepto_last_test_at',   ''),
  ('mail_zepto_last_test_ok',   ''),
  ('mail_zepto_last_test_note', ''),

  -- Where a one-time code goes when somebody signs in with an email address rather than a
  -- phone number.
  ('otp_email_enabled',      '0');

-- ============================================================================
--  020  ZeptoMail as a platform-wide email provider
--
--    mysql -u root -p ifqm_master < db/migrations/020_mail_provider_master.sql
--
--  ── Why this is platform-wide and SMTP is per-tenant ───────────────────────
--
--  Email has always been configured per organisation: each customer put their
--  own SMTP host, user and password into their own org_settings. That is the
--  right model for "notifications appear to come from the customer", and it is
--  kept — a tenant with its own SMTP configured still uses it.
--
--  It is the wrong model for two things:
--
--    1. Anything sent BEFORE a tenant exists, or to somebody who is not in one.
--       A one-time code sent to an email address, an MSME registration
--       acknowledgement, a platform notice. There is no org_settings row to
--       read, so today these simply are not sent.
--
--    2. Getting anything delivered at all on the current hosting. Most managed
--       platforms block outbound SMTP ports; ZeptoMail is an HTTPS API, so it
--       works where port 587 does not.
--
--  So: a platform-wide provider used as the fallback and for platform mail,
--  with per-tenant SMTP still taking precedence when a customer has set it up.
-- ============================================================================

INSERT IGNORE INTO platform_settings (key_name, value) VALUES
  -- 'smtp'      keep today's behaviour: per-tenant SMTP only.
  -- 'zeptomail' use the ZeptoMail API for platform mail, and as the fallback
  --             for any tenant that has not configured its own SMTP.
  ('mail_provider',          'smtp'),
  ('mail_zepto_enabled',     '0'),
  -- Zoho issue this per Mail Agent. It is a send token, not an account
  -- password, and it already carries the "Zoho-enczapikey " prefix when copied
  -- from the console — stored exactly as given and sent as the Authorization
  -- header verbatim, so an operator never has to know that.
  ('mail_zepto_token',       ''),
  -- .in for the India data centre, .com for the rest. Getting this wrong
  -- returns 401 with a message that does not mention regions, which is a
  -- genuinely hard afternoon, so it is a field rather than a guess.
  ('mail_zepto_endpoint',    'https://api.zeptomail.in/v1.1/email'),
  -- Must be an address on a domain verified in ZeptoMail. An unverified from
  -- address is refused outright.
  ('mail_zepto_from',        ''),
  ('mail_zepto_from_name',   'Kalpion'),
  ('mail_zepto_last_test_at',   ''),
  ('mail_zepto_last_test_ok',   ''),
  ('mail_zepto_last_test_note', ''),

  -- Where a one-time code goes when somebody signs in with an email address
  -- rather than a phone number. Until now requestOtp resolved an email
  -- identifier correctly and then tried to SMS it, so an email sign-in could
  -- never receive a code at all.
  ('otp_email_enabled',      '0');

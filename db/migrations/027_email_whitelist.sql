-- ============================================================================
--  027  Domain-based approval for registrations, with an explicit allow list
--
--    mysql -u root -p ifqm_master < db/migrations/027_email_whitelist.sql
--
--  Master registry only — registrations and the platform console live here.
--
--  ── What this turns on ─────────────────────────────────────────────────────
--
--  registrationService has carried a FREE_EMAIL_DOMAINS list since it was
--  written, with a comment explaining why a company applying from Gmail is
--  either a sole trader using personal email or noise. Nothing ever consulted
--  it: checkCorporateEmail() rejected disposable mailboxes and let every
--  consumer provider through.
--
--  That mattered more after the statutory identifiers came off the form
--  (migration 026 era). Udyam, GSTIN, PAN and CIN were how a reviewer checked
--  an applicant against the public registers; with those gone, the work email
--  domain is the strongest remaining signal that an application comes from a
--  real business. So it is now enforced.
--
--  ── Why an allow list rather than just a rule ──────────────────────────────
--
--  Enforcing it alone would be wrong for this market. A genuine two-person
--  engineering firm in Peenya very often has no domain at all and runs on
--  Gmail; refusing them outright turns a policy meant to filter noise into a
--  policy that excludes the customer. The rule and the exception have to ship
--  together, and the exception has to be somewhere a platform admin can reach
--  without a deployment — which is what this table is.
--
--  An entry is either one exact address or a whole domain:
--
--    'ravi@gmail.com'  that person may apply; everybody else on gmail.com
--                      still cannot. This is the normal case.
--    'gmail.com'       the entire provider is reopened. Deliberately possible
--                      and deliberately blunt — it is the lever for "we are
--                      running a campaign and expect Gmail applicants".
--
--  Kept in the registry rather than in a settings row so each entry carries its
--  own note and author. "Why is this address allowed?" is asked months later,
--  by somebody who was not there, and a CSV in a settings value cannot answer
--  it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_whitelist (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  -- Lower-cased on write. Either 'name@provider.com' or 'provider.com'.
  entry       VARCHAR(190) NOT NULL,
  entry_type  ENUM('address','domain') NOT NULL,
  -- Why this exception exists. Not decorative: it is the whole reason the
  -- exception is auditable at all.
  note        VARCHAR(255) NULL,
  created_by  VARCHAR(150) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email_whitelist_entry (entry),
  KEY idx_email_whitelist_type (entry_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

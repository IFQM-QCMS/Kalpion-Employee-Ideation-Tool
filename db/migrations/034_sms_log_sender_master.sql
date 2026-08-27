-- ============================================================================
--  034  Record which sender header an SMS actually went out under
--
--    mysql -u root -p ifqm_master < db/migrations/034_sms_log_sender_master.sql
--
--  Master registry only — sms_delivery_log lives there.
--
--  ── Why this is 034 and not 033 ────────────────────────────────────────────
--
--  033 has the same content and the wrong NAME. The runner routes by filename:
--  *_master.sql goes to the registry, everything else goes to every tenant. So
--  033 ran against the six tenant schemas, where sms_delivery_log does not
--  exist, and its guard correctly made it a no-op — while the registry, the one
--  database that has the table, never saw it.
--
--  Migrations are forward-only here: an applied file is never edited, because
--  copies already recorded in the ledger cannot be updated. So 033 stays as it
--  is, harmlessly recorded against six schemas it did nothing to, and this file
--  carries the change to where it belongs.
--
--  ── Why ────────────────────────────────────────────────────────────────────
--
--  One-time codes stopped arriving. The gateway was returning 202 Accepted, the
--  delivery log recorded every send as ok=1, and nothing anywhere said what was
--  wrong. Diagnosing it took reading the log row by row and inferring the
--  sender from the deployment's history.
--
--  The cause was the sender header. The template ids were registered against
--  IFQMID and the deployment was transmitting IFQMSK — a header that belongs to
--  a different product on the same Kaleyra account. Kaleyra accepts it, because
--  it is a valid sender on the account; the carrier then discards the message,
--  because the template does not belong to that header. There is no error at
--  either end.
--
--  The log already stored template_id, added for precisely this class of
--  problem. It did not store the other half of the pair. A "202 but never
--  arrived" question is always about the id AND the header agreeing, and the
--  row could only answer half of it.
--
--  Storing the header makes that a query rather than an investigation:
--
--      SELECT sender, template_id, COUNT(*)
--        FROM sms_delivery_log GROUP BY sender, template_id;
--
--  A pairing that never appears alongside a delivered message is the answer.
-- ============================================================================

-- ── Portability note ────────────────────────────────────────────────────────
-- Some MySQL deployments (Aiven's default among them) run with ANSI_QUOTES, in
-- which "..." is an IDENTIFIER, not a string. The guarded statement below builds
-- SQL as text and would be read as a column name there — the failure looks like
-- `Unknown column 'ALTER TABLE ...'`, which is baffling until you know why.
-- Dropped for this session only, so the file parses identically everywhere.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has_log := (SELECT COUNT(*) FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sms_delivery_log');

SET @sql := IF(@has_log > 0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sms_delivery_log'
                   AND COLUMN_NAME = 'sender') = 0,
  'ALTER TABLE sms_delivery_log ADD COLUMN sender VARCHAR(16) NULL DEFAULT NULL AFTER provider',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

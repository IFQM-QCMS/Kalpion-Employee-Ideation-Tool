-- ============================================================================
--  040  Remember whether the platform was actually told about an application
--
--    mysql -u root -p ifqm_master < db/migrations/040_registration_notice_retry_master.sql
--
--  Master registry only — tenant_registrations lives nowhere else.
--
--  ── The gap ────────────────────────────────────────────────────────────────
--
--  When a company applies for a workspace, every platform admin is emailed. It
--  is sent once, immediately, and not awaited — the applicant should not wait on
--  our outbound mail server to be told their form went through, which is right.
--
--  What was missing is what happens when that one attempt fails. Nothing was
--  recorded and nothing retried: the failure logged an error line and the
--  application then sat in the queue with nobody aware of it. That is precisely
--  the situation this notice exists to prevent — the admins do not sit refreshing
--  the console, so an application they were never told about is an application
--  that waits until somebody happens to look.
--
--  It is not hypothetical. Notification mail on this platform was dead for weeks
--  (migrations 037 and 038: a settings default that stopped the queue draining,
--  and a status value the column could not hold). Every registration notice in
--  that window was attempted once, failed, and was forgotten.
--
--  ── What this adds ─────────────────────────────────────────────────────────
--
--  One nullable timestamp. Set when at least one platform recipient actually
--  accepted the message; left NULL when nobody did. The hourly job then retries
--  anything still pending and still unnotified, so a mail outage delays the
--  notice rather than losing it.
--
--  Existing rows are back-filled as notified. They were sent under the old
--  behaviour and are long since dealt with; leaving them NULL would have the
--  first run after this deploy re-announce every application ever received.
-- ============================================================================

-- Aiven's default sql_mode includes ANSI_QUOTES, under which "..." is an
-- identifier rather than a string. The guarded statements below build SQL as
-- text and would be read as column names there. Dropped for this session only.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has_tbl := (SELECT COUNT(*) FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_registrations');
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_registrations'
                    AND COLUMN_NAME = 'notified_at');

SET @sql := IF(@has_tbl > 0 AND @has_col = 0,
  'ALTER TABLE tenant_registrations ADD COLUMN notified_at DATETIME NULL
     COMMENT ''When the platform admins were successfully emailed about this''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Back-fill, so the first retry pass does not re-announce history.
SET @sql := IF(@has_tbl > 0 AND @has_col = 0,
  'UPDATE tenant_registrations SET notified_at = COALESCE(created_at, NOW())
    WHERE notified_at IS NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The retry pass asks "pending, and never notified" on every run.
SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_registrations'
                    AND INDEX_NAME = 'idx_reg_notice_pending');
SET @sql := IF(@has_tbl > 0 AND @has_idx = 0,
  'CREATE INDEX idx_reg_notice_pending ON tenant_registrations (notified_at, status)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ============================================================================
--  038  email_queue.status needs the value the code has always written
--
--    mysql -u root -p <tenant_db> < db/migrations/038_email_queue_processing.sql
--
--  Runs against every tenant database. email_queue is a tenant table.
--
--  ── The fault ──────────────────────────────────────────────────────────────
--
--  processEmailQueue claims a row before sending it:
--
--      UPDATE email_queue SET status = 'processing', attempts = attempts + 1 ...
--
--  and the column is ENUM('pending','sent','failed'). 'processing' is not one
--  of them and never has been.
--
--  Under a permissive sql_mode the server truncates the value to '' , raises a
--  warning nobody reads, and carries on — which is what development does,
--  because XAMPP ships MariaDB 10.4. Under STRICT_ALL_TABLES it is error 1265,
--  the whole pass throws, the per-tenant catch in the scheduler logs one line,
--  and not a single message is ever delivered. Aiven's default sql_mode is
--  STRICT_ALL_TABLES, so that is production.
--
--  This is the SECOND fault producing the same symptom as migration 037's:
--  rows sitting at status='pending' with attempts=0 forever. Fixing the
--  email_enabled gate alone would have moved the failure two lines down and
--  changed nothing a recipient could see. It was found by CI, which runs
--  MariaDB 10.11 and is therefore strict where development is not.
--
--  ── Why add the value rather than remove the claim ────────────────────────
--
--  The claim is doing real work: it stops a second pass picking up a row whose
--  send is still in flight. Dropping it would trade a schema fix for an
--  at-most-once guarantee. The code keeps a fallback for a tenant that has not
--  run this yet — it increments attempts without the marker rather than
--  failing — so this migration and the deploy can land in either order.
--
--  Rows stranded in 'processing' by a restart mid-send are returned to
--  'pending' by the drain after fifteen minutes; `attempts` was already
--  incremented, so that cannot loop.
-- ============================================================================

-- Aiven's default sql_mode includes ANSI_QUOTES, under which "..." is an
-- identifier rather than a string. The guarded statement below builds SQL as
-- text and would be read as a column name there. Dropped for this session only.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has_queue := (SELECT COUNT(*) FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_queue');

SET @sql := IF(@has_queue > 0,
  'ALTER TABLE email_queue
     MODIFY COLUMN status ENUM(''pending'',''processing'',''sent'',''failed'')
     NOT NULL DEFAULT ''pending''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Any row a permissive server truncated to '' was mid-send when it happened and
-- has been invisible ever since: not pending, so never retried; not sent, so
-- nobody got it. Put it back in the queue. The age guard in the drain will
-- retire it if it is too old to be worth delivering.
SET @sql := IF(@has_queue > 0,
  'UPDATE email_queue SET status = ''pending'' WHERE status = ''''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

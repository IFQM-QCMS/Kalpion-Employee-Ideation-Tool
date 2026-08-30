-- ============================================================================
--  037  Turn notification email ON — it was never off on purpose
--
--    mysql -u root -p <tenant_db> < db/migrations/037_email_enabled_by_default.sql
--
--  Runs against every tenant database. org_settings is a tenant table.
--
--  ── The fault ──────────────────────────────────────────────────────────────
--
--  Every tenant is seeded with email_enabled = '0', and processEmailQueue began
--
--      if ((settings.email_enabled ?? '0') !== '1') return;
--
--  so it returned before it ever looked at the queue. Nothing failed. Nothing
--  retried. The rows sat at status='pending' with attempts=0 — the signature of
--  a consumer that never ran — while every other part of the product carried on
--  as though mail worked: the screen said the notification was sent, the
--  workflow recorded it, and the person it was for heard nothing.
--
--  On production this had swallowed 47 real messages across two organisations,
--  the oldest three weeks old: ideas received, approvals granted, reviews
--  awaiting somebody. Not one had been attempted.
--
--  Nobody chose that. It was the seed value, and the setting is not surfaced
--  anywhere an administrator would have found it. So the switch is being
--  re-read as what its name says — an organisation that has opted OUT — and the
--  default becomes deliver.
--
--  ── Why this rewrites '0' rather than only changing the default ────────────
--
--  A code change alone would fix new tenants and leave every existing one
--  silent, which is the half-fix that makes a bug look intermittent. Every '0'
--  in the field today came from the seed, not from a decision, so there is no
--  preference here to preserve.
--
--  Only exact '0' is touched. A row that somebody has since set to anything
--  else is left alone, and an organisation that genuinely wants no outbound
--  mail can set it back — the setting still works, it just no longer means
--  "off" by accident.
--
--  ── The backlog ────────────────────────────────────────────────────────────
--
--  Deliberately NOT flushed. processEmailQueue now retires pending mail older
--  than three days, because "Action Required: idea awaiting your approval" sent
--  a fortnight late is not merely stale — the idea has moved on, and the
--  recipient goes looking for something that is not in their queue. Turning
--  delivery on without that would have posted three weeks of history at once.
-- ============================================================================

-- Aiven's default sql_mode includes ANSI_QUOTES, under which "..." is an
-- identifier rather than a string. The guarded statements below build SQL as
-- text and would be read as column names there. Dropped for this session only.
SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES', '');

SET @has_settings := (SELECT COUNT(*) FROM information_schema.TABLES
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_settings');

SET @sql := IF(@has_settings > 0,
  'UPDATE org_settings SET value = ''1''
    WHERE key_name = ''email_enabled'' AND value = ''0''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- A tenant provisioned before the key existed has no row at all, and would read
-- as "not set". The service now treats absent as ON, but an explicit row is
-- what the settings screen edits, so give it one.
SET @sql := IF(@has_settings > 0,
  'INSERT INTO org_settings (key_name, value)
     SELECT ''email_enabled'', ''1'' FROM DUAL
      WHERE NOT EXISTS (SELECT 1 FROM org_settings WHERE key_name = ''email_enabled'')',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── Retire the backlog that accumulated while nothing was draining ──────────
-- Same three-day rule the code now applies, applied once to what is already
-- there. Marked 'failed' rather than deleted: the row is the evidence that a
-- notification was generated and never reached anybody, which is worth keeping
-- when somebody asks why they were not told.
SET @has_queue := (SELECT COUNT(*) FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_queue');

SET @sql := IF(@has_queue > 0,
  'UPDATE email_queue SET status = ''failed''
    WHERE status = ''pending'' AND created_at < NOW() - INTERVAL 3 DAY',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

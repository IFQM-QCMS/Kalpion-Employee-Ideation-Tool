/**
 * Log retention — access logs are deleted once they are older than the
 * organisation's retention window.
 *
 * ── What is purged, and what deliberately is not ────────────────────────────
 *
 * PURGED — records of ACCESS. They grow without bound, they are read only for
 * the recent past, and they carry personal data (IP addresses, user agents,
 * phone numbers) that there is no reason to hold for years:
 *
 *   platform_login_activity   who signed in, from where, and whether it worked
 *   login_attempts            failed-attempt counters behind the lockout
 *   sms_delivery_log          which gateway carried which message
 *   login_otps                spent one-time codes
 *
 * KEPT — records of DECISIONS and MONEY, whatever their age:
 *
 *   idea_workflow             who approved each idea and what they said. This
 *                             is the approval trail: it is Section H of the
 *                             closure PDF and the whole of the org Audit page.
 *                             Deleting it would not tidy a log, it would erase
 *                             the evidence that a decision was made properly.
 *   tenant_billing_events     the accounting record. Invoicing and tax records
 *                             are expected to be retained well beyond a couple
 *                             of years.
 *   payment_attempts          the record of money moving, for the same reason.
 *
 * That distinction is the whole point of this file. "Delete the audit logs"
 * reads as one instruction and is really two, and the half that sounds most
 * like housekeeping is the half that must never happen.
 *
 * ── Why a window rather than a fixed age ───────────────────────────────────
 *
 * The retention period is a platform setting, so it can be moved without a
 * deployment. It is clamped to a floor of 6 months: a window short enough to
 * delete this quarter's sign-ins would take the lockout counters and the
 * delivery evidence with it, and somebody would only discover that while
 * investigating an incident.
 */
import { masterDb } from '../database/master.js';
import { getPlatformSetting } from './platformSettingsService.js';
import logger from '../utils/logger.js';

/** Never purge more recently than this, whatever the setting says. */
export const MIN_RETENTION_MONTHS = 6;
export const DEFAULT_RETENTION_MONTHS = 24;

/**
 * The tables this may delete from, and the column that dates a row.
 *
 * A named list rather than anything derived: a purge that discovers its own
 * targets is a purge that will one day discover a table nobody meant to give
 * it. Adding one here is a deliberate act.
 */
const PURGEABLE = [
  { table: 'platform_login_activity', column: 'created_at' },
  { table: 'login_attempts', column: 'last_attempt' },
  { table: 'sms_delivery_log', column: 'created_at' },
  { table: 'login_otps', column: 'created_at' },
];

/** How many months of access logs to keep. */
export async function retentionMonths() {
  const raw = await getPlatformSetting('log_retention_months');
  const n = parseInt(raw, 10);
  const wanted = Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION_MONTHS;
  return Math.max(MIN_RETENTION_MONTHS, wanted);
}

/**
 * Delete access-log rows older than the retention window.
 *
 * @param {{ dryRun?: boolean }} opts  dryRun counts what would go without
 *   deleting it, so an operator can see the size of a change to the window
 *   before it happens.
 * @returns {Promise<{ months, cutoff, deleted, per_table, dry_run }>}
 */
export async function purgeExpiredLogs({ dryRun = false } = {}) {
  const months = await retentionMonths();
  const master = masterDb();

  /*
   * The cutoff is computed by the DATABASE, not by Node.
   *
   * The same trap that made every password-reset link arrive pre-expired: a
   * date built in JavaScript is UTC, the rows are stamped by MySQL's local
   * NOW(), and comparing the two silently shifts the window by the server's
   * offset. On a host at UTC+5:30 that is a third of a day either side of the
   * boundary — which for a purge means deleting rows that should have been
   * kept.
   */
  const [[{ cutoff }]] = await master.query(
    `SELECT DATE_SUB(NOW(), INTERVAL ${Number(months)} MONTH) AS cutoff`
  );

  const perTable = {};
  let total = 0;

  for (const { table, column } of PURGEABLE) {
    try {
      if (dryRun) {
        const [[row]] = await master.execute(
          `SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${column}\` < ?`, [cutoff]
        );
        perTable[table] = Number(row.n) || 0;
      } else {
        /*
         * Deleted in batches. A single unbounded DELETE across a few million
         * rows holds locks for as long as it takes and can block sign-ins,
         * which is a poor trade for housekeeping that has no deadline.
         */
        let removed = 0;
        for (;;) {
          const [res] = await master.execute(
            `DELETE FROM \`${table}\` WHERE \`${column}\` < ? LIMIT 5000`, [cutoff]
          );
          removed += res.affectedRows || 0;
          if (!res.affectedRows || res.affectedRows < 5000) break;
        }
        perTable[table] = removed;
      }
      total += perTable[table];
    } catch (e) {
      // A table absent on an un-migrated deployment must not stop the rest.
      perTable[table] = 0;
      logger.warn(`retention: skipped ${table} — ${e.message}`);
    }
  }

  if (total) {
    logger.info(
      `retention: ${dryRun ? 'would delete' : 'deleted'} ${total} access-log row(s) `
      + `older than ${months} month(s)`
    );
  }
  return { months, cutoff, deleted: total, per_table: perTable, dry_run: dryRun };
}

export default { purgeExpiredLogs, retentionMonths, MIN_RETENTION_MONTHS, DEFAULT_RETENTION_MONTHS };

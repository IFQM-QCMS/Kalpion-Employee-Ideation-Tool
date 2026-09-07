/*
 * Log retention - access logs are deleted once they are older than the organisation's
 * retention window.
 */
import { masterDb } from '../database/master.js';
import { getPlatformSetting } from './platformSettingsService.js';
import logger from '../utils/logger.js';

/** Never purge more recently than this, whatever the setting says. */
export const MIN_RETENTION_MONTHS = 6;
export const DEFAULT_RETENTION_MONTHS = 24;

/** The tables this may delete from, and the column that dates a row. */
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

/** Delete access-log rows older than the retention window. */
export async function purgeExpiredLogs({ dryRun = false } = {}) {
  const months = await retentionMonths();
  const master = masterDb();

  // The cutoff is computed by the DATABASE, not by Node.
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
        // Deleted in batches. A single unbounded DELETE across a few million rows holds locks for
        // as long as it takes and can block sign-ins, which is a poor trade for housekeeping that
        // has no deadline.
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
      logger.warn(`retention: skipped ${table} - ${e.message}`);
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

/**
 * Background jobs.
 *
 * ── Why this file exists ───────────────────────────────────────────────────
 *
 * Three jobs were written, tested, and then never called by anything:
 *
 *   processEmailQueue   ideaService writes notification emails into
 *                       email_queue on every submission and every decision.
 *                       Nothing drained it. The rows accumulated and not one
 *                       message was ever sent — and because queueEmail
 *                       succeeded, the application reported success the whole
 *                       time. This is the cause of "email doesn't work" that a
 *                       look at the SMTP settings screen would never find.
 *
 *   pruneOtps           expired one-time codes were never deleted.
 *
 *   sweepLapsed         subscriptions past their period were only moved to
 *                       lapsed when a platform admin happened to open the
 *                       billing screen, because the only caller was an
 *                       endpoint.
 *
 * A queue with no consumer is worse than no queue: it fails silently, and it
 * looks like it is working from every direction except the recipient's.
 *
 * ── Deliberate limits ──────────────────────────────────────────────────────
 *
 * This is an interval in the application process, not a job runner. That is the
 * right size for one server and the wrong size for several — two instances
 * would both drain the queue, and the claim/attempt update in processEmailQueue
 * is not atomic enough to make that safe. Section 20 of the architecture
 * document already says running two instances is the answer to sustained load;
 * whoever does that has to move this out first. Hence RUN_BACKGROUND_JOBS,
 * which lets exactly one instance own them in the meantime.
 */
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { masterDb } from '../database/master.js';
import { getTenantPool } from '../database/tenant.js';
import { processEmailQueue } from '../services/mailerService.js';
import { pruneOtps } from '../services/otpService.js';
import * as ideaService from '../services/ideaService.js';
import * as subscriptionService from '../services/subscriptionService.js';
import { purgeExpiredLogs } from '../services/retentionService.js';

const MINUTE = 60 * 1000;

// Often enough that a password reset arrives while the person is still waiting
// for it, rare enough that an idle platform is not hammering its own database.
const EMAIL_EVERY = Number(process.env.EMAIL_QUEUE_INTERVAL_MS) || MINUTE;
const HOUSEKEEPING_EVERY = 60 * MINUTE;

const timers = [];
let running = false;

/**
 * Drain every tenant's queue.
 *
 * The queue is per-organisation because the SMTP credentials are: each customer
 * sends through their own server, so there is no single connection that could
 * deliver all of it. processEmailQueue itself returns immediately for a tenant
 * with email switched off, which is most of them.
 */
async function drainEmailQueues() {
  let tenants = [];
  try {
    const [rows] = await masterDb().query(
      "SELECT id, slug, db_name FROM tenants WHERE status = 'active'"
    );
    tenants = rows;
  } catch (e) {
    logger.warn('scheduler: could not list tenants for email drain', e.message);
    return;
  }

  for (const t of tenants) {
    try {
      await processEmailQueue(getTenantPool(t));
    } catch (e) {
      // One customer's unreachable database, or one bad SMTP host, must not
      // stop the others being served.
      logger.warn(`scheduler: email drain failed for ${t.slug}`, e.message);
    }
  }
}

/**
 * Nightly database backup, off by default.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * `npm run backup` has always worked and nothing ever ran it. A backup script
 * that exists but is never invoked provides the feeling of having backups
 * without any of the property, which is worse than having none — nobody goes
 * looking for a safety net they believe is already there.
 *
 * ── Why it is opt-in, and why it spawns ────────────────────────────────────
 *
 * A real scheduler (cron, systemd timer, Task Scheduler) is still the better
 * answer and DEPLOYMENT.md says so: it survives the app crashing, which is
 * exactly when the last backup matters most. This is for deployments that have
 * no such facility — a managed host with no cron — and it is off unless
 * BACKUP_EVERY_HOURS is set, so no developer machine starts dumping databases
 * because it pulled a branch.
 *
 * Spawned as a child process rather than imported: backup.js runs its work at
 * module scope, and a dump that throws must not take the scheduler — or the
 * server — down with it.
 */
const BACKUP_EVERY_HOURS = Math.max(0, parseInt(process.env.BACKUP_EVERY_HOURS, 10) || 0);

async function runBackup() {
  const { spawn } = await import('node:child_process');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const here = path.dirname(fileURLToPath(import.meta.url));
  const script = path.resolve(here, '..', '..', 'scripts', 'backup.js');

  await new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: 'ignore' });
    child.on('exit', (code) => {
      if (code === 0) logger.info('scheduler: database backup completed');
      // Logged loudly rather than thrown. A failed backup is not a reason to
      // stop serving, but it IS the thing somebody must notice.
      else logger.error(`scheduler: database backup FAILED (exit ${code}) — check BACKUP_DIR and mysqldump`);
      resolve();
    });
    child.on('error', (e) => {
      logger.error(`scheduler: could not start the backup script — ${e.message}`);
      resolve();
    });
  });
}

async function housekeeping() {
  try {
    const n = await pruneOtps();
    if (n) logger.info(`scheduler: pruned ${n} expired one-time code(s)`);
  } catch (e) {
    logger.warn('scheduler: OTP prune failed', e.message);
  }
  /*
   * Access logs older than the retention window. Runs alongside the other
   * housekeeping rather than on its own timer: it has no deadline, and a purge
   * that misses a day simply catches up on the next one.
   */
  try {
    const r = await purgeExpiredLogs();
    if (r?.deleted) {
      logger.info(`scheduler: purged ${r.deleted} access-log row(s) older than ${r.months} month(s)`);
    }
  } catch (e) {
    logger.warn('scheduler: log retention purge failed', e.message);
  }
  try {
    const r = await subscriptionService.sweepLapsed();
    if (r?.lapsed || r?.held) {
      logger.info(`scheduler: ${r.lapsed} subscription(s) lapsed, ${r.held} organisation(s) put on hold`);
    }
  } catch (e) {
    logger.warn('scheduler: subscription sweep failed', e.message);
  }

  /*
   * Ideas waiting on somebody who no longer exists.
   *
   * Submitting and approving both step over a stage nobody holds, but neither
   * runs unless somebody acts — and an idea can become unactionable with no
   * action at all: the last holder of its stage is deactivated, or an admin
   * edits the chain, and the idea is then waiting for a person who is not
   * there. Nobody can act on it, so nothing will ever come along to notice.
   *
   * Here rather than on a read, because a GET that quietly rewrites rows is a
   * surprise; and hourly is soon enough for a condition measured in days.
   */
  try {
    const [tenants] = await masterDb().query(
      "SELECT id, slug, db_name FROM tenants WHERE status = 'active'");
    for (const t of tenants) {
      try {
        const r = await ideaService.repairStrandedIdeas(getTenantPool(t));
        if (r.moved || r.stranded) {
          logger.info(`scheduler: ${t.slug} — ${r.moved} idea(s) re-routed, ${r.stranded} with nobody to act`);
        }
      } catch (e) {
        // One customer's database must not stop the others being repaired.
        logger.warn(`scheduler: approval repair failed for ${t.slug}`, e.message);
      }
    }
  } catch (e) {
    logger.warn('scheduler: could not list tenants for approval repair', e.message);
  }
}

/** A job that never overlaps itself, however slow one run turns out to be. */
function every(ms, name, fn) {
  let busy = false;
  const tick = async () => {
    if (busy) {
      logger.warn(`scheduler: ${name} is still running from the last tick — skipping this one`);
      return;
    }
    busy = true;
    try { await fn(); } catch (e) { logger.error(`scheduler: ${name} threw`, e.message); } finally { busy = false; }
  };
  const t = setInterval(tick, ms);
  // Must not hold the process open: an interval without this turns Ctrl-C and
  // a container stop into a fifteen-second wait for the shutdown timeout.
  t.unref();
  timers.push(t);
  return tick;
}

export function startScheduler() {
  if (running) return;
  // Tests drive the queue directly and assert on its contents; a timer racing
  // them would make failures depend on how long the run took.
  if (config.env === 'test' || process.env.RUN_BACKGROUND_JOBS === '0') {
    logger.info('scheduler: background jobs disabled');
    return;
  }
  running = true;

  every(EMAIL_EVERY, 'email queue', drainEmailQueues);
  every(HOUSEKEEPING_EVERY, 'housekeeping', housekeeping);
  if (BACKUP_EVERY_HOURS > 0) {
    every(BACKUP_EVERY_HOURS * 60 * MINUTE, 'database backup', runBackup);
  }

  logger.info(`scheduler: email queue every ${Math.round(EMAIL_EVERY / 1000)}s, `
    + `housekeeping every ${Math.round(HOUSEKEEPING_EVERY / MINUTE)}m`
    + (BACKUP_EVERY_HOURS > 0
      ? `, backup every ${BACKUP_EVERY_HOURS}h`
      : ', backup NOT scheduled (set BACKUP_EVERY_HOURS, or use cron)'));
}

export function stopScheduler() {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
  running = false;
}

export default { startScheduler, stopScheduler, drainEmailQueues, housekeeping, runBackup };

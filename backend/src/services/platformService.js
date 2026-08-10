/**
 * Platform service — Node port of PHP api/platform.php (IFQM vendor console).
 * Operates on the master registry (ifqm_master) and reads per-tenant aggregate
 * stats. Guarded by requirePlatformAuth.
 *
 * ── PRIVACY CONTRACT ────────────────────────────────────────────────────────
 * A platform admin is the VENDOR, not a member of the customer's organisation.
 * They may see the outer shell of a tenant and nothing else:
 *
 *   ALLOWED   tenant name/slug/status, the org's own admin contacts (IFQM
 *             provisions those accounts and needs someone to talk to), how many
 *             users exist, the spread of roles, aggregate idea counts/trends.
 *
 *   FORBIDDEN any individual employee (name, email, employee_id, department,
 *             location, points, manager), any idea title/content/score, any
 *             uploaded file — anything happening INSIDE the tenant's tool.
 *
 * This is deliberately narrower than it once was. tenantDetail() used to return
 * every employee's name, email, employee_id, department, location and points,
 * and tenantHierarchy() returned the entire org chart with per-person idea
 * counts — i.e. the vendor could read any customer's full staff directory. The
 * old docblock even described that as the privacy contract ("user directory /
 * hierarchy only"). Aggregates are computed with COUNT/GROUP BY in SQL so the
 * rows never leave the tenant's database in the first place.
 *
 * Tenant DB credentials are stripped (safeTenant) before responding.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import config from '../config/index.js';
import { masterDb } from '../database/master.js';
import { getTenantPool } from '../database/tenant.js';
import { badRequest, notFound, ApiError } from '../utils/respond.js';
import { assertPasswordStrength } from './authService.js';
import { defaultsForNewTenant } from './platformSettingsService.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Consolidated tenant schema (source schema.sql + the idea_comments/challenges/
// email_queue tables that lived only in schema_updates.sql). See the file header
// and MIGRATION.md — the original schema.sql was incomplete for provisioning.
const SCHEMA_PATH = path.resolve(__dirname, '..', '..', 'schema', 'tenant_schema.sql');

/** Strip sensitive DB credentials before sending a tenant to the client. */
function safeTenant(t) {
  const { db_host, db_name, db_user, db_pass, ...rest } = t;
  return rest;
}

/**
 * How many consecutive days without a sign-in before an organisation reads as
 * dormant. Reporting only — nothing is switched off, no email is sent, and the
 * tenant's status column is untouched. An operator seeing "inactive 9 days" can
 * decide to call them; the platform does not decide for them.
 */
const INACTIVE_AFTER_DAYS = 5;

/**
 * MSME applications waiting on a decision. Queried inline rather than imported
 * from registrationService, which already imports createTenant from this module
 * — a cycle ESM would tolerate but nobody should have to reason about.
 *
 * Returns 0 if the table is missing (migration 009 not yet applied): a
 * notification badge must never be able to take the console down.
 */
async function pendingRegistrationCount() {
  try {
    const [[r]] = await masterDb().query(
      "SELECT COUNT(*) AS c FROM tenant_registrations WHERE status = 'pending'"
    );
    return Number(r?.c || 0);
  } catch (e) {
    logger.warn('pending registration count unavailable', e.message);
    return 0;
  }
}

/**
 * Two orthogonal things the console used to conflate:
 *
 *   status         — what an operator DID to the org (active / on hold / pending).
 *   activity_state — what the org has been DOING (signing in, or gone quiet).
 *
 * An org can be perfectly active and on hold, or nominally active and silent
 * for a month. Collapsing them into one badge hid both.
 */
function activityOf(tenant) {
  if (tenant.status === 'suspended') return { activity_state: 'on_hold', days_since_login: null };
  if (tenant.status === 'pending') return { activity_state: 'pending', days_since_login: null };

  const last = tenant.last_login_at ? new Date(tenant.last_login_at) : null;
  if (!last || Number.isNaN(last.getTime())) {
    // Never signed in. Not the same as having gone quiet, and worth its own
    // label — a provisioned org nobody ever logged into is a failed handover.
    return { activity_state: 'never_logged_in', days_since_login: null };
  }
  const days = Math.floor((Date.now() - last.getTime()) / 86400000);
  return {
    activity_state: days >= INACTIVE_AFTER_DAYS ? 'inactive' : 'active',
    days_since_login: days,
  };
}

/** Order-by-role FIELD() fragment shared across tenant user queries. */
const ROLE_ORDER = "FIELD(u.role,'admin','executive','plant_head','senior_manager','department_manager','manager','project_lead','team_lead','employee','trainee')";

// ── GET tenants (aggregate stats only) ─────────────────────────────
export async function tenants() {
  const master = masterDb();
  const [rows] = await master.query('SELECT * FROM tenants ORDER BY created_at ASC');

  const out = [];
  for (const t of rows) {
    const stats = {
      user_count: 0, idea_count: 0, implemented_count: 0, qcms_pushed_count: 0,
      last_activity: null,
      trend: [], admin_name: null, admin_email: null,
    };
    try {
      const db = getTenantPool(t);
      const [[uc]] = await db.query("SELECT COUNT(*) AS c FROM users WHERE role != 'super_admin'");
      const [[ic]] = await db.query("SELECT COUNT(*) AS c FROM ideas WHERE status != 'Draft'");
      const [[imp]] = await db.query("SELECT COUNT(*) AS c FROM ideas WHERE status = 'Implemented'");
      // §12.5 — how many of this org's ideas actually reached QCMS. The column
      // may predate a tenant's last migration, so a failure here degrades to 0
      // rather than blanking the whole row.
      let qcmsPushed = 0;
      try {
        const [[qp]] = await db.query(
          "SELECT COUNT(*) AS c FROM ideas WHERE qcms_pushed_at IS NOT NULL AND qcms_push_status = 'success'"
        );
        qcmsPushed = Number(qp.c) || 0;
      } catch { /* column absent on an un-migrated tenant */ }
      const [[la]] = await db.query("SELECT MAX(submitted_at) AS last FROM ideas WHERE status != 'Draft'");
      const [trend] = await db.query(
        `SELECT DATE_FORMAT(submitted_at,'%Y-%m') AS month, COUNT(*) AS cnt
         FROM ideas WHERE submitted_at IS NOT NULL AND status != 'Draft'
         GROUP BY month ORDER BY month DESC LIMIT 6`
      );
      // The org's primary admin — the vendor's support contact, and the only
      // individual this endpoint may name. Ordinary employees are never listed.
      const [[admin] = []] = await db.query(
        `SELECT name, email FROM users
          WHERE role IN ('admin','super_admin') AND status = 'active'
          ORDER BY ${ROLE_ORDER.replace(/u\./g, '')}, id LIMIT 1`
      );
      stats.user_count = Number(uc.c);
      stats.idea_count = Number(ic.c);
      stats.implemented_count = Number(imp.c);
      stats.qcms_pushed_count = qcmsPushed;
      stats.last_activity = la.last ?? null;
      stats.trend = trend;
      stats.admin_name = admin?.name ?? null;
      stats.admin_email = admin?.email ?? null;
    } catch (e) {
      logger.warn(`tenant DB unavailable for ${t.slug}`, e.message);
      stats.db_error = true;
    }
    out.push(safeTenant({ ...t, ...stats, ...activityOf(t) }));
  }

  /*
   * §12.5 / §12.8 — the business-value roll-up the MOM asked for, as one path:
   * organisations → ideas → implemented → pushed to QCMS. Summed from the
   * per-tenant figures already gathered above rather than re-queried, so the
   * headline can never disagree with the table under it.
   */
  const totals = out.reduce((acc, t) => ({
    orgs: acc.orgs + 1,
    ideas: acc.ideas + (t.idea_count || 0),
    implemented: acc.implemented + (t.implemented_count || 0),
    qcms_pushed: acc.qcms_pushed + (t.qcms_pushed_count || 0),
  }), { orgs: 0, ideas: 0, implemented: 0, qcms_pushed: 0 });

  return {
    success: true,
    tenants: out,
    totals,
    inactive_after_days: INACTIVE_AFTER_DAYS,
    // Badge for the console: MSME applications waiting for a decision.
    pending_registrations: await pendingRegistrationCount(),
  };
}

/** Look up a tenant registry row, or 404. */
async function requireTenantRow(tenantId, { activeOnly = false } = {}) {
  tenantId = Number(tenantId) || 0;
  if (!tenantId) throw badRequest('Missing tenant id.');

  const [rows] = await masterDb().execute(
    activeOnly
      ? "SELECT * FROM tenants WHERE id = ? AND status = 'active' LIMIT 1"
      : 'SELECT * FROM tenants WHERE id = ? LIMIT 1',
    [tenantId]
  );
  if (!rows[0]) throw notFound('Tenant not found.');
  return rows[0];
}

/**
 * The privacy-safe shell of a tenant: counts and role spread, plus the org's own
 * admin contacts. No employee rows ever cross this boundary — the GROUP BY runs
 * inside the tenant's database and only the tallies come back.
 */
async function tenantShell(t) {
  const db = getTenantPool(t);

  const [[uc]] = await db.query("SELECT COUNT(*) AS c FROM users WHERE role != 'super_admin'");
  const [roleRows] = await db.query(
    `SELECT role, COUNT(*) AS cnt, SUM(status = 'active') AS active_cnt
       FROM users WHERE role != 'super_admin'
      GROUP BY role ORDER BY ${ROLE_ORDER.replace(/u\./g, '')}`
  );
  const [ideaStats] = await db.query(
    "SELECT status, COUNT(*) AS cnt FROM ideas WHERE status != 'Draft' GROUP BY status"
  );
  // The org's admins are the exception to "no individual users": IFQM creates
  // that account when provisioning and needs a contact for support and billing.
  // It stops at name/email/status — no department, no points, no activity.
  const [admins] = await db.query(
    `SELECT name, email, role, status FROM users
      WHERE role IN ('admin','super_admin') ORDER BY ${ROLE_ORDER.replace(/u\./g, '')}, name`
  );

  /*
   * How much of the product this organisation is actually using.
   *
   * Each figure is wrapped on its own rather than fetched in one statement,
   * because a tenant that has not run the latest migration is missing a column
   * and a single query would return nothing at all. A missing figure should
   * read as zero, not blank the whole page.
   */
  const count = async (sql) => {
    try {
      const [[row]] = await db.query(sql);
      return Number(row.c) || 0;
    } catch {
      return 0;
    }
  };

  const usage = {
    ideas_total: await count("SELECT COUNT(*) AS c FROM ideas WHERE status != 'Draft'"),
    ideas_draft: await count("SELECT COUNT(*) AS c FROM ideas WHERE status = 'Draft'"),
    ideas_approved: await count("SELECT COUNT(*) AS c FROM ideas WHERE status = 'Approved'"),
    ideas_implemented: await count("SELECT COUNT(*) AS c FROM ideas WHERE status = 'Implemented'"),
    ideas_rejected: await count("SELECT COUNT(*) AS c FROM ideas WHERE status = 'Rejected'"),
    // The point at which an idea stops being a suggestion and becomes tracked
    // work in the QCMS tool - the figure that shows the platform paid for itself.
    qcms_pushed: await count(
      "SELECT COUNT(*) AS c FROM ideas WHERE qcms_pushed_at IS NOT NULL AND qcms_push_status = 'success'"
    ),
    qcms_failed: await count(
      "SELECT COUNT(*) AS c FROM ideas WHERE qcms_push_status = 'failed'"
    ),
    patentable_flagged: await count('SELECT COUNT(*) AS c FROM ideas WHERE patentable_flag = 1'),
    attachments: await count('SELECT COUNT(*) AS c FROM idea_attachments'),
    comments: await count('SELECT COUNT(*) AS c FROM idea_comments WHERE is_deleted = 0'),
    challenges: await count('SELECT COUNT(*) AS c FROM challenges'),
    departments: await count(
      "SELECT COUNT(DISTINCT department) AS c FROM users WHERE department IS NOT NULL AND department != ''"
    ),
    active_users: await count("SELECT COUNT(*) AS c FROM users WHERE status = 'active' AND role != 'super_admin'"),
  };

  // Realised savings, where anybody has recorded them.
  let roiTotal = 0;
  try {
    const [[roi]] = await db.query(
      "SELECT COALESCE(SUM(roi_value),0) AS v FROM ideas WHERE status = 'Implemented'"
    );
    roiTotal = Number(roi.v) || 0;
  } catch { /* column absent on an un-migrated tenant */ }

  let lastIdea = null;
  try {
    const [[row]] = await db.query("SELECT MAX(submitted_at) AS d FROM ideas WHERE status != 'Draft'");
    lastIdea = row?.d || null;
  } catch { /* ignore */ }

  const [monthly] = await db.query(
    `SELECT DATE_FORMAT(submitted_at,'%Y-%m') AS month, COUNT(*) AS cnt
       FROM ideas WHERE submitted_at IS NOT NULL AND status != 'Draft'
      GROUP BY month ORDER BY month DESC LIMIT 12`
  ).catch(() => [[]]);

  return {
    user_count: Number(uc.c),
    role_distribution: roleRows.map((r) => ({
      role: r.role,
      count: Number(r.cnt),
      active_count: Number(r.active_cnt),
    })),
    idea_stats: ideaStats,
    usage,
    roi_total: roiTotal,
    last_idea_at: lastIdea,
    monthly_trend: (monthly || []).slice().reverse(),
    admins,
  };
}

/**
 * GET tenant detail — the outer layer only.
 *
 * Previously returned the tenant's entire employee directory. It now returns
 * exactly what a vendor needs to support an account: who runs it, how big it is,
 * what the role spread looks like, and aggregate idea counts.
 */
export async function tenantDetail(tenantId) {
  const t = await requireTenantRow(tenantId);
  try {
    const shell = await tenantShell(t);

    /*
     * The application this organisation was created from.
     *
     * Everything a person would want to check about a company - Udyam number,
     * GSTIN, PAN, CIN, entity type, sector, size, turnover, registered address
     * - was collected once, at registration, and then never shown again. It sat
     * in tenant_registrations where nobody looked. This joins it back on.
     *
     * Absent for organisations IFQM created directly rather than from an
     * application, which is why every reader has to cope with null.
     */
    const [[registration] = []] = await masterDb().execute(
      `SELECT * FROM tenant_registrations
        WHERE tenant_id = ? ORDER BY reviewed_at DESC, id DESC LIMIT 1`,
      [t.id]
    );

    return {
      success: true,
      tenant: safeTenant(t),
      registration: registration || null,
      activity: activityOf(t),
      ...shell,
    };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(503, 'Tenant database is unavailable.');
  }
}

// ── POST create_tenant (provision a new organisation) ──────────────
// What a new tenant starts with is no longer hardcoded here — it comes from
// ifqm_master.platform_settings, editable from Platform → Settings. See
// platformSettingsService.defaultsForNewTenant(), which falls back to the
// original built-in list if that table is empty or unreachable.

/** Split schema.sql into executable statements (mirrors the PHP explode(';')). */
/* The tenant schema is now applied in a single multi-statement query (see
   createTenant), so the app no longer hand-splits SQL on ';' — a splitter that
   could never be made safe against semicolons inside comments and strings. */

/**
 * Turn a database failure into something the operator can act on.
 *
 * Deliberately a fixed set of sentences rather than the driver's message: the
 * mapping is what makes it safe to show. An unrecognised failure still says
 * nothing specific, because that is the case where we do not know what the text
 * would reveal.
 *
 * The raw error is logged either way; this only decides what reaches the screen.
 */
function describeCreateFailure(e) {
  const code = e?.code || '';
  const msg = String(e?.sqlMessage || e?.message || '');

  if (code === 'ER_DUP_ENTRY') {
    // Which uniqueness was violated changes what the operator has to fix.
    if (/uq_domain|domain/i.test(msg)) {
      return 'That organisation code is already taken by another organisation. Choose a different one.';
    }
    if (/email/i.test(msg)) {
      return 'That administrator email address is already registered. Use a different address, '
        + 'or add this person to the existing organisation instead of creating a new one.';
    }
    if (/employee_id/i.test(msg)) {
      return 'The administrator employee number derived from this organisation code is already in use. '
        + 'Choose a different organisation code.';
    }
    return 'Something in this form is already in use by another organisation — most likely the '
      + 'organisation code or the administrator email address.';
  }

  if (code === 'ER_CON_COUNT_ERROR' || code === 'ER_TOO_MANY_USER_CONNECTIONS'
      || code === 'ER_USER_LIMIT_REACHED') {
    return 'The database is at its connection limit right now. Wait a minute and try again; '
      + 'if it keeps happening the database plan needs more connections.';
  }
  if (code === 'ER_DBACCESS_DENIED_ERROR' || code === 'ER_ACCESS_DENIED_ERROR'
      || code === 'ER_CANT_CREATE_DB' || code === 'ER_SPECIFIC_ACCESS_DENIED_ERROR') {
    return 'The database account this server uses is not allowed to create a new database. '
      + 'It needs CREATE privileges on the ifqm_% schemas.';
  }
  if (code === 'ER_DB_CREATE_EXISTS') {
    return 'A database for that organisation code already exists, left over from an earlier attempt. '
      + 'Choose a different code, or ask for the leftover database to be removed.';
  }
  if (code === 'PROTOCOL_CONNECTION_LOST' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED'
      || code === 'ENOTFOUND') {
    return 'The database could not be reached while setting the organisation up. '
      + 'Nothing was created. Try again in a moment.';
  }
  if (code === 'ER_PARSE_ERROR' || code === 'ER_SYNTAX_ERROR') {
    return 'The organisation was not created because the tenant schema could not be applied. '
      + 'This is a fault on our side, not in what you entered — please report it.';
  }
  if (code === 'ER_DISK_FULL' || /disk|quota/i.test(msg)) {
    return 'The database is out of space, so the organisation could not be created.';
  }
  return '';
}

export async function createTenant(body) {
  const orgName = String(body.org_name ?? '').trim();
  const slug = String(body.slug ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const adminName = String(body.admin_name ?? '').trim();
  const adminEmail = String(body.admin_email ?? '').trim().toLowerCase();
  const adminPass = body.admin_password ?? '';
  const color = /^#[0-9a-fA-F]{6}$/.test(body.primary_color ?? '') ? body.primary_color : '#4f46e5';

  if (!orgName || !slug || !adminName || !adminEmail || !adminPass) {
    throw badRequest('All fields are required.');
  }
  if (slug.length < 2 || slug.length > 30) throw badRequest('Org code must be 2–30 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw badRequest('Invalid admin email address.');
  // This account is the org's super user — 6 characters was never acceptable.
  assertPasswordStrength(adminPass, { label: 'Admin password' });

  const master = masterDb();
  const [dup] = await master.execute('SELECT id FROM tenants WHERE slug=? LIMIT 1', [slug]);
  if (dup.length) throw new ApiError(409, 'Organization code already in use.');

  /*
   * The code is normalised, so what an operator types is not always what they
   * get: "My Org Name" becomes "myorgname". That is the right behaviour — it has
   * to be usable in a URL — but silently keeping a different value than somebody
   * typed is how they end up telling a customer the wrong sign-in code. The
   * normalised value is returned so the screen can show what was actually used.
   */
  const dbName = 'ifqm_' + slug.replace(/[^a-z0-9_]/g, '_');
  const adminEmpId = slug.toUpperCase() + '-ADMIN';

  let conn;
  try {
    await master.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    conn = await mysql.createConnection({
      host: config.masterDb.host,
      port: config.db.port,
      ssl: config.db.ssl,
      user: config.masterDb.user,
      password: config.masterDb.password,
      database: dbName,
      charset: 'utf8mb4',
      // Provision the whole schema in one round trip, exactly as the test
      // harness does. The previous approach split the file on ';' and ran the
      // pieces one by one, which shattered any statement whose body contained a
      // semicolon inside a comment or string (e.g. the `-- …estimate; …` note in
      // the ideas table) — so "Create New Organisation" died with a bare SQL
      // syntax error. Letting the driver parse the batch removes that whole class
      // of bug and keeps provisioning identical to how the schema is authored.
      multipleStatements: true,
    });

    const schema = await fs.readFile(SCHEMA_PATH, 'utf8');
    await conn.query(schema);

    const initials = adminName.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'OA';
    const hash = await bcrypt.hash(adminPass, 12);
    await conn.execute(
      `INSERT INTO users (employee_id, name, email, password_hash, role, avatar_initials, status, password_changed_at)
       VALUES (?, ?, ?, ?, 'admin', ?, 'active', NOW())`,
      [adminEmpId, adminName, adminEmail, hash, initials]
    );

    // VALUES(value), not value=value: tenant_schema.sql has already seeded
    // org_settings with its own baseline, and the operator's platform defaults
    // are the more specific intent, so they must win. The old code used the
    // no-op form, which was harmless only because the hardcoded list it wrote
    // was identical to the schema's — the moment these become editable, that
    // form would silently ignore whatever the operator configured.
    for (const [k, v] of await defaultsForNewTenant()) {
      await conn.execute(
        'INSERT INTO org_settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value=VALUES(value)',
        [k, v]
      );
    }

    // db_user/db_pass are written EMPTY on purpose. The registry used to store a
    // live database username and plaintext password per tenant (in practice the
    // root account), which turned ifqm_master into a list of working DB
    // credentials. The app now connects with a single least-privilege account
    // from the environment (APP_DB_USER/APP_DB_PASS) and only needs to know
    // which host and schema a tenant lives in.
    const [res] = await master.execute(
      `INSERT INTO tenants (name, slug, domain, db_host, db_name, db_user, db_pass, status, is_default, primary_color)
       VALUES (?, ?, ?, ?, ?, '', '', 'active', 0, ?)`,
      [orgName, slug, slug + '.localhost', config.masterDb.host, dbName, color]
    );

    return {
      success: true,
      tenant_id: res.insertId,
      org_name: orgName,
      slug,
      // True when the code had to be changed to be usable, so the screen can
      // point it out rather than letting somebody circulate the wrong one.
      slug_adjusted: slug !== String(body.slug ?? '').trim(),
      slug_requested: String(body.slug ?? '').trim(),
      db_name: dbName,
      login_url: '?org=' + slug,
      admin_email: adminEmail,
    };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    try { await master.query(`DROP DATABASE IF EXISTS \`${dbName}\``); } catch { /* ignore */ }
    // Don't echo the raw driver error back to the client — it can disclose
    // schema names, credentials and internal paths. Log it, return a generic.
    logger.error(`createTenant failed for slug "${slug}" (${e?.code || 'no code'})`, e);

    /*
     * Say what went wrong where we can name it safely. The reader is IFQM staff
     * in a browser with no access to any log, so "check the server logs" was an
     * instruction they could not follow — it turned every failure into a call to
     * a developer.
     */
    const reason = describeCreateFailure(e);
    throw new ApiError(500,
      reason || 'The organisation could not be created, and the reason was not one we recognise. '
        + `Nothing was left behind. Quote this when reporting it: ${e?.code || 'unknown'}.`,
      { failure_code: e?.code || null });
  } finally {
    if (conn) await conn.end();
  }
}

// ── PATCH /tenants/:id — rename / re-slug / suspend ────────────────
const TENANT_STATUSES = ['active', 'suspended', 'pending'];

/**
 * Suspending a tenant is not cosmetic: resolveTenant() only ever matches
 * status='active', so a suspended org's users are refused at login and every
 * authenticated request fails tenant resolution. That is the intended kill
 * switch for non-payment or offboarding.
 */
export async function updateTenant(tenantId, body) {
  const t = await requireTenantRow(tenantId);
  const updates = [];
  const params = [];

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw badRequest('Organisation name cannot be empty.');
    if (name.length > 100) throw badRequest('Organisation name must be 100 characters or fewer.');
    updates.push('name = ?');
    params.push(name);
  }

  if (body.slug !== undefined) {
    const slug = String(body.slug).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (slug.length < 2 || slug.length > 30) throw badRequest('Org code must be 2–30 characters.');
    if (slug !== t.slug) {
      const [dup] = await masterDb().execute('SELECT id FROM tenants WHERE slug = ? AND id != ? LIMIT 1', [slug, tenantId]);
      if (dup.length) throw new ApiError(409, 'Organisation code already in use.');
      updates.push('slug = ?');
      params.push(slug);
    }
  }

  if (body.status !== undefined) {
    const status = String(body.status);
    if (!TENANT_STATUSES.includes(status)) throw badRequest('Invalid status.');
    // The default tenant is the fallback every slug-less login lands on.
    // Suspending it would lock out anyone who signs in without an org code.
    if (status !== 'active' && t.is_default) {
      throw badRequest('The default organisation cannot be suspended.');
    }
    updates.push('status = ?');
    params.push(status);
  }

  if (!updates.length) throw badRequest('Nothing to update.');

  params.push(tenantId);
  await masterDb().execute(`UPDATE tenants SET ${updates.join(', ')} WHERE id = ?`, params);
  logger.info(`platform: tenant ${t.slug} updated (${updates.join(', ')})`);

  const [rows] = await masterDb().execute('SELECT * FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
  return { success: true, tenant: safeTenant(rows[0]) };
}

// ── POST /tenants/:id/reset-admin-password ─────────────────────────
/**
 * Issue a temporary password for a locked-out tenant admin.
 *
 * The vendor never learns the admin's real password (it is bcrypt-hashed and
 * unrecoverable) — this mints a new random one, forces must_change_password, and
 * returns it ONCE for the operator to hand over out of band. Setting
 * password_changed_at also kills every session opened with the old password, so
 * a compromised admin session is ended by the same action that recovers it.
 */
export async function resetTenantAdminPassword(tenantId, body) {
  const t = await requireTenantRow(tenantId);
  const email = String(body?.admin_email ?? '').trim().toLowerCase();
  if (!email) throw badRequest('Admin email is required.');

  try {
    const db = getTenantPool(t);
    const [rows] = await db.execute(
      "SELECT id, email, role FROM users WHERE email = ? AND role IN ('admin','super_admin') LIMIT 1",
      [email]
    );
    const admin = rows[0];
    // Deliberately scoped to admins: this endpoint must not become a way for the
    // vendor to take over an ordinary employee's account and read their ideas.
    if (!admin) throw notFound('No admin account with that email in this organisation.');

    const tempPassword = crypto.randomBytes(9).toString('base64url'); // 12 chars, meets the policy
    await db.execute(
      `UPDATE users
          SET password_hash = ?, must_change_password = 1, password_changed_at = NOW()
        WHERE id = ?`,
      [await bcrypt.hash(tempPassword, 12), admin.id]
    );

    logger.info(`platform: admin password reset for ${email} @ ${t.slug}`);
    return {
      success: true,
      admin_email: admin.email,
      temp_password: tempPassword,
      note: 'Shown once. The admin must change it at next sign-in.',
    };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(503, 'Tenant database is unavailable.');
  }
}

// ── DELETE /tenants/:id ────────────────────────────────────────────
/**
 * Remove an organisation.
 *
 * Irreversible, so it is gated on the caller echoing back the org code — an
 * accidental click on the wrong row cannot delete a live customer. Dropping the
 * database is opt-in and separate: the default detaches the tenant from the
 * registry but leaves its data intact on disk, which is what you want when an
 * account is being wound down but its data must be retained.
 */
export async function deleteTenant(tenantId, body) {
  const t = await requireTenantRow(tenantId);

  if (String(body?.confirm_slug ?? '') !== t.slug) {
    throw badRequest(`Type the org code "${t.slug}" to confirm deletion.`);
  }
  if (t.is_default) throw badRequest('The default organisation cannot be deleted.');

  const dropDatabase = body?.drop_database === true;
  await masterDb().execute('DELETE FROM tenants WHERE id = ?', [tenantId]);

  let databaseDropped = false;
  if (dropDatabase) {
    try {
      // Identifier, so it cannot be a bound parameter — the name comes from our
      // own registry and createTenant built it as 'ifqm_' + a sanitised slug,
      // but re-check rather than trust the row.
      if (!/^ifqm_[a-z0-9_]+$/.test(t.db_name)) {
        throw new ApiError(400, `Refusing to drop unexpected database name "${t.db_name}".`);
      }
      await masterDb().query(`DROP DATABASE IF EXISTS \`${t.db_name}\``);
      databaseDropped = true;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      // The registry row is already gone; report honestly rather than pretend.
      logger.error(`platform: tenant ${t.slug} unregistered but DROP DATABASE failed`, e);
      return {
        success: true,
        deleted: t.slug,
        database_dropped: false,
        warning: `Organisation removed, but its database "${t.db_name}" could not be dropped. Remove it manually.`,
      };
    }
  }

  logger.info(`platform: tenant ${t.slug} deleted (database_dropped=${databaseDropped})`);
  return { success: true, deleted: t.slug, database_dropped: databaseDropped };
}

export default {
  tenants, tenantDetail, createTenant, updateTenant, resetTenantAdminPassword, deleteTenant,
};

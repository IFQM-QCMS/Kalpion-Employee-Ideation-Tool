/** Platform service - Node port of PHP api/platform.php (IFQM vendor console). */
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
// email_queue tables that lived only in schema_updates.sql).
const SCHEMA_PATH = path.resolve(__dirname, '..', '..', 'schema', 'tenant_schema.sql');

/** Strip sensitive DB credentials before sending a tenant to the client. */
function safeTenant(t) {
  const { db_host, db_name, db_user, db_pass, ...rest } = t;
  return rest;
}

/** How many consecutive days without a sign-in before an organisation reads as dormant. */
const INACTIVE_AFTER_DAYS = 5;

/** MSME applications waiting on a decision. */
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

/*
 * status - what an operator DID to the org (active / on hold / pending). activity_state -
 * what the org has been DOING (signing in, or gone quiet).
 */
function activityOf(tenant) {
  if (tenant.status === 'suspended') return { activity_state: 'on_hold', days_since_login: null };
  if (tenant.status === 'pending') return { activity_state: 'pending', days_since_login: null };

  const last = tenant.last_login_at ? new Date(tenant.last_login_at) : null;
  if (!last || Number.isNaN(last.getTime())) {
    // Never signed in. Not the same as having gone quiet, and worth its own label - a
    // provisioned org nobody ever logged into is a failed handover.
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

// GET tenants (aggregate stats only)
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
      // §12.5 - how many of this org's ideas actually reached QCMS.
      let qcmsPushed = 0;
      try {
        // 'imported' or 'duplicate' - the two outcomes that mean the idea is in QCMS.
        const [[qp]] = await db.query(
          `SELECT COUNT(*) AS c FROM ideas
            WHERE qcms_pushed_at IS NOT NULL AND qcms_push_status IN ('imported','duplicate')`
        );
        qcmsPushed = Number(qp.c) || 0;
      } catch { /* column absent on an un-migrated tenant */ }
      const [[la]] = await db.query("SELECT MAX(submitted_at) AS last FROM ideas WHERE status != 'Draft'");
      const [trend] = await db.query(
        `SELECT DATE_FORMAT(submitted_at,'%Y-%m') AS month, COUNT(*) AS cnt
         FROM ideas WHERE submitted_at IS NOT NULL AND status != 'Draft'
         GROUP BY month ORDER BY month DESC LIMIT 6`
      );
      // The org's primary admin - the vendor's support contact, and the only individual this
      // endpoint may name. Ordinary employees are never listed.
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

  // §12.5 / §12.8 - the business-value roll-up the MOM asked for, as one path: organisations
  // ideas implemented pushed to QCMS.
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

/*
 * The privacy-safe shell of a tenant: counts and role spread, plus the org's own admin
 * contacts.
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
  // The org's admins are the exception to "no individual users": IFQM creates that account
  // when provisioning and needs a contact for support and billing.
  const [admins] = await db.query(
    `SELECT name, email, role, status FROM users
      WHERE role IN ('admin','super_admin') ORDER BY ${ROLE_ORDER.replace(/u\./g, '')}, name`
  );

  // How much of the product this organisation is actually using.
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
    // The point at which an idea stops being a suggestion and becomes tracked work in the QCMS
    // tool - the figure that shows the platform paid for itself.
    qcms_pushed: await count(
      `SELECT COUNT(*) AS c FROM ideas
        WHERE qcms_pushed_at IS NOT NULL AND qcms_push_status IN ('imported','duplicate')`
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

/** GET tenant detail - the outer layer only. */
export async function tenantDetail(tenantId) {
  const t = await requireTenantRow(tenantId);
  try {
    const shell = await tenantShell(t);

    // The application this organisation was created from.
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

// POST create_tenant (provision a new organisation) What a new tenant starts with is no
// longer hardcoded here - it comes from ifqm_master.platform_settings, editable from
// Platform Settings.

/** Split schema.sql into executable statements (mirrors the PHP explode(';')). */
// The tenant schema is now applied in a single multi-statement query (see createTenant),
// so the app no longer hand-splits SQL on ';' - a splitter that could never be made safe
// against semicolons inside comments and strings.

/** Turn a database failure into something the operator can act on. */
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
    return 'Something in this form is already in use by another organisation - most likely the '
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
      + 'This is a fault on our side, not in what you entered - please report it.';
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
  if (slug.length < 2 || slug.length > 30) throw badRequest('Org code must be 2-30 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw badRequest('Invalid admin email address.');
  // This account is the org's super user - 6 characters was never acceptable.
  assertPasswordStrength(adminPass, { label: 'Admin password' });

  const master = masterDb();
  const [dup] = await master.execute('SELECT id FROM tenants WHERE slug=? LIMIT 1', [slug]);
  if (dup.length) throw new ApiError(409, 'Organization code already in use.');

  // The code is normalised, so what an operator types is not always what they get: "My Org
  // Name" becomes "myorgname".
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
      // Provision the whole schema in one round trip, exactly as the test harness does.
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

    // VALUES(value), not value=value: tenant_schema.sql has already seeded org_settings with
    // its own baseline, and the operator's platform defaults are the more specific intent, so
    // they must win.
    for (const [k, v] of await defaultsForNewTenant()) {
      await conn.execute(
        'INSERT INTO org_settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value=VALUES(value)',
        [k, v]
      );
    }

    // db_user/db_pass are written EMPTY on purpose.
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
      // True when the code had to be changed to be usable, so the screen can point it out rather
      // than letting somebody circulate the wrong one.
      slug_adjusted: slug !== String(body.slug ?? '').trim(),
      slug_requested: String(body.slug ?? '').trim(),
      db_name: dbName,
      login_url: '?org=' + slug,
      admin_email: adminEmail,
    };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    try { await master.query(`DROP DATABASE IF EXISTS \`${dbName}\``); } catch { /* ignore */ }
    // Don't echo the raw driver error back to the client - it can disclose schema names,
    // credentials and internal paths. Log it, return a generic.
    logger.error(`createTenant failed for slug "${slug}" (${e?.code || 'no code'})`, e);

    // Say what went wrong where we can name it safely.
    const reason = describeCreateFailure(e);
    throw new ApiError(500,
      reason || 'The organisation could not be created, and the reason was not one we recognise. '
        + `Nothing was left behind. Quote this when reporting it: ${e?.code || 'unknown'}.`,
      { failure_code: e?.code || null });
  } finally {
    if (conn) await conn.end();
  }
}

// PATCH /tenants/:id - rename / re-slug / suspend
const TENANT_STATUSES = ['active', 'suspended', 'pending'];

/*
 * Suspending a tenant is not cosmetic: resolveTenant() refuses a suspended organisation,
 * so its users are turned away at login and every authenticated request fails tenant
 * resolution.
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
    if (slug.length < 2 || slug.length > 30) throw badRequest('Org code must be 2-30 characters.');
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
    // The default tenant is the fallback every slug-less login lands on. Suspending it would
    // lock out anyone who signs in without an org code.
    if (status !== 'active' && t.is_default) {
      throw badRequest('The default organisation cannot be suspended.');
    }
    updates.push('status = ?');
    params.push(status);

    // Only on the transition into suspension, never on a re-save of a row that is already
    // suspended - the tenants screen sends `status` with the rest of the form, and clearing
    // the note on an unrelated rename would silently convert a billing hold into a hard one.
    if (status === 'suspended' && t.status !== 'suspended') {
      updates.push('billing_note = ?');
      params.push('Suspended by IFQM.');
    }
  }

  if (!updates.length) throw badRequest('Nothing to update.');

  params.push(tenantId);
  await masterDb().execute(`UPDATE tenants SET ${updates.join(', ')} WHERE id = ?`, params);
  logger.info(`platform: tenant ${t.slug} updated (${updates.join(', ')})`);

  const [rows] = await masterDb().execute('SELECT * FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
  return { success: true, tenant: safeTenant(rows[0]) };
}

// POST /tenants/:id/reset-admin-password
/** Issue a temporary password for a locked-out tenant admin. */
export async function resetTenantAdminPassword(tenantId, body) {
  const t = await requireTenantRow(tenantId);
  const email = String(body?.admin_email ?? '').trim().toLowerCase();
  if (!email) throw badRequest('Admin email is required.');

  try {
    const db = getTenantPool(t);
    const [rows] = await db.execute(
      "SELECT id, name, email, role FROM users WHERE email = ? AND role IN ('admin','super_admin') LIMIT 1",
      [email]
    );
    const admin = rows[0];
    // Deliberately scoped to admins: this endpoint must not become a way for the vendor to
    // take over an ordinary employee's account and read their ideas.
    if (!admin) throw notFound('No admin account with that email in this organisation.');

    const tempPassword = crypto.randomBytes(9).toString('base64url'); // 12 chars, meets the policy
    await db.execute(
      `UPDATE users
          SET password_hash = ?, must_change_password = 1, password_changed_at = NOW()
        WHERE id = ?`,
      [await bcrypt.hash(tempPassword, 12), admin.id]
    );

    logger.info(`platform: admin password reset for ${email} @ ${t.slug}`);

    const { sendTemporaryPassword } = await import('./mailerService.js');
    const emailed = await sendTemporaryPassword({
      email: admin.email, name: admin.name || admin.email, orgName: t.name,
      slug: t.slug, password: tempPassword, reason: 'reset',
    });

    return {
      success: true,
      admin_email: admin.email,
      // Kept on screen whether or not the mail went: see the note on sendTemporaryPassword.
      temp_password: tempPassword,
      password_emailed: emailed,
      note: emailed
        ? `Emailed to ${admin.email}. Shown once here as well. The admin must change it at next sign-in.`
        : 'The email could not be sent - pass this on yourself. Shown once, and must be '
          + 'changed at next sign-in.',
    };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(503, 'Tenant database is unavailable.');
  }
}

// DELETE /tenants/:id
/** Remove an organisation. */
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
      // Identifier, so it cannot be a bound parameter - the name comes from our own registry and
      // createTenant built it as 'ifqm_' + a sanitised slug, but re-check rather than trust the
      // row.
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

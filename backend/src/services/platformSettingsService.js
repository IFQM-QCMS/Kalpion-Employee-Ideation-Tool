/**
 * Platform settings — the IFQM side of configuration.
 *
 * Four things live here:
 *   1. defaults for newly provisioned tenants (ifqm_master.platform_settings)
 *   2. read/write of an existing tenant's own org_settings
 *   3. platform admin accounts (ifqm_master.platform_admins)
 *   4. a read-only health view
 *
 * ── How this sits with the privacy contract ────────────────────────────────
 * Settings are configuration, not people: SLA days and feature flags say nothing
 * about any employee, so editing them does not breach the boundary in
 * platformService.js. Two things still need care and are handled below:
 *
 *   • smtp_pass is a live credential belonging to the customer. It is never
 *     returned at all (see "Why there is no password mask here" below) — the
 *     vendor can point a tenant at a mail server without ever being shown
 *     their mail password.
 *   • the health view counts rows and bytes. It must never list what is in them.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { masterDb } from '../database/master.js';
import config from '../config/index.js';
import { getTenantPool } from '../database/tenant.js';
import { badRequest, notFound, ApiError } from '../utils/respond.js';
import { assertPasswordStrength } from './authService.js';
// The same rule the tenant console applies, not a second copy of it.
import { isValidPhone } from './userService.js';
import { STAGE_CATALOG, DEFAULT_STAGES } from './approvalStages.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_BASE = path.join(__dirname, '..', '..', 'uploads');

/**
 * ── Why there is no password mask here ──────────────────────────────────────
 *
 * The obvious design — return "••••••••" for a set password and skip writing
 * when that exact string comes back — is what the tenant's own settings service
 * does, and it is unsafe. The sentinel only works if the decoration survives a
 * round trip through the client, HTTP, and the driver byte-for-byte. It does
 * not: sent through this API the bullets came back as something that matched
 * neither the mask nor a glyph filter, and were written into the database AS the
 * customer's mail password. A working mail configuration was destroyed by a
 * request that meant "don't change my password".
 *
 * So the mask is gone. The rule is now unambiguous and has nothing to encode:
 *
 *   read   → smtp_pass is NEVER returned; the client gets smtp_pass_set: bool
 *   write  → empty/absent  = leave the stored password alone
 *            non-empty     = the operator typed a new one, save it
 *            smtp_pass_clear: true = deliberately remove it
 *
 * Because no mask is ever sent, no client can echo one back, and no encoding
 * can turn "keep it" into "overwrite it with garbage".
 */

/**
 * Defaults a new tenant is born with. SMTP is deliberately absent: a mail server
 * is per-organisation, and a shared default would silently point every new
 * tenant's outbound mail at one account.
 */
const DEFAULTS_WHITELIST = [
  'review_sla_days', 'escalation_days', 'anonymous_allowed', 'public_board_enabled',
  'challenges_enabled', 'approval_stages',
  // Billing. These are platform-wide policy, not per-organisation settings:
  // how long a new organisation evaluates for, when it starts being warned,
  // whether lapsing actually locks anybody out, and who to contact about it.
  'default_trial_days', 'billing_warn_days', 'billing_enforce',
  'billing_contact_email', 'billing_contact_phone',
  // Request allowances: whether the plan's limit is enforced, how far over is
  // tolerated, and where the warning starts.
  'quota_enforce', 'quota_grace_percent', 'quota_warn_percent',
  /*
   * The attachment ceiling every organisation is bounded by.
   *
   * Deliberately named apart from the tenant's own `max_file_mb`: the two live
   * in different tables and mean different things — this is the most any
   * organisation may be allowed, that is what one organisation has chosen for
   * itself — and one name for both would be read as one setting.
   *
   * It is NOT in NEW_TENANT_KEYS. A platform ceiling copied into a customer's
   * own settings would become a number they could edit, which is the opposite
   * of a ceiling.
   */
  'platform_max_file_mb',
  // How many months of ACCESS logs to keep. Approval history and billing
  // records are never purged — see retentionService for why that distinction
  // is the whole point.
  'log_retention_months',
];

/**
 * Which of those are actually SEEDED into a new organisation.
 *
 * The list above answers "what may a platform admin edit here". This answers a
 * different question — "what does a new organisation start with" — and
 * conflating them meant adding billing policy to the console silently copied
 * `billing_enforce`, `quota_grace_percent` and the rest into every new tenant's
 * org_settings, where they mean nothing and nobody can edit them.
 *
 * Billing and quota policy is platform-wide by definition. It belongs in the
 * registry, not in each customer's own settings table.
 */
const NEW_TENANT_KEYS = [
  'review_sla_days', 'escalation_days', 'anonymous_allowed', 'public_board_enabled',
  'challenges_enabled', 'approval_stages',
];

/** Mirrors settingsService's whitelist — what IFQM may change on a live tenant. */
const TENANT_SETTINGS_WHITELIST = [
  'review_sla_days', 'escalation_days', 'anonymous_allowed', 'public_board_enabled',
  'challenges_enabled', 'email_enabled', 'smtp_host', 'smtp_port', 'smtp_user',
  'smtp_pass', 'smtp_from', 'smtp_from_name',
  // One ordered chain, one key. The mode/role-list/threshold keys that used to
  // sit here described the same chain three other ways and are gone.
  'approval_stages',
];

/** Coerce a settings value the same way the tenant's own settings screen does. */
function normaliseSetting(key, rawValue) {
  let value = rawValue;
  if (key === 'approval_stages') {
    // Same rule as settingsService: unknown stage keys are dropped, the
    // originator is implicit and first, and a chain with no approver in it is
    // refused rather than stored.
    const stages = [...new Set(
      String(value).split(',').map((s) => s.trim()).filter((s) => STAGE_CATALOG[s] && s !== 'originator')
    )];
    if (!stages.length) return null;
    return ['originator', ...stages].join(',');
  }
  /*
   * Bounded by MAX_FILE_MB from the environment, which stays the hard limit.
   * The console decides policy; the server decides what it will physically
   * accept, and a console that could raise the figure past multer's own limit
   * would be promising uploads that fail at the door.
   */
  if (key === 'platform_max_file_mb') {
    const n = parseInt(value, 10);
    return String(Math.max(1, Math.min(config.maxFileMb, Number.isFinite(n) ? n : config.maxFileMb)));
  }
  /*
   * Floored at six months. A window short enough to delete this quarter's
   * sign-ins would take the lockout counters and the SMS delivery evidence with
   * it, and somebody would only find that out while investigating an incident.
   */
  if (key === 'log_retention_months') {
    const n = parseInt(value, 10);
    return String(Math.max(6, Math.min(120, Number.isFinite(n) ? n : 24)));
  }
  if (key === 'review_sla_days' || key === 'escalation_days') {
    return String(Math.max(1, Math.min(365, parseInt(value, 10) || 1)));
  }
  // Zero is a real answer here - "no trial, billing starts on day one" - so it
  // is clamped rather than treated as unset.
  if (key === 'default_trial_days') {
    const n = parseInt(value, 10);
    return String(Math.max(0, Math.min(365, Number.isFinite(n) ? n : 14)));
  }
  if (key === 'billing_warn_days') {
    const n = parseInt(value, 10);
    return String(Math.max(0, Math.min(90, Number.isFinite(n) ? n : 5)));
  }
  if (key === 'billing_enforce' || key === 'quota_enforce') {
    return value === '1' || value === 1 || value === true ? '1' : '0';
  }
  if (key === 'quota_grace_percent') {
    const n = parseInt(value, 10);
    return String(Math.max(0, Math.min(200, Number.isFinite(n) ? n : 20)));
  }
  if (key === 'quota_warn_percent') {
    const n = parseInt(value, 10);
    return String(Math.max(1, Math.min(100, Number.isFinite(n) ? n : 80)));
  }
  return String(value);
}

/**
 * One platform setting by name.
 *
 * The billing services need a single value on a hot path (every sweep, every
 * approval), and pulling the whole settings table to read one row is wasteful.
 * Returns null when the key has never been written, so the caller can apply its
 * own default rather than being handed an empty string that looks deliberate.
 */
export async function getPlatformSetting(key) {
  try {
    const [[row]] = await masterDb().execute(
      'SELECT value FROM platform_settings WHERE key_name = ? LIMIT 1', [String(key)]
    );
    return row ? row.value : null;
  } catch {
    // A missing settings table must not take down whatever asked.
    return null;
  }
}

/**
 * The largest attachment any organisation may permit, in MB.
 *
 * Falls back to the environment when unset or unreadable, and is clamped by it
 * in every case — see the note on the normaliser above.
 */
export async function platformFileCeilingMb() {
  const raw = await getPlatformSetting('platform_max_file_mb');
  const n = parseInt(raw, 10);
  const wanted = Number.isFinite(n) && n > 0 ? n : config.maxFileMb;
  return Math.max(1, Math.min(config.maxFileMb, wanted));
}

// ── 1. New-tenant defaults ─────────────────────────────────────────

export async function getDefaults() {
  const [rows] = await masterDb().query('SELECT key_name, value FROM platform_settings');
  const defaults = Object.fromEntries(rows.map((r) => [r.key_name, r.value]));
  return { success: true, defaults };
}

export async function updateDefaults(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('No settings provided.');

  let updated = 0;
  for (const [key, raw] of Object.entries(body)) {
    if (!DEFAULTS_WHITELIST.includes(key)) continue;
    const value = normaliseSetting(key, raw);
    if (value === null) continue;
    await masterDb().execute(
      `INSERT INTO platform_settings (key_name, value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [key, value]
    );
    updated++;
  }
  if (!updated) throw badRequest('Nothing to update.');
  logger.info(`platform: new-tenant defaults updated (${updated} key(s))`);
  return { success: true, updated };
}

/**
 * The seed list createTenant() writes into a brand-new tenant's org_settings.
 * Falls back to the built-in values if the table is empty or unreachable, so
 * provisioning never breaks because a settings row is missing.
 */
export async function defaultsForNewTenant() {
  const BUILT_IN = [
    ['approval_stages', DEFAULT_STAGES.join(',')],
  ];
  try {
    const [rows] = await masterDb().query('SELECT key_name, value FROM platform_settings');
    if (!rows.length) return BUILT_IN;
    return rows.filter((r) => NEW_TENANT_KEYS.includes(r.key_name)).map((r) => [r.key_name, r.value]);
  } catch (e) {
    logger.warn('platform_settings unreadable, using built-in tenant defaults', e.message);
    return BUILT_IN;
  }
}

// ── 2. Per-tenant settings override ────────────────────────────────

async function tenantRow(tenantId) {
  const [rows] = await masterDb().execute('SELECT * FROM tenants WHERE id = ? LIMIT 1', [Number(tenantId) || 0]);
  if (!rows[0]) throw notFound('Tenant not found.');
  return rows[0];
}

export async function getTenantSettings(tenantId) {
  const t = await tenantRow(tenantId);
  try {
    const db = getTenantPool(t);
    const [rows] = await db.query('SELECT key_name, value FROM org_settings');
    const settings = Object.fromEntries(rows.map((r) => [r.key_name, r.value]));

    // The customer's mail password never leaves their database — not even
    // disguised. The client is told only whether one is set.
    settings.smtp_pass_set = !!settings.smtp_pass;
    delete settings.smtp_pass;

    return { success: true, tenant: { id: t.id, name: t.name, slug: t.slug }, settings };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(503, 'Tenant database is unavailable.');
  }
}

export async function updateTenantSettings(tenantId, body) {
  const t = await tenantRow(tenantId);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('No settings provided.');

  try {
    const db = getTenantPool(t);
    const write = async (key, value) => {
      await db.execute(
        `INSERT INTO org_settings (key_name, value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value)`,
        [key, value]
      );
    };

    let updated = 0;
    for (const [key, raw] of Object.entries(body)) {
      if (!TENANT_SETTINGS_WHITELIST.includes(key)) continue;
      // Handled below, explicitly — never through the generic path.
      if (key === 'smtp_pass') continue;
      const value = normaliseSetting(key, raw);
      if (value === null) continue;
      await write(key, value);
      updated++;
    }

    // smtp_pass: only ever written on unambiguous intent.
    if (body.smtp_pass_clear === true) {
      await write('smtp_pass', '');
      updated++;
    } else if (String(body.smtp_pass ?? '').trim()) {
      await write('smtp_pass', String(body.smtp_pass));
      updated++;
    }
    if (!updated) throw badRequest('Nothing to update.');
    logger.info(`platform: org_settings updated for ${t.slug} (${updated} key(s))`);
    return { success: true, updated };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(503, 'Tenant database is unavailable.');
  }
}

// ── 3. Platform admin accounts ─────────────────────────────────────

export async function listAdmins() {
  /*
   * The verification state travels with the list.
   *
   * An account that has not proved its address is one nobody can send a reset
   * to, and an account grandfathered past migration 039 has no number on file
   * at all. Neither fact is visible from a name and an email, so the console
   * would show a tidy list of accounts with no way to tell the difference
   * between one that is reachable and one that is not.
   */
  const [rows] = await masterDb().query(
    `SELECT id, name, email, phone, created_at, email_verified_at, phone_verified_at
       FROM platform_admins ORDER BY id`
  );
  return {
    success: true,
    admins: rows.map((a) => ({
      ...a,
      email_verified: !!a.email_verified_at,
      phone_verified: !!a.phone_verified_at,
      verified: !!(a.email_verified_at && a.phone_verified_at),
      // Grandfathered: trusted from before the rule existed, and never actually
      // asked to prove anything. Worth naming rather than showing a green tick.
      predates_verification: !!a.email_verified_at && !a.phone,
    })),
  };
}

export async function createAdmin(body) {
  const name = String(body?.name ?? '').trim();
  const email = String(body?.email ?? '').trim().toLowerCase();
  const phone = String(body?.phone ?? '').trim();
  const password = body?.password ?? '';

  if (!name || !email) throw badRequest('Name and email are required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Invalid email address.');
  /*
   * A number is required, and it is not paperwork.
   *
   * This account is verified on two independent channels before it can do
   * anything, and "two channels" means two — an account with only an address
   * can be taken by whoever holds that mailbox, which for a credential that
   * reaches every tenant on the platform is the whole risk in one sentence.
   * It is also the only way back in when the address stops working.
   */
  if (!phone) throw badRequest('A mobile number is required. The account is verified on both channels before it can be used.');
  if (!isValidPhone(phone)) {
    throw badRequest('Enter a valid mobile number, including the country or area code.');
  }
  // A platform admin can reach every tenant in the product. Same policy as a
  // tenant super user, at minimum.
  assertPasswordStrength(password, { label: 'Password' });

  const [dup] = await masterDb().execute('SELECT id FROM platform_admins WHERE email = ? LIMIT 1', [email]);
  if (dup.length) throw new ApiError(409, 'A platform admin with that email already exists.');

  /*
   * MOM §12.11 — a soft cap of 5. Soft because the MOM said soft: it is a
   * governance signal, not a licence check, so it is stored in platform_settings
   * and an operator who genuinely needs a sixth can raise it rather than being
   * blocked by a constant nobody can reach. Every one of these accounts can
   * reach every tenant, so the number should stay small and deliberate.
   */
  const [[cap] = []] = await masterDb().execute(
    "SELECT value FROM platform_settings WHERE key_name = 'max_platform_admins' LIMIT 1"
  );
  const maxAdmins = parseInt(cap?.value, 10) || 5;
  const [[{ n: adminCount }]] = await masterDb().query('SELECT COUNT(*) AS n FROM platform_admins');
  if (Number(adminCount) >= maxAdmins) {
    throw new ApiError(409,
      `The platform admin limit of ${maxAdmins} has been reached. Remove an existing admin, `
      + 'or raise the limit in Platform Settings, before adding another.');
  }

  /*
   * Created UNVERIFIED, and the codes are not sent from here.
   *
   * The person being given this account is not at the keyboard — somebody else
   * is creating it for them. Sending both codes now would put them in a mailbox
   * and a handset that nobody is watching, where they expire in five minutes,
   * long before the new admin first signs in. The account would then look
   * broken on the one screen it is allowed to reach.
   *
   * So the proofs are collected at first sign-in, when the right person is
   * present and asking for them. Until both are recorded the session can do
   * exactly one thing: verify itself. See enforcePlatformAdminVerification.
   */
  const [res] = await masterDb().execute(
    'INSERT INTO platform_admins (name, email, phone, password_hash) VALUES (?, ?, ?, ?)',
    [name, email, phone, await bcrypt.hash(password, 12)]
  );
  logger.info(`platform: admin account created, awaiting verification (${email})`);
  return {
    success: true,
    id: res.insertId,
    name,
    email,
    phone,
    verification_required: true,
    message: `${name} can now sign in. They will be asked to verify ${email} and the mobile `
      + 'number by one-time code before the console will do anything else for them.',
  };
}

/**
 * Remove a platform admin.
 *
 * Two locks: you cannot delete yourself (an operator removing their own account
 * mid-session is never what they meant), and you cannot delete the last one —
 * there is no UI to create a platform admin without already being one, so an
 * empty table means the console is unreachable until someone edits SQL.
 */
export async function deleteAdmin(currentAdmin, id) {
  const targetId = Number(id) || 0;
  const currentId = Number(String(currentAdmin?.id || '').replace(/^pa_/, ''));
  if (targetId === currentId) throw badRequest('You cannot delete your own account.');

  const [rows] = await masterDb().execute('SELECT id, email FROM platform_admins WHERE id = ? LIMIT 1', [targetId]);
  const target = rows[0];
  if (!target) throw notFound('Platform admin not found.');

  const [[{ c }]] = await masterDb().query('SELECT COUNT(*) AS c FROM platform_admins');
  if (Number(c) <= 1) throw badRequest('Cannot delete the last platform admin.');

  await masterDb().execute('DELETE FROM platform_admins WHERE id = ?', [targetId]);
  logger.info(`platform: admin account deleted (${target.email})`);
  return { success: true, deleted: target.email };
}

/** Change your own platform-admin password. Requires the current one. */
export async function changeOwnPassword(currentAdmin, body) {
  const currentId = Number(String(currentAdmin?.id || '').replace(/^pa_/, ''));
  if (!currentId) throw badRequest('Not a platform admin account.');

  const [rows] = await masterDb().execute('SELECT id, password_hash FROM platform_admins WHERE id = ? LIMIT 1', [currentId]);
  const row = rows[0];
  if (!row) throw notFound('Account no longer exists.');

  // Proving possession of the current password is what stops a borrowed, still
  // signed-in browser from being turned into a permanent takeover.
  if (!(await bcrypt.compare(String(body?.current_password ?? ''), row.password_hash))) {
    throw badRequest('Current password is incorrect.');
  }
  const next = assertPasswordStrength(body?.new_password, { label: 'New password' });
  await masterDb().execute('UPDATE platform_admins SET password_hash = ? WHERE id = ?', [await bcrypt.hash(next, 12), currentId]);

  logger.info(`platform: admin ${currentId} changed their password`);
  return { success: true };
}

// ── 4. Health ──────────────────────────────────────────────────────

/** Total bytes under a directory. Counts size; never reads content. */
async function dirSize(dir) {
  let total = 0;
  let files = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { bytes: 0, files: 0 };
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await dirSize(full);
      total += sub.bytes;
      files += sub.files;
    } else {
      try {
        const st = await fs.stat(full);
        total += st.size;
        files++;
      } catch { /* vanished between readdir and stat */ }
    }
  }
  return { bytes: total, files };
}

export async function health() {
  const out = { success: true, master_db: 'unknown', tenants: [], uploads: { bytes: 0, files: 0 } };

  try {
    await masterDb().query('SELECT 1');
    out.master_db = 'ok';
  } catch (e) {
    out.master_db = 'unreachable';
    logger.error('health: master DB unreachable', e.message);
    return out;
  }

  const [rows] = await masterDb().query('SELECT * FROM tenants ORDER BY created_at ASC');
  for (const t of rows) {
    const entry = { id: t.id, name: t.name, slug: t.slug, status: t.status, db: 'ok', users: 0, ideas: 0, uploads_bytes: 0 };
    try {
      const db = getTenantPool(t);
      const [[u]] = await db.query('SELECT COUNT(*) AS c FROM users');
      const [[i]] = await db.query('SELECT COUNT(*) AS c FROM ideas');
      entry.users = Number(u.c);
      entry.ideas = Number(i.c);
    } catch {
      entry.db = 'unreachable';
    }
    const size = await dirSize(path.join(UPLOADS_BASE, t.slug));
    entry.uploads_bytes = size.bytes;
    entry.uploads_files = size.files;
    out.uploads.bytes += size.bytes;
    out.uploads.files += size.files;
    out.tenants.push(entry);
  }

  return out;
}

export default {
  getDefaults, updateDefaults, defaultsForNewTenant,
  getTenantSettings, updateTenantSettings,
  listAdmins, createAdmin, deleteAdmin, changeOwnPassword,
  health,
};

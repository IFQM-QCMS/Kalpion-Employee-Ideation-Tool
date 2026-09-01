/**
 * User service — Node port of the user-management actions in PHP api/users.php:
 *   list, admin_users, create_user, update_user, delete_user, managers,
 *   hierarchy, profile.
 *
 * (The leaderboard / notifications / analytics / audit actions that also live
 * in users.php are cross-cutting and are migrated with their own modules.)
 *
 * All role checks, validation order, SQL, and response shapes mirror the PHP
 * exactly. "Departments" are a free-text `users.department` column — there is
 * no departments table in the source app.
 */
import bcrypt from 'bcryptjs';
import { badRequest, forbidden, notFound, ApiError } from '../utils/respond.js';
import { assertPasswordStrength } from './authService.js';
import { tempPasswordFor, randomTempPassword } from './userImportService.js';
import {
  indexUser, deindexUser, isUsername, claimUsername, usernameAvailable, releaseUsername,
} from './directoryService.js';
import logger from '../utils/logger.js';

// Role sets used across create/update/managers (mirrors the PHP literals).
const ROLES_ADMIN_CAN_ASSIGN = [
  'trainee', 'employee', 'team_lead', 'project_lead', 'manager', 'department_manager',
  'senior_manager', 'plant_head', 'executive',
];
const ROLES_SUPER_ADMIN_CAN_ASSIGN = [...ROLES_ADMIN_CAN_ASSIGN, 'admin'];

/*
 * Roles an organisation may fill exactly once.
 *
 * A plant runs one plant head. That is not an arbitrary policy — it is what
 * makes the last step of the approval chain mean something. With two of them,
 * "final approval" becomes "approval by whichever plant head the router picked",
 * and an idea's fate depends on a tie-break nobody chose. The stage is the one
 * that releases an idea to QCMS, so the ambiguity is at the most consequential
 * point in the whole flow.
 *
 * Per organisation, because that is the only scope where it means anything: two
 * customers each having a plant head is normal, and each tenant's users live in
 * that tenant's own database, so the count below is naturally scoped.
 *
 * Enforced on every route into the users table — the console, the bulk import,
 * the API — because a rule enforced in one of them is a rule that gets around.
 */
const SINGLETON_ROLES = {
  plant_head: 'Plant Head',
};

/**
 * Refuse a role that is already taken.
 *
 * `exceptUserId` lets an edit re-save the person who already holds it without
 * tripping over their own row — otherwise changing a plant head's phone number
 * would fail because a plant head exists.
 *
 * Deactivated holders do not count. Somebody who has left should not block the
 * appointment of their successor, and the alternative is an administrator who
 * has to know to go and edit a departed employee's record first.
 */
async function assertRoleVacant(db, role, exceptUserId = null) {
  const label = SINGLETON_ROLES[role];
  if (!label) return;

  const [rows] = await db.execute(
    `SELECT id, name, employee_id FROM users
      WHERE role = ? AND status = 'active' AND id <> ? LIMIT 1`,
    [role, exceptUserId || 0]
  );
  if (!rows.length) return;

  const held = rows[0];
  throw new ApiError(409,
    `${label} is already held by ${held.name}${held.employee_id ? ` (${held.employee_id})` : ''}. `
    + `An organisation has one ${label}: the chain ends there, so two of them would mean `
    + `an idea's final approval depended on which one it happened to reach. `
    + `Change ${held.name} to another role first, or deactivate that account.`);
}

/** Which singleton roles are already taken, for the console to grey out. */
export async function takenSingletonRoles(db) {
  const roles = Object.keys(SINGLETON_ROLES);
  if (!roles.length) return {};
  const [rows] = await db.query(
    `SELECT role, id, name FROM users WHERE status = 'active' AND role IN (?)`, [roles]);
  const out = {};
  for (const r of rows) {
    // First holder wins the label. A tenant that already had two before this
    // rule existed is reported by singletonConflicts() below.
    if (!out[r.role]) out[r.role] = { user_id: r.id, name: r.name, label: SINGLETON_ROLES[r.role] };
  }
  return out;
}

/**
 * Singleton roles this organisation holds MORE than once.
 *
 * The guards above stop a second plant head being appointed from today. They
 * cannot undo one appointed yesterday, and at least one live tenant has two.
 *
 * Demoting one automatically was considered and rejected. Picking which of two
 * real people loses their authority is a decision about the organisation, not
 * about the data — and it would happen silently, to somebody who would find out
 * when an idea they expected stopped arriving. So the conflict is reported to
 * the administrators, repeatedly, and they choose.
 *
 * Meanwhile nothing is broken: routing walks the submitter's reporting line, so
 * in an organisation with a filled-in org chart each idea still reaches exactly
 * one of them — the right one. The ambiguity only bites where the line runs out.
 */
export async function singletonConflicts(db) {
  const roles = Object.keys(SINGLETON_ROLES);
  if (!roles.length) return [];
  const [rows] = await db.query(
    `SELECT role, id, name, employee_id FROM users
      WHERE status = 'active' AND role IN (?) ORDER BY role, id`, [roles]);

  const byRole = new Map();
  for (const r of rows) {
    if (!byRole.has(r.role)) byRole.set(r.role, []);
    byRole.get(r.role).push(r);
  }
  return [...byRole.entries()]
    .filter(([, holders]) => holders.length > 1)
    .map(([role, holders]) => ({ role, label: SINGLETON_ROLES[role], holders }));
}

/**
 * Every role that can appear on a user row — the vocabulary the admin console's
 * role filter offers (MOM §13.9). Wider than the assignable lists above:
 * super_admin cannot be assigned through the UI but certainly exists, and
 * filtering it out of the filter would hide those accounts from the one screen
 * meant to show them.
 */
const ALL_ROLES = [...ROLES_SUPER_ADMIN_CAN_ASSIGN, 'super_admin'];

/**
 * The single source of truth for "which roles may this actor hand out".
 *
 * Exported so the bulk importer enforces the SAME rule as single-user creation.
 * A tenant admin must not be able to mint another `admin` (or a `super_admin`)
 * by typing it into a spreadsheet cell — the import validates every row's role
 * through this function, so escalation via import is impossible by construction.
 */
export const assignableRoles = (actorRole) =>
  actorRole === 'super_admin' ? ROLES_SUPER_ADMIN_CAN_ASSIGN : ROLES_ADMIN_CAN_ASSIGN;

/**
 * Avatar initials — matches PHP:
 *   implode('', array_map(fn($w)=>strtoupper($w[0]),
 *     array_slice(array_filter(explode(' ', $name)), 0, 2)))
 */
function avatarInitials(name) {
  return String(name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

const firstCharUpper = (s) => (s ? s.charAt(0).toUpperCase() : '');

/** GET action=list — search users (excludes self), LIMIT 20. */
export async function list(db, actor, q) {
  const like = `%${String(q || '').trim()}%`;
  const [rows] = await db.execute(
    `SELECT id, employee_id, name, department, email, role, avatar_initials
       FROM users WHERE (name LIKE ? OR employee_id LIKE ? OR email LIKE ?)
       AND id != ? LIMIT 20`,
    [like, like, like, actor.id]
  );
  return { success: true, users: rows };
}

/**
 * GET action=admin_users — the admin console's user list.
 *
 * Paginated and searched in SQL. It used to return every user in the tenant in
 * one payload, which was fine for the dozens of accounts an admin created by
 * hand — but bulk import can put 10,000 employees in here, and shipping all of
 * them to the browser (and rendering every row) would hang the very page the
 * admin lands on straight after importing.
 *
 * The response still includes `users`, so an older client keeps working; it just
 * gets the first page.
 */
export async function adminUsers(db, { q = '', page = 1, limit = 50, role = '', department = '', status = '', manager_id: managerId = '' } = {}) {
  const search = String(q || '').trim();
  /*
   * These two are built into the statement text rather than bound, because
   * MySQL 8.4 rejects LIMIT and OFFSET as prepared-statement parameters
   * ("Incorrect arguments to mysqld_stmt_execute"). MariaDB accepts them, so
   * this list worked in development and returned 500 in production - an
   * organisation with four employees showed an empty user list.
   *
   * Safe, and stays safe: both go through parseInt and a clamp on the two lines
   * below, so only a plain number can ever reach the string.
   */
  const perPage = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (pageNum - 1) * perPage;

  const where = [];
  const params = [];
  if (search) {
    // Username is searchable too — for an account created without an address it
    // is the only thing an admin has to look the person up by.
    where.push('(u.name LIKE ? OR u.email LIKE ? OR u.employee_id LIKE ? OR u.username LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  /*
   * MOM §13.9 — filter by role, department, status or manager.
   *
   * Every one of these narrows the SQL rather than the rendered page, which is
   * the whole point of the item: the admin console must never pull the entire
   * user table into the browser to filter it there. Pagination already worked
   * that way; these filters had to join it rather than undo it.
   */
  if (ALL_ROLES.includes(String(role))) {
    where.push('u.role = ?');
    params.push(String(role));
  }
  if (String(department).trim()) {
    where.push('u.department = ?');
    params.push(String(department).trim());
  }
  if (['active', 'inactive'].includes(String(status))) {
    where.push('u.status = ?');
    params.push(String(status));
  }
  if (Number(managerId)) {
    where.push('u.manager_id = ?');
    params.push(Number(managerId));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [countRows] = await db.execute(
    `SELECT COUNT(*) AS total FROM users u ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.total || 0);

  const [rows] = await db.execute(
    `SELECT u.id, u.employee_id, u.username, u.name, u.department, u.business_unit, u.location,
            u.email, u.role, u.avatar_initials, u.points, u.status, u.manager_id,
            u.must_change_password, u.activated_at,
            m.name AS manager_name
       FROM users u LEFT JOIN users m ON m.id=u.manager_id
       ${whereSql}
      ORDER BY FIELD(u.role,'admin','executive','plant_head','senior_manager','department_manager','manager','project_lead','team_lead','employee','trainee'), u.name
      LIMIT ${perPage} OFFSET ${offset}`,
    params
  );

  // The department list comes from the data, not a constant: an org's
  // departments are whatever its import sheet contained.
  const [departments] = await db.query(
    "SELECT DISTINCT department FROM users WHERE department IS NOT NULL AND department != '' ORDER BY department"
  );

  return {
    success: true,
    users: rows,
    total,
    page: pageNum,
    limit: perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
    filters: {
      roles: ALL_ROLES,
      departments: departments.map((d) => d.department),
    },
  };
}

/**
 * GET /api/users/:id/chain — MOM §13.8.
 *
 * One person's full reporting line, upward to the top and one level down. The
 * admin screen used to make you click manager-by-manager to answer "who does
 * this idea escalate to?"; this answers it in one call.
 *
 * The upward walk is bounded and cycle-guarded. A manager loop (A reports to B
 * reports to A) is a data error an admin can create in two clicks, and without
 * the guard it is an infinite loop inside a request.
 */
export async function reportingChain(db, userId) {
  const id = Number(userId) || 0;
  if (!id) throw badRequest('User id required.');

  const [[start]] = await db.execute(
    `SELECT u.id, u.name, u.employee_id, u.role, u.department, u.email, u.avatar_initials, u.manager_id
       FROM users u WHERE u.id = ? LIMIT 1`,
    [id]
  );
  if (!start) throw notFound('User not found');

  const chain = [];
  const seen = new Set([start.id]);
  let cursor = start.manager_id;
  // 12 levels is far deeper than any real org chart; hitting it means a cycle
  // the seen-set somehow missed, and stopping beats spinning.
  for (let depth = 0; cursor && depth < 12; depth++) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const [[mgr]] = await db.execute(
      `SELECT id, name, employee_id, role, department, email, avatar_initials, manager_id
         FROM users WHERE id = ? LIMIT 1`,
      [cursor]
    );
    if (!mgr) break;
    chain.push(mgr);
    cursor = mgr.manager_id;
  }

  const [reports] = await db.execute(
    `SELECT id, name, employee_id, role, department, avatar_initials
       FROM users WHERE manager_id = ? ORDER BY name LIMIT 100`,
    [id]
  );

  return {
    success: true,
    user: start,
    chain,               // immediate manager first, up to the top
    direct_reports: reports,
  };
}

/** POST action=create_user. */
export async function createUser(db, actor, body, tenant = null) {
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const username = String(body.username || '').trim().toLowerCase();
  const employeeId = String(body.employee_id || '').trim();
  const department = String(body.department || '').trim();
  const businessUnit = String(body.business_unit || '').trim();
  const location = String(body.location || '').trim();
  const phone = String(body.phone || '').trim();
  const role = body.role || 'employee';
  const managerId = body.manager_id ? parseInt(body.manager_id, 10) : null;

  const explicitPassword = body.password || ''; // legacy/optional override

  if (!name || !employeeId) {
    throw badRequest('Name and employee ID are required.');
  }
  /*
   * An address is no longer compulsory (migration 025). Most of the people this
   * platform is for work on a shop floor and have no company mailbox, and the
   * old rule meant somebody had to invent an address before an account could
   * exist at all — which then received nothing, and was still what they had to
   * type to sign in.
   *
   * What IS required is a way to sign in: a username or an address, at least
   * one. Checked together so the message can name the choice rather than
   * complain about whichever field happens to be read first.
   */
  if (!username && !email) {
    throw badRequest('Give the user a username or an email address — at least one is needed to sign in.');
  }
  if (email && !isValidEmail(email)) throw badRequest('Invalid email address.');
  if (username && !isUsername(username)) {
    throw badRequest('A username must be 3-30 characters using letters, numbers, dot, underscore or hyphen, and must contain at least one letter.');
  }
  /*
   * A mobile number is required of every account, however it is created.
   *
   * It is the second way in and the only one that works when the first fails:
   * a sign-in code, a password reset, confirming a change on the account. An
   * employee added without one is fine right up to the morning they cannot get
   * in, at which point the fix needs an administrator who may be the person
   * locked out. Enforced here rather than in the form, because the form is not
   * the only caller.
   */
  if (!phone) throw badRequest('A mobile number is required for every user.');
  if (!isValidPhone(phone)) {
    throw badRequest('Enter a valid mobile number, including the country or area code.');
  }
  if (!assignableRoles(actor.role).includes(role)) throw forbidden('You cannot assign that role.');
  // One plant head per organisation. See SINGLETON_ROLES.
  await assertRoleVacant(db, role);

  const [dup] = await db.execute(
    `SELECT id FROM users
      WHERE (? <> '' AND email = ?) OR employee_id = ? OR (? <> '' AND username = ?)
      LIMIT 1`,
    [email, email, employeeId, username, username]
  );
  if (dup.length) throw new ApiError(409, 'That email, username or employee ID is already in use.');

  // A username is unique across the whole platform, so this cannot be answered
  // from the tenant's own table — the name may be held by another customer.
  if (username && tenant && !(await usernameAvailable(username, { tenantId: tenant.id }))) {
    throw new ApiError(409, `The username "${username}" is already taken.`);
  }

  const initials = avatarInitials(name) || firstCharUpper(name);

  /*
   * ── The first-login credential ─────────────────────────────────────────
   *
   * Three cases, and the same three the bulk import uses — deliberately, so an
   * employee's experience does not depend on which screen an administrator
   * happened to add them from.
   *
   *   an explicit password   an admin typed one; it is a real password and is
   *                          held to the real policy.
   *   an email address       a random password, mailed to them directly. There
   *                          is a private channel, so there is no reason to
   *                          issue a guessable credential.
   *   neither                the derived formula: first 4 letters of the
   *                          NAME plus the last 4 digits of the phone.
   *                          Guessable, and the only option when there is
   *                          nowhere to send anything and it has to be read
   *                          out loud — which is also why it is built from the
   *                          name rather than the username: the person being
   *                          told it may not know their username yet.
   *
   * The first two are hashed at 12 and 12; the derived one at 10, because
   * stretching a password that is guessable by design buys nothing.
   */
  const usingExplicit = !!explicitPassword;
  const willEmail = !usingExplicit && !!email;
  const tempPassword = usingExplicit ? explicitPassword
    : willEmail ? randomTempPassword()
      : tempPasswordFor(username, phone, name, employeeId);
  if (usingExplicit) assertPasswordStrength(explicitPassword);
  const hash = await bcrypt.hash(tempPassword, usingExplicit ? 12 : willEmail ? 12 : 10);

  const [result] = await db.execute(
    `INSERT INTO users (employee_id, username, name, email, password_hash, phone,
                        department, business_unit, location, role, manager_id, avatar_initials,
                        status, must_change_password, password_changed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active',?,NOW())`,
    [employeeId, username || null, name, email || null, hash, phone || null,
      department, businessUnit, location, role, managerId, initials, usingExplicit ? 0 : 1]
  );

  /*
   * Claim the username for real, now that there is a user id to own it.
   *
   * The availability check above is advisory — another organisation can claim
   * the same name in the gap between that read and this write. The claim is a
   * single insert against a primary key, so exactly one of them wins; the loser
   * undoes the account it just created rather than leaving an employee holding
   * a username that signs them in to somebody else's database.
   */
  if (tenant && username && !(await claimUsername(tenant, result.insertId, username))) {
    await db.execute('DELETE FROM users WHERE id = ?', [result.insertId]).catch(() => {});
    throw new ApiError(409, `The username "${username}" was taken a moment ago. Please choose another.`);
  }

  // Register the account in the global login directory so it can sign in with
  // email or phone and no org code (best-effort; login self-heals otherwise).
  if (tenant) indexUser(tenant, { id: result.insertId, email, phone }).catch(() => {});

  /*
   * Send it, if there is anywhere to send it.
   *
   * Deliberately awaited, unlike the directory indexing above. That is
   * best-effort because login self-heals without it; this is the only copy of a
   * password that is about to exist nowhere else, and the administrator has to
   * be told NOW whether it arrived — if it did not, they need to fall back to
   * reading a credential out, and they cannot do that after the response has
   * gone.
   */
  let emailed = false;
  if (willEmail) {
    const { sendTemporaryPassword } = await import('./mailerService.js');
    emailed = await sendTemporaryPassword({
      email,
      name,
      orgName: tenant?.name || tenant?.org_name || '',
      slug: tenant?.slug || '',
      password: tempPassword,
      reason: 'onboard',
    }).catch(() => false);
  }

  return {
    success: true,
    user_id: result.insertId,
    /*
     * What the admin is shown, and why it differs per case.
     *
     * A derived password is MEANT to be shown: nobody else can deliver it, so
     * the administrator reads it out. A random one that was emailed is not
     * shown, because showing it would put a live credential on a screen and in
     * a browser's history for no reason — it already reached its owner.
     *
     * Unless it did not. If the send failed, the account exists with a password
     * nobody knows, and hiding it would strand the employee behind a reset they
     * have no reason to attempt. So a failed send returns the password with the
     * failure, and the admin can fall back to handing it over.
     */
    ...(willEmail
      ? (emailed
        ? { password_emailed: true, emailed_to: email }
        : { password_emailed: false, temp_password: tempPassword, email_failed: true })
      : usingExplicit ? {} : { temp_password: tempPassword }),
  };
}

/** POST action=update_user. */
export async function updateUser(db, actor, id, body, tenant = null) {
  id = parseInt(id, 10) || 0;
  if (!id) throw badRequest('Missing user ID.');

  const [tgtRows] = await db.execute(
    'SELECT id, role, email, username FROM users WHERE id=? LIMIT 1', [id]
  );
  const target = tgtRows[0];
  if (!target) throw notFound('User not found.');
  if (target.role === 'super_admin') throw forbidden('Cannot edit super admin.');
  if (id === Number(actor.id)) throw forbidden('Cannot edit your own account here.');

  const name = String(body.name || '').trim();
  const department = String(body.department || '').trim();
  const businessUnit = String(body.business_unit || '').trim();
  const location = String(body.location || '').trim();
  const phone = String(body.phone || '').trim();
  const role = body.role || target.role;
  const managerId = body.manager_id ? parseInt(body.manager_id, 10) : null;
  const status = (body.status || 'active') === 'inactive' ? 'inactive' : 'active';
  /*
   * A username is only touched when the field is actually present in the
   * request. Absent means "leave it alone"; an explicit empty string means
   * "remove it" — which is refused below if it would leave the account with no
   * way to sign in.
   */
  const usernameGiven = body.username !== undefined;
  const username = String(body.username || '').trim().toLowerCase();

  if (!assignableRoles(actor.role).includes(role)) throw forbidden('You cannot assign that role.');
  // Excepting this user, so re-saving the sitting plant head is not blocked by
  // their own existence.
  await assertRoleVacant(db, role, id);
  if (usernameGiven && username && !isUsername(username)) {
    throw badRequest('A username must be 3-30 characters using letters, numbers, dot, underscore or hyphen, and must contain at least one letter.');
  }
  if (usernameGiven && !username && !target.email) {
    throw badRequest('This account has no email address, so its username cannot be removed — it would leave no way to sign in.');
  }
  if (usernameGiven && username && username !== (target.username || '')) {
    const [clash] = await db.execute(
      'SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1', [username, id]
    );
    if (clash.length) throw new ApiError(409, 'That username is already in use.');
    if (tenant && !(await usernameAvailable(username, { tenantId: tenant.id, userId: id }))) {
      throw new ApiError(409, `The username "${username}" is already taken.`);
    }
  }
  // Same rule as creation, applied on the way out too: an edit must not be able
  // to remove the only number the account can be recovered through.
  if (!phone) throw badRequest('A mobile number is required for every user.');
  if (!isValidPhone(phone)) {
    throw badRequest('Enter a valid mobile number, including the country or area code.');
  }

  const initials = avatarInitials(name) || firstCharUpper(name);

  // Deactivating an employee now ends their session on their very next request
  // (the auth middleware re-reads status from this row), instead of leaving them
  // logged in for the remaining life of their token. Same for a role change:
  // the new role takes effect immediately rather than after the token expires.
  await db.execute(
    `UPDATE users SET name=?, department=?, business_unit=?, location=?, phone=?, role=?,
                      manager_id=?, avatar_initials=?, status=?,
                      username = IF(?, ?, username),
                      deactivated_at = IF(? = 'inactive', COALESCE(deactivated_at, NOW()), NULL)
      WHERE id=?`,
    [name, department, businessUnit, location, phone || null, role, managerId, initials, status,
      usernameGiven ? 1 : 0, username || null, status, id]
  );

  // A changed or cleared username frees the old one platform-wide, then claims
  // the new one. Released first, so somebody renaming from 'rk' to 'rkumar' and
  // back again is not blocked by their own abandoned name.
  if (tenant && usernameGiven && username !== (target.username || '')) {
    if (target.username) await releaseUsername(target.username);
    if (username) await claimUsername(tenant, id, username);
  }

  // Keep the login directory in step with a changed phone number.
  if (tenant) indexUser(tenant, { id, email: target.email, phone }).catch(() => {});
  return { success: true };
}

/**
 * PUT /users/:id/manager — reassign only who a user reports to.
 *
 * This exists for the admin Hierarchy screen: full updateUser() requires every
 * profile field (and would silently reactivate an inactive account, since it
 * defaults status to 'active'), which is the wrong tool for dragging one
 * reporting line. The idea-escalation engine walks manager_id upward, so a
 * reporting cycle would make an idea ping-pong between the same reviewers
 * forever — reject any assignment that closes a loop.
 */
export async function updateManager(db, actor, id, body) {
  id = parseInt(id, 10) || 0;
  if (!id) throw badRequest('Missing user ID.');

  const [tgtRows] = await db.execute('SELECT id, role FROM users WHERE id=? LIMIT 1', [id]);
  const target = tgtRows[0];
  if (!target) throw notFound('User not found.');
  if (target.role === 'super_admin') throw forbidden('Cannot edit super admin.');

  const managerId = body.manager_id ? parseInt(body.manager_id, 10) : null;

  if (managerId) {
    if (managerId === id) throw badRequest('A user cannot report to themselves.');
    const [mRows] = await db.execute(
      'SELECT id, role, status, manager_id FROM users WHERE id=? LIMIT 1', [managerId]
    );
    const mgr = mRows[0];
    if (!mgr) throw notFound('Manager not found.');
    if (mgr.status !== 'active') throw badRequest('Manager account is inactive.');

    // Walk up from the new manager; if we reach the target, this edge closes a loop.
    let cursor = mgr.manager_id;
    for (let hops = 0; cursor && hops < 100; hops++) {
      if (Number(cursor) === id) {
        throw badRequest('That assignment would create a reporting loop.');
      }
      const [rows] = await db.execute('SELECT manager_id FROM users WHERE id=? LIMIT 1', [cursor]);
      cursor = rows[0]?.manager_id ?? null;
    }
  }

  await db.execute('UPDATE users SET manager_id=? WHERE id=?', [managerId, id]);
  return { success: true };
}

/** POST action=delete_user — deactivates instead if the user has real ideas. */
export async function deleteUser(db, actor, id, tenant = null) {
  id = parseInt(id, 10) || 0;
  if (!id) throw badRequest('Missing user ID.');
  if (id === Number(actor.id)) throw forbidden('Cannot delete your own account.');

  const [tgtRows] = await db.execute('SELECT role FROM users WHERE id=? LIMIT 1', [id]);
  const target = tgtRows[0];
  if (!target) throw notFound('User not found.');
  if (target.role === 'super_admin') throw forbidden('Cannot delete super admin.');

  const [cntRows] = await db.execute(
    "SELECT COUNT(*) AS c FROM ideas WHERE submitter_id=? AND status!='Draft'",
    [id]
  );
  if (Number(cntRows[0].c) > 0) {
    // Offboarding: the account is retained (their ideas must keep an author) but
    // deactivated. The live session check ends any open session immediately.
    await db.execute(
      "UPDATE users SET status='inactive', deactivated_at=COALESCE(deactivated_at, NOW()) WHERE id=?",
      [id]
    );
    return {
      success: true,
      deactivated: true,
      message: 'User has submitted ideas — account deactivated instead of deleted.',
    };
  }

  await db.execute('UPDATE users SET manager_id=NULL WHERE manager_id=?', [id]);
  await db.execute('DELETE FROM users WHERE id=?', [id]);
  if (tenant) deindexUser(tenant.id, id).catch(() => {});
  return { success: true, deleted: true };
}

/** GET action=managers — eligible managers for dropdowns. */
export async function managers(db) {
  const [rows] = await db.query(
    `SELECT id, name, department, role FROM users
      WHERE role IN ('team_lead','project_lead','manager','department_manager','senior_manager','plant_head','executive','admin') AND status='active'
      ORDER BY FIELD(role,'admin','executive','plant_head','senior_manager','department_manager','manager','project_lead','team_lead'), name`
  );
  /*
   * Which one-per-organisation roles are already spoken for.
   *
   * Sent with the manager list because they are wanted by the same form, and
   * because the console should be able to grey the option out rather than let
   * an administrator fill in a whole user and then be told the role is taken.
   * The server refuses either way — this is so the refusal is not a surprise.
   */
  return {
    success: true,
    managers: rows,
    taken_roles: await takenSingletonRoles(db),
    // Roles held by more than one person — a state the guards prevent from
    // today but cannot undo. The console shows these; nobody is demoted
    // automatically, because choosing which of two real people loses their
    // authority is the organisation's decision, not ours.
    role_conflicts: await singletonConflicts(db),
  };
}

/** GET action=hierarchy — org tree data + role stats (super_admin only). */
/**
 * Number of people the org-chart screen will render before it gives up.
 *
 * The chart is a recursive tree in the browser; bulk import can put 10,000
 * employees in a tenant, and rendering a DOM node per person (plus the recursion)
 * would lock the tab up. Past this many users the screen shows the counts and
 * asks the admin to search instead of drawing the whole org.
 */
const HIERARCHY_MAX = 1500;

export async function hierarchy(db) {
  // Counts come from an aggregate, so they stay correct even when the user list
  // below is truncated.
  const [statRows] = await db.query(
    `SELECT role, COUNT(*) AS cnt FROM users WHERE role != 'super_admin' GROUP BY role`
  );
  const stats = { total: 0, admins: 0, managers: 0, employees: 0, executives: 0 };
  for (const r of statRows) {
    const n = Number(r.cnt) || 0;
    stats.total += n;
    const key = `${r.role}s`;
    if (Object.prototype.hasOwnProperty.call(stats, key)) stats[key] += n;
  }

  // The old query ran a correlated COUNT subquery per user — 10,000 users meant
  // 10,000 subqueries. One grouped join instead.
  const [users] = await db.execute(
    `SELECT u.id, u.employee_id, u.name, u.email, u.department, u.business_unit,
            u.location, u.role, u.manager_id, u.points, u.avatar_initials,
            m.name AS manager_name,
            COALESCE(i.cnt, 0) AS idea_count
       FROM users u
       LEFT JOIN users m ON m.id = u.manager_id
       LEFT JOIN (
         SELECT submitter_id, COUNT(*) AS cnt
           FROM ideas WHERE status != 'Draft' GROUP BY submitter_id
       ) i ON i.submitter_id = u.id
      WHERE u.role != 'super_admin'
      ORDER BY FIELD(u.role,'admin','executive','plant_head','senior_manager','department_manager','manager','project_lead','team_lead','employee','trainee'), u.name
      LIMIT ${HIERARCHY_MAX + 1}`
  );

  const truncated = users.length > HIERARCHY_MAX;
  return {
    success: true,
    users: truncated ? users.slice(0, HIERARCHY_MAX) : users,
    stats,
    truncated,
    limit: HIERARCHY_MAX,
  };
}

/**
 * POST action=profile — update own phone.
 *
 * Kept for compatibility, but it can no longer set a number outright: changing
 * it goes through requestPhoneChangeCode / confirmPhoneChange below, so the
 * number on file is always one somebody proved they hold. Silently ignoring the
 * field would be worse than refusing it — the screen would report success and
 * the number would not change.
 */
/**
 * Update your own profile.
 *
 * ── What a person may change about themselves, and what they may not ───────
 *
 * Department, business unit and location are descriptive: they say where
 * somebody works, they are routinely wrong after a move, and the person
 * themselves is the one who knows. Letting them fix it is the difference
 * between a directory that is current and one that quietly rots because the
 * only route to a correction is an admin's queue.
 *
 * Role, points, manager and status are NOT here, and must never be. Role and
 * manager decide what an idea can reach and who judges it; points are earned.
 * Somebody who could set their own role could approve their own idea, so the
 * server takes only the three fields below and ignores anything else in the
 * body rather than trusting the form that sent it.
 *
 * Email and phone are identity rather than description. The phone has its own
 * verified flow (see requestPhoneChangeCode); a bare change here is refused
 * with a message saying where to go.
 */
const SELF_EDITABLE = ['department', 'business_unit', 'location'];

export async function updateProfile(db, actor, body) {
  const phone = String(body.phone || '').trim();
  const current = String(actor.phone || '').trim();
  if (phone && digitsOf(phone) !== digitsOf(current)) {
    throw badRequest('To change your mobile number, verify the new one with the code we send.');
  }

  const updates = {};
  for (const field of SELF_EDITABLE) {
    if (body[field] === undefined) continue;
    const v = String(body[field] ?? '').trim().slice(0, 100);
    updates[field] = v || null;
  }
  if (!Object.keys(updates).length) return { success: true, message: 'Nothing to update.' };

  const cols = Object.keys(updates);
  await db.execute(
    `UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...cols.map((c) => updates[c]), actor.id]
  );

  const [[fresh]] = await db.execute(
    `SELECT u.*, m.name AS manager_name FROM users u
       LEFT JOIN users m ON m.id = u.manager_id
      WHERE u.id = ? LIMIT 1`,
    [actor.id]
  );
  return { success: true, message: 'Profile updated.', user: fresh || null };
}

const digitsOf = (v) => String(v || '').replace(/\D/g, '');

/**
 * Step one of changing your own number: send a code to the NEW one.
 *
 * The code goes to the number being claimed, not to the one on file, because
 * the question being asked is "do you hold this number" — sending it to the old
 * one would prove only that the person can read messages they could already
 * read.
 */
export async function requestPhoneChangeCode(db, actor, body, tenant = null) {
  const phone = String(body?.phone || '').trim();
  if (!phone) throw badRequest('Enter the new mobile number.');
  if (!isValidPhone(phone)) {
    throw badRequest('Enter a valid mobile number, including the country or area code.');
  }
  if (digitsOf(phone) === digitsOf(actor.phone)) {
    throw badRequest('That is already your number.');
  }

  // One account per number, or two people can both claim it and the login
  // directory has to guess which of them a code belongs to.
  const [[clash] = []] = await db.execute(
    "SELECT id FROM users WHERE id <> ? AND status = 'active' "
    + "AND REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'+','') LIKE ? LIMIT 1",
    [actor.id, `%${digitsOf(phone)}`]
  );
  if (clash) throw new ApiError(409, 'That number is already registered to another account.');

  const verification = await import('./verificationService.js');
  return verification.sendCode({
    identifier: phone,
    purpose: 'phone_verify',
    name: actor.name,
    tenantSlug: tenant?.slug || actor.org_slug || null,
    userId: actor.id,
    announce: true,
  });
}

/**
 * Step two: the code was right, so the number is theirs. Save it.
 *
 * A changed number is worth telling somebody about. Whoever holds the account
 * can now receive sign-in codes and password resets on a new handset, so the
 * OLD contact details get a notice — that is what makes a quietly stolen
 * session visible to the person it was stolen from.
 */
export async function confirmPhoneChange(db, actor, body, tenant = null) {
  const phone = String(body?.phone || '').trim();
  const verification = await import('./verificationService.js');
  await verification.verifyCode({ identifier: phone, code: body?.code, purpose: 'phone_verify' });

  const previous = String(actor.phone || '').trim();
  await db.execute('UPDATE users SET phone = ? WHERE id = ?', [phone, actor.id]);

  // Keep the org-code-less login directory in step, or the new number cannot be
  // used to sign in and the old one still can.
  if (tenant) indexUser(tenant, { id: actor.id, email: actor.email, phone }).catch(() => {});

  notifyPhoneChanged(actor, previous, phone).catch(() => {});
  logger.info(`users: ${actor.id} changed their mobile number @ ${tenant?.slug || 'unknown'}`);
  return { success: true, phone, message: 'Your mobile number has been updated.' };
}

/** Tell the old address and the old number that the number changed. */
async function notifyPhoneChanged(actor, previous, next) {
  const { sendViaPlatform } = await import('./mailerService.js');
  const { sendSms, messageFor } = await import('./smsService.js');
  const tail = String(next).replace(/\D/g, '').slice(-4);

  if (actor.email) {
    await sendViaPlatform(
      actor.email, actor.name, 'Your Kalpion mobile number was changed',
      `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">
  <p>Hello ${String(actor.name || '').replace(/[<>&]/g, '')},</p>
  <p>The mobile number on your Kalpion account was changed. Sign-in codes and
  password resets will now go to the number ending <b>${tail}</b>.</p>
  <p style="color:#b91c1c"><b>If this was not you</b>, contact your organisation's
  administrator straight away — whoever made this change can receive your
  sign-in codes.</p>
</div>`
    ).catch(() => {});
  }
  if (previous) {
    /*
     * purpose 'phone_changed', with the wording that was submitted for it.
     *
     * This used to send under 'phone_verify' — the REGISTRATION template's id —
     * with text that matches no registration at all. On a DLT gateway that
     * combination is accepted and then dropped by the carrier, so this security
     * alert has never once reached a handset while every layer above reported
     * it sent.
     *
     * Its own template is still awaiting approval, so sendSms declines it and
     * says why. That is a visible gap rather than an invisible one, and the
     * email alert above still goes out. It starts working the moment the id is
     * filled in.
     */
    const { text } = messageFor('phone_changed', tail);
    await sendSms(previous, text, { purpose: 'phone_changed' }).catch(() => {});
  }
}

function isValidEmail(email) {
  // Mirrors PHP filter_var(..., FILTER_VALIDATE_EMAIL) closely enough for parity.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Loose on formatting, strict on substance.
 *
 * People type numbers with spaces, hyphens, brackets and a country code, and
 * rejecting those is how a required field turns into a support ticket. What
 * actually matters is that there are enough digits to be a real mobile number,
 * because a code will be sent to it.
 *
 * Exported so the platform console applies the SAME rule to an IFQM staff
 * account. A second copy of "what counts as a phone number" would agree on the
 * day it was written and drift the first time either is touched, and the
 * failure would be a number this product accepted but could never send a code
 * to.
 */
export function isValidPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return /^[0-9+\-\s()]{7,20}$/.test(String(phone || '').trim())
    && digits.length >= 10 && digits.length <= 15;
}

export default {
  list, adminUsers, createUser, updateUser, updateManager, deleteUser, managers, hierarchy, updateProfile,
  requestPhoneChangeCode, confirmPhoneChange,
};

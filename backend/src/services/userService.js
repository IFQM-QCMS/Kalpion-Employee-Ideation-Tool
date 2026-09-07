/*
 * User service - Node port of the user-management actions in PHP api/users.php: list,
 * admin_users, create_user, update_user, delete_user, managers, hierarchy, profile.
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

// Roles an organisation may fill exactly once.
const SINGLETON_ROLES = {
  plant_head: 'Plant Head',
};

/** Refuse a role that is already taken. */
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
    // First holder wins the label. A tenant that already had two before this rule existed is
    // reported by singletonConflicts() below.
    if (!out[r.role]) out[r.role] = { user_id: r.id, name: r.name, label: SINGLETON_ROLES[r.role] };
  }
  return out;
}

/** Singleton roles this organisation holds MORE than once. */
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

/*
 * Every role that can appear on a user row - the vocabulary the admin console's role
 * filter offers (MOM §13.9).
 */
const ALL_ROLES = [...ROLES_SUPER_ADMIN_CAN_ASSIGN, 'super_admin'];

/** The single source of truth for "which roles may this actor hand out". */
export const assignableRoles = (actorRole) =>
  actorRole === 'super_admin' ? ROLES_SUPER_ADMIN_CAN_ASSIGN : ROLES_ADMIN_CAN_ASSIGN;

/** Avatar initials - matches PHP. */
function avatarInitials(name) {
  return String(name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

const firstCharUpper = (s) => (s ? s.charAt(0).toUpperCase() : '');

/** GET action=list - search users (excludes self), LIMIT 20. */
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

/** GET action=admin_users - the admin console's user list. */
export async function adminUsers(db, { q = '', page = 1, limit = 50, role = '', department = '', status = '', manager_id: managerId = '' } = {}) {
  const search = String(q || '').trim();
  // These two are built into the statement text rather than bound, because MySQL 8.4 rejects
  // LIMIT and OFFSET as prepared-statement parameters ("Incorrect arguments to
  // mysqld_stmt_execute").
  const perPage = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (pageNum - 1) * perPage;

  const where = [];
  const params = [];
  if (search) {
    // Username is searchable too - for an account created without an address it is the only
    // thing an admin has to look the person up by.
    where.push('(u.name LIKE ? OR u.email LIKE ? OR u.employee_id LIKE ? OR u.username LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  // MOM §13.9 - filter by role, department, status or manager.
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

  // The department list comes from the data, not a constant: an org's departments are
  // whatever its import sheet contained.
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

/** GET /api/users/:id/chain - MOM §13.8. */
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
  // 12 levels is far deeper than any real org chart; hitting it means a cycle the seen-set
  // somehow missed, and stopping beats spinning.
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
  // An address is no longer compulsory (migration 025).
  if (!username && !email) {
    throw badRequest('Give the user a username or an email address - at least one is needed to sign in.');
  }
  if (email && !isValidEmail(email)) throw badRequest('Invalid email address.');
  if (username && !isUsername(username)) {
    throw badRequest('A username must be 3-30 characters using letters, numbers, dot, underscore or hyphen, and must contain at least one letter.');
  }
  // A mobile number is required of every account, however it is created.
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

  // A username is unique across the whole platform, so this cannot be answered from the
  // tenant's own table - the name may be held by another customer.
  if (username && tenant && !(await usernameAvailable(username, { tenantId: tenant.id }))) {
    throw new ApiError(409, `The username "${username}" is already taken.`);
  }

  const initials = avatarInitials(name) || firstCharUpper(name);

  // Three cases, and the same three the bulk import uses - deliberately, so an employee's
  // experience does not depend on which screen an administrator happened to add them from.
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

  // Claim the username for real, now that there is a user id to own it.
  if (tenant && username && !(await claimUsername(tenant, result.insertId, username))) {
    await db.execute('DELETE FROM users WHERE id = ?', [result.insertId]).catch(() => {});
    throw new ApiError(409, `The username "${username}" was taken a moment ago. Please choose another.`);
  }

  // Register the account in the global login directory so it can sign in with email or phone
  // and no org code (best-effort; login self-heals otherwise).
  if (tenant) indexUser(tenant, { id: result.insertId, email, phone }).catch(() => {});

  // Send it, if there is anywhere to send it.
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
    // What the admin is shown, and why it differs per case.
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
  // A username is only touched when the field is actually present in the request.
  const usernameGiven = body.username !== undefined;
  const username = String(body.username || '').trim().toLowerCase();

  if (!assignableRoles(actor.role).includes(role)) throw forbidden('You cannot assign that role.');
  // Excepting this user, so re-saving the sitting plant head is not blocked by their own
  // existence.
  await assertRoleVacant(db, role, id);
  if (usernameGiven && username && !isUsername(username)) {
    throw badRequest('A username must be 3-30 characters using letters, numbers, dot, underscore or hyphen, and must contain at least one letter.');
  }
  if (usernameGiven && !username && !target.email) {
    throw badRequest('This account has no email address, so its username cannot be removed - it would leave no way to sign in.');
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
  // Same rule as creation, applied on the way out too: an edit must not be able to remove
  // the only number the account can be recovered through.
  if (!phone) throw badRequest('A mobile number is required for every user.');
  if (!isValidPhone(phone)) {
    throw badRequest('Enter a valid mobile number, including the country or area code.');
  }

  const initials = avatarInitials(name) || firstCharUpper(name);

  // Deactivating an employee now ends their session on their very next request (the auth
  // middleware re-reads status from this row), instead of leaving them logged in for the
  // remaining life of their token.
  await db.execute(
    `UPDATE users SET name=?, department=?, business_unit=?, location=?, phone=?, role=?,
                      manager_id=?, avatar_initials=?, status=?,
                      username = IF(?, ?, username),
                      deactivated_at = IF(? = 'inactive', COALESCE(deactivated_at, NOW()), NULL)
      WHERE id=?`,
    [name, department, businessUnit, location, phone || null, role, managerId, initials, status,
      usernameGiven ? 1 : 0, username || null, status, id]
  );

  // A changed or cleared username frees the old one platform-wide, then claims the new one.
  if (tenant && usernameGiven && username !== (target.username || '')) {
    if (target.username) await releaseUsername(target.username);
    if (username) await claimUsername(tenant, id, username);
  }

  // Keep the login directory in step with a changed phone number.
  if (tenant) indexUser(tenant, { id, email: target.email, phone }).catch(() => {});
  return { success: true };
}

/** PUT /users/:id/manager - reassign only who a user reports to. */
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

/** POST action=delete_user - deactivates instead if the user has real ideas. */
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
    // Offboarding: the account is retained (their ideas must keep an author) but deactivated.
    // The live session check ends any open session immediately.
    await db.execute(
      "UPDATE users SET status='inactive', deactivated_at=COALESCE(deactivated_at, NOW()) WHERE id=?",
      [id]
    );
    return {
      success: true,
      deactivated: true,
      message: 'User has submitted ideas - account deactivated instead of deleted.',
    };
  }

  await db.execute('UPDATE users SET manager_id=NULL WHERE manager_id=?', [id]);
  await db.execute('DELETE FROM users WHERE id=?', [id]);
  if (tenant) deindexUser(tenant.id, id).catch(() => {});
  return { success: true, deleted: true };
}

/** GET action=managers - eligible managers for dropdowns. */
export async function managers(db) {
  const [rows] = await db.query(
    `SELECT id, name, department, role FROM users
      WHERE role IN ('team_lead','project_lead','manager','department_manager','senior_manager','plant_head','executive','admin') AND status='active'
      ORDER BY FIELD(role,'admin','executive','plant_head','senior_manager','department_manager','manager','project_lead','team_lead'), name`
  );
  // Which one-per-organisation roles are already spoken for.
  return {
    success: true,
    managers: rows,
    taken_roles: await takenSingletonRoles(db),
    // Roles held by more than one person - a state the guards prevent from today but cannot
    // undo.
    role_conflicts: await singletonConflicts(db),
  };
}

/** GET action=hierarchy - org tree data + role stats (super_admin only). */
/** Number of people the org-chart screen will render before it gives up. */
const HIERARCHY_MAX = 1500;

export async function hierarchy(db) {
  // Counts come from an aggregate, so they stay correct even when the user list below is
  // truncated.
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

  // The old query ran a correlated COUNT subquery per user - 10,000 users meant 10,000
  // subqueries. One grouped join instead.
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

/** POST action=profile - update own phone. */
/** Update your own profile. */
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

/** Step one of changing your own number: send a code to the NEW one. */
export async function requestPhoneChangeCode(db, actor, body, tenant = null) {
  const phone = String(body?.phone || '').trim();
  if (!phone) throw badRequest('Enter the new mobile number.');
  if (!isValidPhone(phone)) {
    throw badRequest('Enter a valid mobile number, including the country or area code.');
  }
  if (digitsOf(phone) === digitsOf(actor.phone)) {
    throw badRequest('That is already your number.');
  }

  // One account per number, or two people can both claim it and the login directory has to
  // guess which of them a code belongs to.
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

/** Step two: the code was right, so the number is theirs. */
export async function confirmPhoneChange(db, actor, body, tenant = null) {
  const phone = String(body?.phone || '').trim();
  const verification = await import('./verificationService.js');
  await verification.verifyCode({ identifier: phone, code: body?.code, purpose: 'phone_verify' });

  const previous = String(actor.phone || '').trim();
  await db.execute('UPDATE users SET phone = ? WHERE id = ?', [phone, actor.id]);

  // Keep the org-code-less login directory in step, or the new number cannot be used to sign
  // in and the old one still can.
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
  administrator straight away - whoever made this change can receive your
  sign-in codes.</p>
</div>`
    ).catch(() => {});
  }
  if (previous) {
    // purpose 'phone_changed', with the wording that was submitted for it.
    const { text } = messageFor('phone_changed', tail);
    await sendSms(previous, text, { purpose: 'phone_changed' }).catch(() => {});
  }
}

function isValidEmail(email) {
  // Mirrors PHP filter_var(..., FILTER_VALIDATE_EMAIL) closely enough for parity.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Loose on formatting, strict on substance. */
export function isValidPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return /^[0-9+\-\s()]{7,20}$/.test(String(phone || '').trim())
    && digits.length >= 10 && digits.length <= 15;
}

export default {
  list, adminUsers, createUser, updateUser, updateManager, deleteUser, managers, hierarchy, updateProfile,
  requestPhoneChangeCode, confirmPhoneChange,
};

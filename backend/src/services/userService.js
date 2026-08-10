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
import { tempPasswordFor } from './userImportService.js';
import { indexUser, deindexUser } from './directoryService.js';

// Role sets used across create/update/managers (mirrors the PHP literals).
const ROLES_ADMIN_CAN_ASSIGN = [
  'trainee', 'employee', 'team_lead', 'project_lead', 'manager', 'department_manager',
  'senior_manager', 'plant_head', 'executive',
];
const ROLES_SUPER_ADMIN_CAN_ASSIGN = [...ROLES_ADMIN_CAN_ASSIGN, 'admin'];

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
    where.push('(u.name LIKE ? OR u.email LIKE ? OR u.employee_id LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
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
    `SELECT u.id, u.employee_id, u.name, u.department, u.business_unit, u.location,
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
  const employeeId = String(body.employee_id || '').trim();
  const department = String(body.department || '').trim();
  const businessUnit = String(body.business_unit || '').trim();
  const location = String(body.location || '').trim();
  const phone = String(body.phone || '').trim();
  const role = body.role || 'employee';
  const managerId = body.manager_id ? parseInt(body.manager_id, 10) : null;

  // Date of birth drives the first-login password (first 4 letters of the name +
  // birth year), exactly like the bulk import — so every new account, however it
  // is created, starts on the same derived temporary credential and is forced to
  // change it. A plain YYYY or a full YYYY-MM-DD are both accepted.
  const dobRaw = String(body.date_of_birth || '').trim();
  const birthYear = (dobRaw.match(/\d{4}/) || [])[0] || '';
  const explicitPassword = body.password || ''; // legacy/optional override

  if (!name || !email || !employeeId) {
    throw badRequest('Name, email, and employee ID are required.');
  }
  if (!isValidEmail(email)) throw badRequest('Invalid email address.');
  if (!birthYear && !explicitPassword) {
    throw badRequest('Date of birth is required — the first-login password is built from it.');
  }
  if (!assignableRoles(actor.role).includes(role)) throw forbidden('You cannot assign that role.');

  const [dup] = await db.execute(
    'SELECT id FROM users WHERE email=? OR employee_id=? LIMIT 1',
    [email, employeeId]
  );
  if (dup.length) throw new ApiError(409, 'Email or employee ID already exists.');

  const initials = avatarInitials(name) || firstCharUpper(name);

  // Derived temp password (must be changed on first login) unless the admin
  // explicitly supplied a real one.
  const usingDerived = !!birthYear && !explicitPassword;
  const tempPassword = usingDerived ? tempPasswordFor(name, birthYear, employeeId) : explicitPassword;
  if (!usingDerived) assertPasswordStrength(explicitPassword);
  const hash = await bcrypt.hash(tempPassword, usingDerived ? 10 : 12);
  const dob = /^\d{4}-\d{2}-\d{2}$/.test(dobRaw) ? dobRaw : null;

  const [result] = await db.execute(
    `INSERT INTO users (employee_id, name, email, password_hash, phone, date_of_birth,
                        department, business_unit, location, role, manager_id, avatar_initials,
                        status, must_change_password, password_changed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active',?,NOW())`,
    [employeeId, name, email, hash, phone || null, dob, department, businessUnit, location,
      role, managerId, initials, usingDerived ? 1 : 0]
  );

  // Register the account in the global login directory so it can sign in with
  // email or phone and no org code (best-effort; login self-heals otherwise).
  if (tenant) indexUser(tenant, { id: result.insertId, email, phone }).catch(() => {});

  return {
    success: true,
    user_id: result.insertId,
    // Surfaced so the admin can hand the credential to the employee. Only the
    // derived temporary password is returned — never an admin-set real one.
    ...(usingDerived ? { temp_password: tempPassword } : {}),
  };
}

/** POST action=update_user. */
export async function updateUser(db, actor, id, body, tenant = null) {
  id = parseInt(id, 10) || 0;
  if (!id) throw badRequest('Missing user ID.');

  const [tgtRows] = await db.execute('SELECT id, role, email FROM users WHERE id=? LIMIT 1', [id]);
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

  if (!assignableRoles(actor.role).includes(role)) throw forbidden('You cannot assign that role.');

  const initials = avatarInitials(name) || firstCharUpper(name);

  // Deactivating an employee now ends their session on their very next request
  // (the auth middleware re-reads status from this row), instead of leaving them
  // logged in for the remaining life of their token. Same for a role change:
  // the new role takes effect immediately rather than after the token expires.
  await db.execute(
    `UPDATE users SET name=?, department=?, business_unit=?, location=?, phone=?, role=?,
                      manager_id=?, avatar_initials=?, status=?,
                      deactivated_at = IF(? = 'inactive', COALESCE(deactivated_at, NOW()), NULL)
      WHERE id=?`,
    [name, department, businessUnit, location, phone || null, role, managerId, initials, status, status, id]
  );

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
  return { success: true, managers: rows };
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

/** POST action=profile — update own phone. */
export async function updateProfile(db, actor, body) {
  const phone = String(body.phone || '').trim();
  await db.execute('UPDATE users SET phone=? WHERE id=?', [phone, actor.id]);
  // NOTE: PHP also mutated $_SESSION['user']['phone']; with a stateless JWT the
  // client updates its own copy. Response shape is unchanged.
  return { success: true };
}

function isValidEmail(email) {
  // Mirrors PHP filter_var(..., FILTER_VALIDATE_EMAIL) closely enough for parity.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default {
  list, adminUsers, createUser, updateUser, updateManager, deleteUser, managers, hierarchy, updateProfile,
};

/** Bulk employee import - spreadsheet in, user accounts out. */
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { assignableRoles } from './userService.js';
import { hashMany } from './hashPool.js';
import { randomBytes } from 'node:crypto';
import { badRequest, notFound, ApiError } from '../utils/respond.js';
import logger from '../utils/logger.js';
import { isUsername, claimUsername, indexUser } from './directoryService.js';

// Limits
export const MAX_ROWS = 20000;      // hard ceiling per upload
const INSERT_CHUNK = 500;           // rows per multi-row INSERT
const TEMP_PASSWORD_ROUNDS = 10;    // see tempPasswordFor() for why not 12
const STALE_JOB_MINUTES = 30;

// Sheet definition (drives BOTH the template and the parser)
//
// `required` is what a NEW account needs. A bulk UPDATE needs only employee_id, and applies
// whichever other cells are filled in. The header row of the template marks required
// columns with a trailing " *"; the parser ignores that mark, so a sheet with or without it
// reads the same.
export const COLUMNS = [
  { key: 'employee_id', header: 'employee_id', required: true,  max: 20,  width: 16,
    note: 'Unique ID for the employee. Required. This is the key the import de-duplicates on, and the key a bulk update matches on.' },
  // MOM §13.4 - salutation / first name / last name.
  { key: 'salutation',  header: 'salutation',  required: true,  max: 10,  width: 11,
    note: 'Required. Mr / Ms / Mrs / Dr / Prof.' },
  { key: 'first_name',  header: 'first_name',  required: true,  max: 60,  width: 18,
    note: 'Required.' },
  { key: 'last_name',   header: 'last_name',   required: true,  max: 60,  width: 18,
    note: 'Required. Part of the displayed name.' },
  { key: 'username',    header: 'username',    required: true,  max: 50,  width: 18,
    note: 'Required. Sign-in name, e.g. yashas123. Unique across the whole platform.' },
  { key: 'email',       header: 'email',       required: false, max: 150, width: 28,
    note: 'Optional. Work email; if given it must be unique, and the temporary password is emailed to it.' },
  { key: 'role',        header: 'role',        required: true,  max: 20,  width: 16,
    note: 'Required. Pick from the dropdown.' },
  { key: 'department',  header: 'department',  required: false, max: 100, width: 18, note: 'Optional.' },
  { key: 'business_unit', header: 'business_unit', required: false, max: 100, width: 18, note: 'Optional.' },
  { key: 'location',    header: 'location',    required: false, max: 100, width: 16, note: 'Optional.' },
  { key: 'phone',       header: 'phone',       required: true,  max: 20,  width: 16,
    note: 'Required. Mobile number - sign-in codes and password resets are sent to it.' },
  { key: 'manager_employee_id', header: 'manager_employee_id', required: true, max: 20, width: 20,
    note: "Required for everyone except the top of the organisation (plant head, executive, admin). The employee_id of this person's manager - an existing employee or another row in this sheet." },
];

// The roles that sit at the top of a reporting tree, and so may have no manager.
const TOP_ROLES = ['plant_head', 'executive', 'admin', 'super_admin'];

/** The header as the template prints it - required columns carry a star. */
export const headerLabel = (c) => (c.required ? `${c.header} *` : c.header);

const HEADER_ALIASES = new Map();
for (const c of COLUMNS) {
  const add = (s) => HEADER_ALIASES.set(normaliseHeader(s), c.key);
  add(c.header);
  add(c.key);
}
// A few forgiving spellings, so a hand-edited header doesn't fail the upload.
[['emp id', 'employee_id'], ['empid', 'employee_id'], ['employee code', 'employee_id'],
 // 'name' is a pre-MOM header.
 ['full name', 'first_name'], ['employee name', 'first_name'], ['name', 'first_name'],
 ['first name', 'first_name'], ['last name', 'last_name'], ['surname', 'last_name'],
 ['title', 'salutation'],
 ['email address', 'email'], ['e mail', 'email'],
  ['user name', 'username'], ['login', 'username'], ['login id', 'username'], ['userid', 'username'],
 ['designation', 'role'], ['manager', 'manager_employee_id'], ['manager id', 'manager_employee_id'],
 ['reports to', 'manager_employee_id'], ['mobile', 'phone'], ['contact', 'phone'],
 ['dept', 'department'], ['bu', 'business_unit'],
].forEach(([alias, key]) => HEADER_ALIASES.set(normaliseHeader(alias), key));

function normaliseHeader(s) {
  return String(s ?? '').toLowerCase()
    // The template marks required columns "employee_id *"; the help sheet says "(required)".
    // Neither is part of the name.
    .replace(/\*/g, ' ').replace(/\((?:required|optional)\)/g, ' ')
    .replace(/[\s_\-.]+/g, ' ').trim();
}



/** First 4 letters of the NAME + the last 4 digits of the phone number. */
export function tempPasswordFor(username, phone, name, employeeId) {
  // Letters only for the name, because "the first four LETTERS of your name" is what the
  // employee is told, and that is a sentence somebody can follow with no reference material.
  const letters = (v) => String(v ?? '').normalize('NFKD').replace(/[^A-Za-z]/g, '').toLowerCase();
  // The fallbacks keep digits, because a username or an employee id may be mostly numeric
  // and dropping those would collapse different people onto the same password.
  const alnum = (v) => String(v ?? '').normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').toLowerCase();

  let base = letters(name).slice(0, 4);
  if (!base) base = alnum(username).slice(0, 4);
  if (!base) {
    // A name in a non-Latin script with no username leaves nothing to slice, so the employee
    // id is the last thing that can keep this per-person.
    base = alnum(employeeId).slice(-4);
  }
  if (!base) base = 'user';

  // The LAST four digits, after stripping everything that is not a digit, so +91 79754 95881
  // and 07975495881 and 7975495881 all land on the same four.
  const digits = String(phone ?? '').replace(/\D/g, '');
  const tail = digits.slice(-4);
  const suffix = tail.length === 4 ? tail : tail.padStart(4, '0');

  return `${base.padEnd(4, 'x')}${suffix}`;
}

/** A password nobody can derive, for accounts we can actually deliver one to. */
export function randomTempPassword() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}



/** Build the.xlsx template. The role dropdown is scoped to the actor's rights. */
export async function buildTemplate(actorRole) {
  const roles = assignableRoles(actorRole);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'IFQM';
  wb.created = new Date();

  const ws = wb.addWorksheet('Employees');
  ws.columns = COLUMNS.map((c) => ({ header: headerLabel(c), key: c.key, width: c.width }));

  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).height = 20;
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // One filled example row so the expected shape is obvious.
  ws.addRow({
    employee_id: 'EMP001',
    salutation: 'Ms',
    first_name: 'Asha',
    last_name: 'Rao',
    username: 'asha.rao',
    email: 'asha.rao@yourcompany.com',
    role: 'employee',
    department: 'Production',
    business_unit: 'Plant 1',
    location: 'Bengaluru',
    phone: '9876543210',
    manager_employee_id: 'EMP002',
  });
  ws.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };

  // Role dropdown, restricted to what THIS admin may assign. A super_admin sees 'admin' in
  // the list; an admin does not.
  const roleCol = COLUMNS.findIndex((c) => c.key === 'role') + 1;
  const letter = ws.getColumn(roleCol).letter;
  for (let r = 2; r <= 5000; r++) {
    ws.getCell(`${letter}${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${roles.join(',')}"`],
      showErrorMessage: true,
      errorTitle: 'Invalid role',
      error: `Choose one of: ${roles.join(', ')}`,
    };
    // Phone numbers as TEXT.
    const phoneCol = COLUMNS.findIndex((c) => c.key === 'phone') + 1;
    ws.getCell(`${ws.getColumn(phoneCol).letter}${r}`).numFmt = '@';
  }

  // A second sheet with the rules, so the admin does not have to guess.
  const help = wb.addWorksheet('Instructions');
  help.columns = [{ width: 24 }, { width: 96 }];
  const h = (a, b, bold = false) => {
    const row = help.addRow([a, b]);
    if (bold) row.font = { bold: true };
    row.alignment = { vertical: 'top', wrapText: true };
  };
  h('IFQM - Bulk employee import', '', true);
  h('', '');
  h('How it works', 'Fill in one row per employee on the "Employees" sheet, then upload this file in Admin → User List → Bulk Import. Delete the grey example row before uploading (or leave it - EMP001 will simply be reported as invalid if the data is not real).');
  h('', '');
  h('First-time password', 'It depends on whether the row has an email address, and you do not have to do anything either way.');
  h('  With an email', 'A random password is generated and emailed to them directly. You never see it and do not need to pass anything on. Tell them to check their inbox.');
  h('  Without an email', 'The password is the first 4 LETTERS of their name, lowercased, followed by the LAST 4 DIGITS of their phone number. Example: "Yashas" on 7975495881 → yash5881. Anything that is not a letter is skipped, so "R. Kumar" gives rkum. This one is shown to you after the import, because you have to pass it on yourself.');
  h('Either way', 'They MUST change it the first time they sign in - until they do, they cannot use any other part of the app.');
  h('Important', 'A password built from a name and a phone number can be worked out by any colleague who knows both. Ask those employees to sign in and change it promptly, and treat the account as not-yet-secure until they have.');
  h('Date of birth', 'No longer collected. It was only ever used to build the first-login password, and the phone number does that job now. If your sheet still has a date-of-birth column it will simply be ignored - you do not need to delete it before uploading.');
  h('', '');
  h('Duplicates', 'Rows whose employee_id or email already exists are SKIPPED, never overwritten. Re-uploading the same file is therefore safe - it will not touch anyone who already has an account.');
  h('Required columns', 'Headers marked with * are required for a new account. The other columns may be left blank, or left out of the sheet altogether.');
  h('Roles', `You may assign: ${roles.join(', ')}. Anything else will be rejected.`);
  h('Plant Head', 'One per organisation. The approval chain ends there, so a second one would '
    + 'mean an idea\'s final approval depended on which plant head it happened to reach. A row '
    + 'asking for a role that is already held is rejected with the name of the person who has it.');
  h('Managers', 'manager_employee_id must be the employee_id of somebody who already exists, or of another row in this same sheet. It may be blank only for the top of the organisation (plant head, executive, admin). Circular reporting lines (A reports to B, B reports to A) are rejected.');
  h('Bulk update', 'The same sheet updates existing people when uploaded through "Bulk update": rows are matched on employee_id, and only the cells you fill in are changed - a blank cell leaves that detail as it is.');
  h('Limit', `Up to ${MAX_ROWS.toLocaleString()} employees per file.`);
  h('', '');
  h('Columns', '', true);
  for (const c of COLUMNS) h(c.header + (c.required ? ' (required)' : ''), c.note);

  return wb.xlsx.writeBuffer();
}



/** ExcelJS hands back strings, numbers, Dates, rich text, formulas or links. */
function cellToString(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('').trim();
    if (v.text !== undefined) return String(v.text).trim();           // hyperlink
    if (v.result !== undefined) return String(v.result).trim();       // formula
    if (v.hyperlink) return String(v.hyperlink).trim();
  }
  return String(v).trim();
}

/** Read the sheet into raw {rowNumber, values} objects. */
async function parseSheet(buffer, filename, { mode = 'create' } = {}) {
  const isCsv = /\.csv$/i.test(filename || '');
  const rows = [];
  let headerMap = null;   // column index -> canonical key

  const takeHeader = (values) => {
    const map = new Map();
    values.forEach((raw, idx) => {
      const key = HEADER_ALIASES.get(normaliseHeader(cellToString(raw)));
      if (key && ![...map.values()].includes(key)) map.set(idx, key);
    });
    return map;
  };

  if (isCsv) {
    const wb = new ExcelJS.Workbook();
    const ws = await wb.csv.read(Readable.from(buffer));
    let overflow = false;
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      const values = row.values.slice(1);
      if (!headerMap) { headerMap = takeHeader(values); return; }
      if (rows.length >= MAX_ROWS) { overflow = true; return; }
      if (!values.some((v) => cellToString(v) !== '')) return;
      rows.push({ rowNumber: n, values });
    });
    if (overflow) {
      throw badRequest(`This file has more than ${MAX_ROWS.toLocaleString()} rows. Split it into smaller files.`);
    }
  } else {
    // Load the whole workbook rather than stream it.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);

    const ws = wb.worksheets[0];
    if (!ws) throw badRequest('That workbook has no sheets.');

    let overflow = false;
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      if (!headerMap) { headerMap = takeHeader(values); return; }
      if (rows.length >= MAX_ROWS) { overflow = true; return; }
      // Skip fully blank rows (Excel loves trailing empties).
      if (!values.some((v) => cellToString(v) !== '')) return;
      rows.push({ rowNumber: n, values });
    });
    if (overflow) {
      throw badRequest(`This file has more than ${MAX_ROWS.toLocaleString()} rows. Split it into smaller files.`);
    }
  }

  if (!headerMap || !headerMap.size) {
    throw badRequest('Could not find a header row. Use the downloadable template.');
  }
  const found = new Set(headerMap.values());
  // A new account needs every required column; an update needs only the key it matches on.
  const needed = mode === 'update' ? COLUMNS.filter((c) => c.key === 'employee_id') : COLUMNS.filter((c) => c.required);
  const missing = needed.filter((c) => !found.has(c.key)).map((c) => c.header);
  if (missing.length) {
    throw badRequest(`The sheet is missing required column(s): ${missing.join(', ')}. Use the downloadable template.`);
  }

  // Project each row onto the canonical keys.
  return rows.map(({ rowNumber, values }) => {
    const rec = { __row: rowNumber };
    for (const [idx, key] of headerMap) rec[key] = cellToString(values[idx]);
    return rec;
  });
}



const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Roles an organisation may fill exactly once.
const SINGLETON_ROLES_LIST = ['plant_head'];
/** Validate every row against the DB, the sheet itself, and the actor's rights. */
export async function validateRows(db, actor, records) {
  const allowedRoles = assignableRoles(actor.role);

  // Everything already in this tenant, so we can spot collisions cheaply.
  const [existing] = await db.query(
    'SELECT id, employee_id, LOWER(email) AS email, LOWER(username) AS username FROM users'
  );

  // Roles this organisation may fill only once, and who has them.
  const [heldRows] = await db.query(
    `SELECT role, employee_id, name FROM users
      WHERE status = 'active' AND role IN (?)`, [SINGLETON_ROLES_LIST]);
  const singletonHeldBy = new Map();
  for (const r of heldRows) {
    if (!singletonHeldBy.has(r.role)) {
      singletonHeldBy.set(r.role, { employee_id: String(r.employee_id || '').toLowerCase(), name: r.name });
    }
  }
  const byEmpId = new Map();
  const emails = new Set();
  const usernames = new Set();
  for (const u of existing) {
    if (u.employee_id) byEmpId.set(String(u.employee_id).toLowerCase(), u.id);
    if (u.email) emails.add(u.email);
    if (u.username) usernames.add(u.username);
  }

  const errors = [];
  const valid = [];
  const seenEmpId = new Map();  // within-sheet duplicate detection
  const seenEmail = new Map();
  const seenUsername = new Map();

  const reject = (rec, message) => errors.push({
    row_number: rec.__row,
    employee_id: (rec.employee_id || '').slice(0, 190),
    email: (rec.email || '').slice(0, 190),
    message: message.slice(0, 250),
  });

  for (const rec of records) {
    const employeeId = (rec.employee_id || '').trim();
    const salutation = (rec.salutation || '').trim();
    // MOM §13.4 - the sheet now carries first and last name separately.
    let firstName = (rec.first_name || '').trim();
    let lastName  = (rec.last_name  || '').trim();
    if (!lastName && firstName.includes(' ')) {
      const parts = firstName.split(/\s+/);
      firstName = parts.shift();
      lastName = parts.join(' ');
    }
    // `name` stays the displayed identity everywhere else in the product, so it is composed
    // rather than replaced - nothing downstream has to change.
    const name = [firstName, lastName].filter(Boolean).join(' ').trim();
    const email = (rec.email || '').trim().toLowerCase();
    const username = (rec.username || '').trim().toLowerCase();

    // required
    if (!employeeId) { reject(rec, 'employee_id is required.'); continue; }
    if (!salutation) { reject(rec, 'salutation is required (Mr / Ms / Mrs / Dr / Prof).'); continue; }
    if (!firstName)  { reject(rec, 'first_name is required.'); continue; }
    if (!lastName)   { reject(rec, 'last_name is required.'); continue; }
    if (!name)       { reject(rec, 'name is required.'); continue; }
    if (!username) {
      reject(rec, 'username is required - it is how this person signs in.');
      continue;
    }
    if (!(rec.role || '').trim()) { reject(rec, 'role is required.'); continue; }
    if (!(rec.phone || '').trim()) { reject(rec, 'phone is required.'); continue; }
    if (username && !isUsername(username)) {
      reject(rec, `"${username}" is not a valid username - 3-30 characters of letters, numbers, dot, underscore or hyphen, including at least one letter.`);
      continue;
    }

    // lengths (a single over-long value would abort the whole batch INSERT)
    let tooLong = null;
    for (const c of COLUMNS) {
      const v = (rec[c.key] || '').trim();
      if (v && v.length > c.max) { tooLong = `${c.header} is too long (max ${c.max} characters).`; break; }
    }
    if (tooLong) { reject(rec, tooLong); continue; }

    if (email && !EMAIL_RE.test(email)) { reject(rec, `"${email}" is not a valid email address.`); continue; }

    // It used to be recomputed from the row in three separate places (preview, insert, and the
    // result report).
    const phoneDigits = (rec.phone || '').replace(/\D/g, '');
    const hasEmail = !!email;
    const tempPassword = hasEmail ? randomTempPassword()
      : tempPasswordFor(username, phoneDigits, name, employeeId);

    // role: the RBAC gate
    const role = (rec.role || '').trim().toLowerCase() || 'employee';
    if (!allowedRoles.includes(role)) {
      reject(rec, `You are not allowed to assign the role "${role}". Allowed: ${allowedRoles.join(', ')}.`);
      continue;
    }

    // one per organisation: plant head
    if (singletonHeldBy.has(role)) {
      const held = singletonHeldBy.get(role);
      if (held.employee_id !== employeeId.toLowerCase()) {
        reject(rec, `Only one ${role.replace(/_/g, ' ')} is allowed per organisation, and `
          + `${held.name} already holds it. Change this row's role, or change `
          + `${held.name}'s role first.`);
        continue;
      }
    } else if (SINGLETON_ROLES_LIST.includes(role)) {
      // Nobody holds it yet - this row takes it, and any later row asking for the same role is
      // now the duplicate.
      singletonHeldBy.set(role, { employee_id: employeeId.toLowerCase(), name });
    }

    // duplicates: inside the sheet
    const empKey = employeeId.toLowerCase();
    if (seenEmpId.has(empKey)) {
      reject(rec, `Duplicate employee_id "${employeeId}" - already used on row ${seenEmpId.get(empKey)}.`);
      continue;
    }
    if (email && seenEmail.has(email)) {
      reject(rec, `Duplicate email "${email}" - already used on row ${seenEmail.get(email)}.`);
      continue;
    }

    // duplicates: against existing users (SKIP, never overwrite)
    if (byEmpId.has(empKey)) {
      reject(rec, `An employee with ID "${employeeId}" already exists - row skipped (existing users are never modified by an import).`);
      continue;
    }
    if (email && emails.has(email)) {
      reject(rec, `A user with email "${email}" already exists - row skipped (existing users are never modified by an import).`);
      continue;
    }

    seenEmpId.set(empKey, rec.__row);
    if (email) seenEmail.set(email, rec.__row);

    // Usernames, twice over. Within the sheet and within this tenant is what can be answered
    // here; the platform-wide claim happens at insert time, because a name may be held by a
    // different customer entirely and this function is deliberately pure - it reads nothing
    // outside the tenant and writes nothing at all, so the preview and the commit cannot
    // disagree.
    if (username) {
      if (seenUsername.has(username)) {
        reject(rec, `Duplicate username "${username}" - already used on row ${seenUsername.get(username)}.`);
        continue;
      }
      if (usernames.has(username)) {
        reject(rec, `A user with username "${username}" already exists - row skipped (existing users are never modified by an import).`);
        continue;
      }
      seenUsername.set(username, rec.__row);
    }

    valid.push({
      __row: rec.__row,
      employee_id: employeeId,
      name,
      email: email || null,
      username: username || null,
      salutation: salutation || null,
      first_name: firstName,
      last_name: lastName || null,
      temp_password: tempPassword,
      temp_password_derived: !hasEmail,
      role,
      department:    (rec.department || '').trim() || null,
      business_unit: (rec.business_unit || '').trim() || null,
      location:      (rec.location || '').trim() || null,
      phone:         (rec.phone || '').trim() || null,
      manager_employee_id: (rec.manager_employee_id || '').trim() || null,
    });
  }

  // managers: resolve, then reject cycles
  resolveManagers(valid, byEmpId, reject);

  // Everyone reports to somebody, except the people at the top.
  for (const r of valid) {
    if (r.__rejected || r.manager_employee_id || TOP_ROLES.includes(r.role)) continue;
    r.__rejected = true;
    reject({ __row: r.__row, employee_id: r.employee_id, email: r.email || '' },
      'manager_employee_id is required for this role - only a plant head, executive or admin may have no manager.');
  }

  return { valid: valid.filter((r) => !r.__rejected), errors };
}

/*
 * Bulk UPDATE. Rows are matched to existing people on employee_id; a filled cell replaces
 * that detail, a blank cell leaves it alone. The same rules as creating apply to whatever is
 * filled: roles the admin may assign, one plant head, unique username and email, a manager
 * who exists and no reporting loops. Nothing here touches passwords.
 */
export async function validateUpdateRows(db, actor, records) {
  const allowedRoles = assignableRoles(actor.role);
  const [existing] = await db.query(
    `SELECT id, employee_id, LOWER(email) AS email, LOWER(username) AS username, role, name,
            manager_id, status
       FROM users`);
  const byEmpId = new Map();
  const byId = new Map();
  const emailOwner = new Map();
  const usernameOwner = new Map();
  for (const u of existing) {
    if (u.employee_id) byEmpId.set(String(u.employee_id).toLowerCase(), u);
    byId.set(Number(u.id), u);
    if (u.email) emailOwner.set(u.email, Number(u.id));
    if (u.username) usernameOwner.set(u.username, Number(u.id));
  }
  const [heldRows] = await db.query(
    `SELECT id, role, name FROM users WHERE status = 'active' AND role IN (?)`, [SINGLETON_ROLES_LIST]);
  const singletonHeldBy = new Map(heldRows.map((r) => [r.role, { id: Number(r.id), name: r.name }]));

  const errors = [];
  const valid = [];
  const seen = new Map();
  const reject = (rec, message) => errors.push({
    row_number: rec.__row,
    employee_id: (rec.employee_id || '').slice(0, 190),
    email: (rec.email || '').slice(0, 190),
    message: message.slice(0, 250),
  });
  const cell = (rec, key) => (rec[key] === undefined ? undefined : String(rec[key] || '').trim());

  for (const rec of records) {
    const employeeId = cell(rec, 'employee_id') || '';
    if (!employeeId) { reject(rec, 'employee_id is required - it is how the row is matched.'); continue; }
    const key = employeeId.toLowerCase();
    const user = byEmpId.get(key);
    if (!user) { reject(rec, `No employee has the ID "${employeeId}" - a bulk update changes existing people only.`); continue; }
    if (seen.has(key)) { reject(rec, `Duplicate employee_id "${employeeId}" - already on row ${seen.get(key)}.`); continue; }
    seen.set(key, rec.__row);

    let tooLong = null;
    for (const c of COLUMNS) {
      const v = cell(rec, c.key);
      if (v && v.length > c.max) { tooLong = `${c.header} is too long (max ${c.max} characters).`; break; }
    }
    if (tooLong) { reject(rec, tooLong); continue; }

    const changes = {};
    const salutation = cell(rec, 'salutation');
    const firstName = cell(rec, 'first_name');
    const lastName = cell(rec, 'last_name');
    if (salutation) changes.salutation = salutation;
    if (firstName) changes.first_name = firstName;
    if (lastName) changes.last_name = lastName;
    if (firstName || lastName) {
      // The displayed name follows whichever halves were given, keeping the other half.
      const [curFirst, ...curRest] = String(user.name || '').split(' ');
      changes.name = [firstName || curFirst, lastName || curRest.join(' ')].filter(Boolean).join(' ').trim();
    }

    const email = (cell(rec, 'email') || '').toLowerCase();
    if (email) {
      if (!EMAIL_RE.test(email)) { reject(rec, `"${email}" is not a valid email address.`); continue; }
      const owner = emailOwner.get(email);
      if (owner && owner !== Number(user.id)) { reject(rec, `The email "${email}" belongs to another employee.`); continue; }
      changes.email = email;
    }
    const username = (cell(rec, 'username') || '').toLowerCase();
    if (username) {
      if (!isUsername(username)) {
        reject(rec, `"${username}" is not a valid username - 3-30 characters of letters, numbers, dot, underscore or hyphen, including at least one letter.`);
        continue;
      }
      const owner = usernameOwner.get(username);
      if (owner && owner !== Number(user.id)) { reject(rec, `The username "${username}" belongs to another employee.`); continue; }
      changes.username = username;
    }

    const role = (cell(rec, 'role') || '').toLowerCase();
    if (role && role !== user.role) {
      if (!allowedRoles.includes(role)) {
        reject(rec, `You are not allowed to assign the role "${role}". Allowed: ${allowedRoles.join(', ')}.`);
        continue;
      }
      const held = singletonHeldBy.get(role);
      if (held && held.id !== Number(user.id)) {
        reject(rec, `Only one ${role.replace(/_/g, ' ')} is allowed per organisation, and ${held.name} already holds it.`);
        continue;
      }
      if (SINGLETON_ROLES_LIST.includes(role)) singletonHeldBy.set(role, { id: Number(user.id), name: user.name });
      changes.role = role;
    }

    for (const k of ['department', 'business_unit', 'location']) {
      const v = cell(rec, k);
      if (v) changes[k] = v;
    }
    const phone = cell(rec, 'phone');
    if (phone) {
      if (phone.replace(/\D/g, '').length < 10) { reject(rec, `"${phone}" is not a valid mobile number.`); continue; }
      changes.phone = phone;
    }

    const mgrEmp = cell(rec, 'manager_employee_id');
    valid.push({ __row: rec.__row, id: Number(user.id), employee_id: employeeId, email: email || user.email || '',
      changes, manager_employee_id: mgrEmp || null });
  }

  // Managers: an existing employee, or another row of this sheet; and no loops once applied.
  const managerIdOf = new Map(existing.map((u) => [Number(u.id), u.manager_id ? Number(u.manager_id) : null]));
  for (const r of valid) {
    if (!r.manager_employee_id) continue;
    const m = byEmpId.get(r.manager_employee_id.toLowerCase());
    if (!m) {
      r.__rejected = true;
      reject({ __row: r.__row, employee_id: r.employee_id, email: r.email },
        `manager_employee_id "${r.manager_employee_id}" does not match any employee.`);
      continue;
    }
    if (Number(m.id) === r.id) {
      r.__rejected = true;
      reject({ __row: r.__row, employee_id: r.employee_id, email: r.email }, 'A person cannot be their own manager.');
      continue;
    }
    r.changes.manager_id = Number(m.id);
    managerIdOf.set(r.id, Number(m.id));
  }
  for (const r of valid) {
    if (r.__rejected || r.changes.manager_id === undefined) continue;
    // Walk upward from the new manager; landing back on this person is a loop.
    let cur = r.changes.manager_id;
    const hops = new Set();
    while (cur && !hops.has(cur)) {
      if (cur === r.id) {
        r.__rejected = true;
        reject({ __row: r.__row, employee_id: r.employee_id, email: r.email },
          `Setting ${r.manager_employee_id} as manager would create a circular reporting line.`);
        break;
      }
      hops.add(cur);
      cur = managerIdOf.get(cur) ?? null;
    }
  }

  return { valid: valid.filter((r) => !r.__rejected), errors };
}

/** Bulk UPDATE: validate, then apply the changed cells in one transaction. */
export async function applyUpdate(db, actor, buffer, filename, tenant = null) {
  const records = await parseSheet(buffer, filename, { mode: 'update' });
  const { valid, errors } = await validateUpdateRows(db, actor, records);
  const rows = valid.filter((r) => Object.keys(r.changes).length);

  let updated = 0;
  if (rows.length) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      for (const r of rows) {
        const cols = Object.keys(r.changes);
        await conn.execute(
          `UPDATE users SET ${cols.map((c) => `\`${c}\` = ?`).join(', ')} WHERE id = ?`,
          [...cols.map((c) => r.changes[c]), r.id]);
        updated++;
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
    // The sign-in directory follows the identifiers that changed.
    if (tenant) {
      for (const r of rows) {
        if (r.changes.email === undefined && r.changes.username === undefined && r.changes.phone === undefined) continue;
        try {
          const [[u]] = await db.execute('SELECT id, email, phone, username FROM users WHERE id = ?', [r.id]);
          if (u) await indexUser(tenant, u);
        } catch { /* the directory self-heals on the next sign-in */ }
      }
    }
  }
  logger.info(`bulk user update by ${actor?.name || actor?.id}: ${updated} updated, ${errors.length} rejected`);
  return {
    success: true,
    total_rows: records.length,
    updated,
    unchanged: valid.length - rows.length,
    invalid_count: errors.length,
    errors: errors.slice(0, 200),
  };
}

/** Bulk UPDATE preview: what would change, and what would be rejected. Writes nothing. */
export async function previewUpdate(db, actor, buffer, filename) {
  const records = await parseSheet(buffer, filename, { mode: 'update' });
  const { valid, errors } = await validateUpdateRows(db, actor, records);
  return {
    success: true,
    mode: 'update',
    total_rows: records.length,
    valid_count: valid.filter((r) => Object.keys(r.changes).length).length,
    unchanged_count: valid.filter((r) => !Object.keys(r.changes).length).length,
    invalid_count: errors.length,
    sample: valid.slice(0, 10).map((r) => ({ row: r.__row, employee_id: r.employee_id, changes: r.changes })),
    errors: errors.slice(0, 200),
  };
}

/*
 * A manager may be an existing employee or another row in this same sheet (forward
 * references are fine).
 */
function resolveManagers(valid, existingByEmpId, reject) {
  const inSheet = new Map(valid.map((r) => [r.employee_id.toLowerCase(), r]));

  for (const r of valid) {
    if (!r.manager_employee_id) continue;
    const key = r.manager_employee_id.toLowerCase();

    if (key === r.employee_id.toLowerCase()) {
      r.__rejected = true;
      reject({ __row: r.__row, employee_id: r.employee_id, email: r.email },
        'An employee cannot be their own manager.');
      continue;
    }
    if (existingByEmpId.has(key)) {
      r.__manager_existing_id = existingByEmpId.get(key);   // resolve now
    } else if (inSheet.has(key)) {
      r.__manager_in_sheet = key;                            // resolve after insert
    } else {
      r.__rejected = true;
      reject({ __row: r.__row, employee_id: r.employee_id, email: r.email },
        `Manager "${r.manager_employee_id}" was not found - it must be an existing employee_id or another row in this sheet.`);
    }
  }

  // Cycles can only form among NEW rows: an existing user's manager was set before this
  // import and can never point at somebody who does not exist yet.
  const state = new Map(); // 0 = visiting, 1 = done
  const inCycle = new Set();

  const walk = (key, stack) => {
    if (state.get(key) === 1) return;
    if (state.get(key) === 0) {                       // back-edge: cycle
      const at = stack.indexOf(key);
      stack.slice(at).forEach((k) => inCycle.add(k));
      return;
    }
    state.set(key, 0);
    stack.push(key);
    const row = inSheet.get(key);
    if (row && !row.__rejected && row.__manager_in_sheet) walk(row.__manager_in_sheet, stack);
    stack.pop();
    state.set(key, 1);
  };

  for (const r of valid) {
    if (!r.__rejected) walk(r.employee_id.toLowerCase(), []);
  }

  for (const r of valid) {
    if (r.__rejected) continue;
    if (inCycle.has(r.employee_id.toLowerCase())) {
      r.__rejected = true;
      reject({ __row: r.__row, employee_id: r.employee_id, email: r.email },
        'Circular reporting line: this employee ends up managing themselves through their manager chain.');
    }
  }
}



function avatarInitials(name) {
  return String(name || '').split(' ').filter(Boolean).slice(0, 2)
    .map((w) => w[0].toUpperCase()).join('').slice(0, 4);  // column is VARCHAR(4)
}

/** Insert the validated rows. */
async function insertUsers(db, rows, onProgress, onPhase, tenant = null) {
  const hashes = await hashMany(
    rows.map((r) => ({ key: r.employee_id, password: r.temp_password })),
    TEMP_PASSWORD_ROUNDS,
    onProgress
  );

  await onPhase?.('inserting');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Pass 1 - everyone, manager_id NULL for now.
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      const values = chunk.map((r) => [
        r.employee_id, r.username, r.name, r.email, hashes.get(r.employee_id),
        r.phone, r.department, r.business_unit, r.location, r.role,
        avatarInitials(r.name), r.salutation, r.first_name, r.last_name,
      ]);
      await conn.query(
        `INSERT INTO users
           (employee_id, username, name, email, password_hash, phone, department, business_unit,
            location, role, avatar_initials, salutation, first_name, last_name,
            status, points, must_change_password, password_changed_at)
         VALUES ?`,
        // The trailing constants are appended per-row below via map, so keep the shape in sync
        // with the column list above.
        [values.map((v) => [...v, 'active', 0, 1, new Date()])]
      );
    }

    // Pass 2 - resolve manager ids now that every row has one.
    const [created] = await conn.query(
      'SELECT id, employee_id FROM users WHERE employee_id IN (?)',
      [rows.map((r) => r.employee_id)]
    );
    const idByEmp = new Map(created.map((u) => [String(u.employee_id).toLowerCase(), u.id]));

    // Group by manager so this is a handful of UPDATEs, not one per employee.
    const byManager = new Map();
    for (const r of rows) {
      let managerId = null;
      if (r.__manager_existing_id) managerId = r.__manager_existing_id;
      else if (r.__manager_in_sheet) managerId = idByEmp.get(r.__manager_in_sheet) ?? null;
      if (!managerId) continue;

      const childId = idByEmp.get(r.employee_id.toLowerCase());
      if (!childId) continue;
      if (!byManager.has(managerId)) byManager.set(managerId, []);
      byManager.get(managerId).push(childId);
    }

    for (const [managerId, childIds] of byManager) {
      for (let i = 0; i < childIds.length; i += INSERT_CHUNK) {
        await conn.query('UPDATE users SET manager_id = ? WHERE id IN (?)',
          [managerId, childIds.slice(i, i + INSERT_CHUNK)]);
      }
    }

    await conn.commit();

    // Claim the imported usernames platform-wide, now that the rows exist.
    if (tenant) {
      const named = rows.filter((r) => r.username);
      for (const r of named) {
        const userId = idByEmp.get(r.employee_id.toLowerCase());
        if (!userId) continue;
        const won = await claimUsername(tenant, userId, r.username).catch(() => false);
        if (!won) {
          logger.warn(`import: username "${r.username}" was already taken - cleared on ${r.employee_id}`);
          await db.execute('UPDATE users SET username = NULL WHERE id = ?', [userId]).catch(() => {});
        }
      }
      // Addresses and numbers go in the directory the ordinary way, so imported accounts can
      // sign in without an org code like any other.
      for (const r of rows) {
        const userId = idByEmp.get(r.employee_id.toLowerCase());
        if (userId) indexUser(tenant, { id: userId, email: r.email, phone: r.phone }).catch(() => {});
      }
    }

    return rows.length;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}



/** Dry run: validate and report, write nothing. */
export async function preview(db, actor, buffer, filename) {
  const records = await parseSheet(buffer, filename);
  const { valid, errors } = await validateRows(db, actor, records);
  return {
    success: true,
    total_rows: records.length,
    valid_count: valid.length,
    invalid_count: errors.length,
    // enough to show a table without shipping 20k rows to the browser
    // Enough to show a table without shipping 20k rows to the browser.
    sample: valid.slice(0, 10).map((r) => ({
      employee_id: r.employee_id, name: r.name, email: r.email, role: r.role,
      temp_password: r.temp_password_derived ? r.temp_password : null,
      password_emailed: !r.temp_password_derived,
    })),
    errors: errors.slice(0, 200),
  };
}

/** Kick off a real import. Returns immediately; the work happens in background. */
export async function startImport(db, actor, buffer, filename, tenant = null) {
  // One at a time per tenant: two concurrent imports of the same file would race on the same
  // employee_ids and one would die on the unique index.
  const [running] = await db.query(
    "SELECT id FROM user_import_jobs WHERE status IN ('pending','running') ORDER BY id DESC LIMIT 1"
  );
  if (running.length && !(await isStale(db, running[0].id))) {
    throw new ApiError(409, 'An import is already running for this organisation. Wait for it to finish.');
  }

  // Parse + validate up-front so an unusable file fails fast, with a real error, instead of
  // "succeeding" into a background job that then fails.
  const records = await parseSheet(buffer, filename);
  const { valid, errors } = await validateRows(db, actor, records);

  const [res] = await db.execute(
    `INSERT INTO user_import_jobs
       (actor_id, actor_name, filename, status, phase, total_rows, skipped_count, started_at)
     VALUES (?, ?, ?, 'running', 'hashing', ?, ?, NOW())`,
    [Number(actor.id) || null, String(actor.name || '').slice(0, 100),
     String(filename || '').slice(0, 255), records.length, errors.length]
  );
  const jobId = res.insertId;

  if (errors.length) await saveErrors(db, jobId, errors);

  // Run detached. Never await: the HTTP response must not wait minutes.
  // `tenant` is passed explicitly.
  runJob(db, jobId, valid, tenant).catch(async (err) => {
    logger.error(`user import job ${jobId} failed`, err);
    await db.execute(
      "UPDATE user_import_jobs SET status='failed', finished_at=NOW(), error_message=? WHERE id=?",
      [String(err?.message || err).slice(0, 2000), jobId]
    ).catch(() => {});
  });

  return {
    success: true,
    job_id: jobId,
    total_rows: records.length,
    valid_count: valid.length,
    invalid_count: errors.length,
  };
}

async function runJob(db, jobId, valid, tenant = null) {
  if (!valid.length) {
    await db.execute(
      "UPDATE user_import_jobs SET status='completed', phase=NULL, created_count=0, finished_at=NOW() WHERE id=?",
      [jobId]
    );
    return;
  }

  let lastPct = -1;
  const onProgress = (done) => {
    // Throttle: one UPDATE per 5% rather than one per chunk.
    const pct = Math.floor((done / valid.length) * 100);
    if (pct <= lastPct || pct % 5 !== 0) return;
    lastPct = pct;
    db.execute('UPDATE user_import_jobs SET processed_rows=? WHERE id=?', [done, jobId]).catch(() => {});
  };

  const onPhase = (phase) =>
    db.execute('UPDATE user_import_jobs SET phase=? WHERE id=?', [phase, jobId]).catch(() => {});

  const created = await insertUsers(db, valid, onProgress, onPhase, tenant);

  // Everybody in `valid` with an address was given a random password that is deliberately
  // not reported back to the admin, because it goes to the person it belongs to instead.
  await onPhase?.('emailing');
  const emailedRows = valid.filter((r) => r.email && !r.temp_password_derived);
  let emailedOk = 0;
  if (emailedRows.length) {
    const { sendTemporaryPassword } = await import('./mailerService.js');
    // A few at a time. One at a time is needlessly slow over a few hundred rows; all at once
    // opens a few hundred sockets and gets us rate-limited.
    const BATCH = 5;
    for (let i = 0; i < emailedRows.length; i += BATCH) {
      const results = await Promise.all(emailedRows.slice(i, i + BATCH).map((r) =>
        sendTemporaryPassword({
          email: r.email,
          name: r.name,
          orgName: tenant?.name || tenant?.org_name || '',
          slug: tenant?.slug || '',
          password: r.temp_password,
          reason: 'onboard',
        }).catch(() => false)
      ));
      emailedOk += results.filter(Boolean).length;
    }
    if (emailedOk < emailedRows.length) {
      logger.warn(
        `user import job ${jobId}: ${emailedRows.length - emailedOk} of ${emailedRows.length} `
        + 'welcome emails could not be delivered; those employees must use a password reset.'
      );
    }
  }

  // The job is marked complete FIRST, using only columns that have always existed.
  await db.execute(
    `UPDATE user_import_jobs
        SET status='completed', phase=NULL, processed_rows=?, created_count=?, finished_at=NOW()
      WHERE id=?`,
    [created, created, jobId]
  );

  await db.execute(
    'UPDATE user_import_jobs SET emailed_count=?, email_failed_count=? WHERE id=?',
    [emailedOk, Math.max(0, emailedRows.length - emailedOk), jobId]
  ).catch((e) => {
    logger.warn(
      `user import job ${jobId}: could not record email counts (${e.message}). `
      + 'The import itself completed; apply migration 031 to record these.'
    );
  });
  logger.info(`user import job ${jobId}: created ${created} accounts`);
}

async function saveErrors(db, jobId, errors) {
  for (let i = 0; i < errors.length; i += INSERT_CHUNK) {
    const chunk = errors.slice(i, i + INSERT_CHUNK);
    await db.query(
      'INSERT INTO user_import_errors (job_id, `row_number`, employee_id, email, message) VALUES ?',
      [chunk.map((e) => [jobId, e.row_number, e.employee_id || null, e.email || null, e.message])]
    );
  }
}

/** A job whose process died mid-run would otherwise sit in 'running' forever. */
async function isStale(db, jobId) {
  const [rows] = await db.execute(
    `SELECT TIMESTAMPDIFF(MINUTE, updated_at, NOW()) AS idle_min FROM user_import_jobs WHERE id=?`,
    [jobId]
  );
  const idle = Number(rows[0]?.idle_min ?? 0);
  if (idle < STALE_JOB_MINUTES) return false;

  // The insert runs in a single transaction, so a crashed job created nothing - marking it
  // failed is safe and leaves no half-imported users behind.
  await db.execute(
    "UPDATE user_import_jobs SET status='failed', finished_at=NOW(), error_message='Interrupted (server restarted or crashed). No accounts were created.' WHERE id=? AND status IN ('pending','running')",
    [jobId]
  );
  return true;
}

export async function getJob(db, jobId) {
  const id = Number(jobId) || 0;
  const [rows] = await db.execute('SELECT * FROM user_import_jobs WHERE id=?', [id]);
  const job = rows[0];
  if (!job) throw notFound('Import job not found.');

  if (job.status === 'running' || job.status === 'pending') {
    if (await isStale(db, id)) {
      const [again] = await db.execute('SELECT * FROM user_import_jobs WHERE id=?', [id]);
      return { success: true, job: again[0], errors: await topErrors(db, id) };
    }
  }
  return { success: true, job, errors: await topErrors(db, id) };
}

async function topErrors(db, jobId, limit = 200) {
  // The row cap is built into the text, not bound: MySQL 8.4 rejects LIMIT as a
  // prepared-statement parameter.
  const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  const [rows] = await db.execute(
    'SELECT `row_number`, employee_id, email, message FROM user_import_errors '
    + `WHERE job_id=? ORDER BY \`row_number\` LIMIT ${n}`,
    [jobId]
  );
  return rows;
}

/** Full error list as CSV, for fixing the sheet offline. */
export async function errorsCsv(db, jobId) {
  const id = Number(jobId) || 0;
  const [rows] = await db.execute(
    'SELECT `row_number`, employee_id, email, message FROM user_import_errors WHERE job_id=? ORDER BY `row_number`',
    [id]
  );

  // These values came from an uploaded spreadsheet and are going straight back into one.
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };

  const lines = [['row', 'employee_id', 'email', 'error'].map(esc).join(',')];
  for (const r of rows) lines.push([r.row_number, r.employee_id, r.email, r.message].map(esc).join(','));
  return lines.join('\r\n');
}

export default {
  COLUMNS, MAX_ROWS, buildTemplate, preview, startImport, getJob, errorsCsv,
  tempPasswordFor, validateRows,
};

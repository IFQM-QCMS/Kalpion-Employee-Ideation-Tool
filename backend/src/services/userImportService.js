/**
 * Bulk employee import — spreadsheet in, user accounts out.
 *
 * The flow an org admin sees:
 *   1. Download a template (.xlsx) — pre-filled with headers, an example row,
 *      and a role dropdown containing ONLY the roles they are allowed to assign.
 *   2. Fill one row per employee.
 *   3. Upload. The file is validated and a preview is shown (dry run) — nothing
 *      is written yet.
 *   4. Confirm. Accounts are created as a background job the UI polls.
 *
 * Design notes that matter (each of these is load-bearing):
 *
 *  • RBAC. Every row's role is checked against userService.assignableRoles(actor)
 *    — the same function single-user creation uses. A tenant admin typing
 *    "super_admin" into a cell gets that row rejected, not a promotion.
 *
 *  • Create-only, never upsert. If an employee_id or email already exists the
 *    row is SKIPPED and reported. Silently updating an existing user would let a
 *    careless sheet overwrite somebody's role or reset their password — an
 *    upload should never be able to do that.
 *
 *  • Hashing happens off the main thread, BEFORE the transaction opens.
 *    bcryptjs blocks; 10k hashes inline would freeze the server for ~39 minutes
 *    (see hashPool). And a transaction must never be held open for the minutes
 *    that hashing takes.
 *
 *  • Manager cycles are rejected. The super-admin hierarchy screen renders the
 *    reporting tree by recursion — a sheet where A reports to B and B reports to
 *    A would send it into infinite recursion and hang the browser.
 *
 *  • Every field is length-checked before insert. A single over-long value would
 *    otherwise abort an entire multi-row INSERT under MySQL strict mode, failing
 *    999 good rows because of one bad one.
 */
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { assignableRoles } from './userService.js';
import { hashMany } from './hashPool.js';
import { badRequest, notFound, ApiError } from '../utils/respond.js';
import logger from '../utils/logger.js';
import { isUsername, claimUsername, indexUser } from './directoryService.js';

// ── Limits ──────────────────────────────────────────────────────────────────
export const MAX_ROWS = 20000;      // hard ceiling per upload
const INSERT_CHUNK = 500;           // rows per multi-row INSERT
const TEMP_PASSWORD_ROUNDS = 10;    // see tempPasswordFor() for why not 12
const STALE_JOB_MINUTES = 30;

// ── Sheet definition (drives BOTH the template and the parser) ──────────────
export const COLUMNS = [
  { key: 'employee_id', header: 'employee_id', required: true,  max: 20,  width: 16,
    note: 'Unique ID for the employee. Required. This is the key the import de-duplicates on.' },
  // MOM §13.4 — salutation / first name / last name, and a birth YEAR rather
  // than a full date. The temporary password only ever used the year, so the
  // day and month were personal data collected for no purpose.
  { key: 'salutation',  header: 'salutation',  required: false, max: 10,  width: 11,
    note: 'Optional. Mr / Ms / Mrs / Dr / Prof.' },
  { key: 'first_name',  header: 'first_name',  required: true,  max: 60,  width: 18,
    note: 'Required.' },
  { key: 'last_name',   header: 'last_name',   required: false, max: 60,  width: 18,
    note: 'Optional, but recommended — it is part of the displayed name.' },
  // Since migration 025 an account signs in with a username OR an address, so
  // neither is required on its own — the pair is, and that is checked per row.
  // A workforce with no company mailboxes is the normal case this serves.
  { key: 'username',    header: 'username',    required: false, max: 50,  width: 18,
    note: 'Sign-in name, e.g. yashas123. Give this OR an email. Unique across the whole platform.' },
  { key: 'email',       header: 'email',       required: false, max: 150, width: 28,
    note: 'Work email. Give this OR a username. Must be unique.' },
  { key: 'year_of_birth', header: 'year_of_birth', required: true, max: 4, width: 14,
    note: 'Four-digit year, e.g. 1994. Required — the first-login password is built from it.' },
  { key: 'role',        header: 'role',        required: false, max: 20,  width: 16,
    note: 'Leave blank for "employee". Pick from the dropdown.' },
  { key: 'department',  header: 'department',  required: false, max: 100, width: 18, note: 'Optional.' },
  { key: 'business_unit', header: 'business_unit', required: false, max: 100, width: 18, note: 'Optional.' },
  { key: 'location',    header: 'location',    required: false, max: 100, width: 16, note: 'Optional.' },
  // Required, like every other route that creates a user. A mobile number is
  // what a sign-in code, a password reset and any later confirmation are sent
  // to, and an import is precisely where a few hundred accounts would otherwise
  // arrive without one — invisibly, until somebody cannot get in.
  { key: 'phone',       header: 'phone',       required: true,  max: 20,  width: 16,
    note: 'Required. Mobile number — sign-in codes and password resets are sent to it.' },
  { key: 'manager_employee_id', header: 'manager_employee_id', required: false, max: 20, width: 20,
    note: "Optional. The employee_id of this person's manager — either an existing employee or another row in this sheet." },
];

const HEADER_ALIASES = new Map();
for (const c of COLUMNS) {
  const add = (s) => HEADER_ALIASES.set(normaliseHeader(s), c.key);
  add(c.header);
  add(c.key);
}
// A few forgiving spellings, so a hand-edited header doesn't fail the upload.
[['emp id', 'employee_id'], ['empid', 'employee_id'], ['employee code', 'employee_id'],
 // 'name' and 'date_of_birth' are the pre-MOM headers. Kept as aliases so a
 // sheet an organisation already has on disk still imports: first_name absorbs
 // a full name and is split below, and a full date is reduced to its year.
 ['full name', 'first_name'], ['employee name', 'first_name'], ['name', 'first_name'],
 ['first name', 'first_name'], ['last name', 'last_name'], ['surname', 'last_name'],
 ['title', 'salutation'],
 ['email address', 'email'], ['e mail', 'email'],
  ['user name', 'username'], ['login', 'username'], ['login id', 'username'], ['userid', 'username'],
 ['dob', 'year_of_birth'], ['birth date', 'year_of_birth'], ['date of birth', 'year_of_birth'],
 ['date_of_birth', 'year_of_birth'], ['birth year', 'year_of_birth'], ['yob', 'year_of_birth'],
 ['designation', 'role'], ['manager', 'manager_employee_id'], ['manager id', 'manager_employee_id'],
 ['reports to', 'manager_employee_id'], ['mobile', 'phone'], ['contact', 'phone'],
 ['dept', 'department'], ['bu', 'business_unit'],
].forEach(([alias, key]) => HEADER_ALIASES.set(normaliseHeader(alias), key));

function normaliseHeader(s) {
  return String(s ?? '').toLowerCase().replace(/[\s_\-.]+/g, ' ').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Temporary password
// ─────────────────────────────────────────────────────────────────────────────

/**
 * First 4 letters of the name + year of birth, e.g. "Yashas" + 1998 -> "yash1998".
 *
 * This is deliberately a low-entropy, DERIVED credential: any colleague who
 * knows someone's name and birth year can compute it. That is acceptable only
 * because it is a bootstrap credential — `must_change_password` is set, and the
 * auth middleware refuses to serve any other endpoint until it has been
 * replaced. It is exempt from the normal password policy (MIN_PASSWORD_LENGTH)
 * for the same reason; the password the employee then chooses is not.
 *
 * It is hashed at cost 10 rather than 12. Stretching a password that is
 * guessable by design buys nothing — the protection here is the forced change,
 * not the hash cost — and cost 12 would double the import time for no security
 * gain. Real, user-chosen passwords are still hashed at 12.
 */
export function tempPasswordFor(name, birthYear, employeeId) {
  const letters = String(name ?? '').normalize('NFKD').replace(/[^A-Za-z]/g, '').toLowerCase();
  let base = letters.slice(0, 4);
  if (!base) {
    // Names in a non-Latin script leave us nothing to slice; fall back to the
    // employee id so the password is still per-person rather than a shared one.
    base = String(employeeId ?? '').replace(/[^A-Za-z0-9]/g, '').toLowerCase().slice(0, 4);
  }
  if (!base) base = 'user';
  return `${base.padEnd(4, 'x')}${birthYear}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Template
// ─────────────────────────────────────────────────────────────────────────────

/** Build the .xlsx template. The role dropdown is scoped to the actor's rights. */
export async function buildTemplate(actorRole) {
  const roles = assignableRoles(actorRole);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'IFQM';
  wb.created = new Date();

  const ws = wb.addWorksheet('Employees');
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

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
    year_of_birth: '1994',
    role: 'employee',
    department: 'Production',
    business_unit: 'Plant 1',
    location: 'Bengaluru',
    phone: '9876543210',
    manager_employee_id: 'EMP002',
  });
  ws.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };

  // Role dropdown, restricted to what THIS admin may assign. A super_admin sees
  // 'admin' in the list; an admin does not.
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
    // Dates as text, so "1994-08-21" is not silently reformatted by Excel.
    ws.getCell(`D${r}`).numFmt = '@';
  }

  // A second sheet with the rules, so the admin does not have to guess.
  const help = wb.addWorksheet('Instructions');
  help.columns = [{ width: 24 }, { width: 96 }];
  const h = (a, b, bold = false) => {
    const row = help.addRow([a, b]);
    if (bold) row.font = { bold: true };
    row.alignment = { vertical: 'top', wrapText: true };
  };
  h('IFQM — Bulk employee import', '', true);
  h('', '');
  h('How it works', 'Fill in one row per employee on the "Employees" sheet, then upload this file in Admin → User List → Bulk Import. Delete the grey example row before uploading (or leave it — EMP001 will simply be reported as invalid if the data is not real).');
  h('', '');
  h('First-time password', 'Each employee is given a temporary password: the first 4 letters of their name, lowercased, followed by their year of birth. Example: "Asha Rao" born 1994 → asha1994. They MUST change it the first time they sign in — until they do, they cannot use any other part of the app.');
  h('Important', 'This temporary password is guessable by anyone who knows the person\'s name and birth year. Ask employees to sign in and change it promptly, and treat the account as not-yet-secure until they have.');
  h('', '');
  h('Duplicates', 'Rows whose employee_id or email already exists are SKIPPED, never overwritten. Re-uploading the same file is therefore safe — it will not touch anyone who already has an account.');
  h('Roles', `You may assign: ${roles.join(', ')}. Anything else will be rejected. Leave the cell blank for "employee".`);
  h('Managers', 'manager_employee_id must be the employee_id of somebody who already exists, or of another row in this same sheet. Circular reporting lines (A reports to B, B reports to A) are rejected.');
  h('Limit', `Up to ${MAX_ROWS.toLocaleString()} employees per file.`);
  h('', '');
  h('Columns', '', true);
  for (const c of COLUMNS) h(c.header + (c.required ? ' (required)' : ''), c.note);

  return wb.xlsx.writeBuffer();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Parsing
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * Read the sheet into raw {rowNumber, values} objects.
 * Streams, so a hostile file cannot be expanded into memory — we bail the moment
 * the row cap is passed rather than after parsing the whole thing.
 */
async function parseSheet(buffer, filename) {
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
    /*
     * Load the whole workbook rather than stream it.
     *
     * The streaming WorkbookReader was intermittently blowing up inside exceljs
     * with "Cannot read properties of undefined (reading 'sheets')" — it depends
     * on the order entries come out of the zip, and reads the workbook model
     * before that model has necessarily been parsed. The same file parsed fine
     * one minute and 500'd the next. A parser that works most of the time is
     * worse than one that is merely slower, so: deterministic load.
     *
     * Memory is bounded by the 15 MB upload cap plus the MAX_ROWS check below;
     * a legitimate 20,000-row sheet is only a few MB of cell data.
     */
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
  const missing = COLUMNS.filter((c) => c.required && !found.has(c.key)).map((c) => c.header);
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

// ─────────────────────────────────────────────────────────────────────────────
//  Validation
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CURRENT_YEAR = new Date().getFullYear();

/** Accept a real date cell, an ISO date, or a bare 4-digit year. Nothing ambiguous. */
function parseBirth(raw) {
  const s = cellToString(raw);
  if (!s) return { error: 'year_of_birth is required (the first-login password is built from it).' };

  let year = null;

  if (/^\d{4}$/.test(s)) {
    year = Number(s);
  } else {
    // A full ISO date is still accepted so a sheet written against the old
    // template imports unchanged — only the year is kept. Anything else is
    // refused rather than guessed: 03/04/1994 is ambiguous, and guessing wrong
    // hands the employee a temporary password that does not work.
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) {
      return { error: 'year_of_birth must be a 4-digit year (e.g. 1994).' };
    }
    year = Number(m[1]);
  }

  if (year < 1900 || year > CURRENT_YEAR - 14) {
    return { error: `year_of_birth ${year} is out of range (1900–${CURRENT_YEAR - 14}).` };
  }
  return { year };
}

/**
 * Validate every row against the DB, the sheet itself, and the actor's rights.
 * Pure: touches no state, writes nothing. Used by both the dry run and the
 * commit, so the preview can never disagree with what actually happens.
 */
export async function validateRows(db, actor, records) {
  const allowedRoles = assignableRoles(actor.role);

  // Everything already in this tenant, so we can spot collisions cheaply.
  const [existing] = await db.query(
    'SELECT id, employee_id, LOWER(email) AS email, LOWER(username) AS username FROM users'
  );
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
    /*
     * MOM §13.4 — the sheet now carries first and last name separately. An old
     * sheet with a single `name` column maps onto first_name via the header
     * alias, so split it back out here rather than storing someone's full name
     * as their first name.
     */
    let firstName = (rec.first_name || '').trim();
    let lastName  = (rec.last_name  || '').trim();
    if (!lastName && firstName.includes(' ')) {
      const parts = firstName.split(/\s+/);
      firstName = parts.shift();
      lastName = parts.join(' ');
    }
    // `name` stays the displayed identity everywhere else in the product, so it
    // is composed rather than replaced — nothing downstream has to change.
    const name = [firstName, lastName].filter(Boolean).join(' ').trim();
    const email = (rec.email || '').trim().toLowerCase();
    const username = (rec.username || '').trim().toLowerCase();

    // ── required ──
    if (!employeeId) { reject(rec, 'employee_id is required.'); continue; }
    if (!name)       { reject(rec, 'name is required.'); continue; }
    if (!email && !username) {
      reject(rec, 'Give a username or an email — one of the two is how this person signs in.');
      continue;
    }
    if (username && !isUsername(username)) {
      reject(rec, `"${username}" is not a valid username — 3-30 characters of letters, numbers, dot, underscore or hyphen, including at least one letter.`);
      continue;
    }

    // ── lengths (a single over-long value would abort the whole batch INSERT) ──
    let tooLong = null;
    for (const c of COLUMNS) {
      const v = (rec[c.key] || '').trim();
      if (v && v.length > c.max) { tooLong = `${c.header} is too long (max ${c.max} characters).`; break; }
    }
    if (tooLong) { reject(rec, tooLong); continue; }

    if (email && !EMAIL_RE.test(email)) { reject(rec, `"${email}" is not a valid email address.`); continue; }

    // ── date of birth / temp password ──
    const birth = parseBirth(rec.year_of_birth);
    if (birth.error) { reject(rec, birth.error); continue; }

    // ── role: the RBAC gate ──
    const role = (rec.role || '').trim().toLowerCase() || 'employee';
    if (!allowedRoles.includes(role)) {
      reject(rec, `You are not allowed to assign the role "${role}". Allowed: ${allowedRoles.join(', ')}.`);
      continue;
    }

    // ── duplicates: inside the sheet ──
    const empKey = employeeId.toLowerCase();
    if (seenEmpId.has(empKey)) {
      reject(rec, `Duplicate employee_id "${employeeId}" — already used on row ${seenEmpId.get(empKey)}.`);
      continue;
    }
    if (email && seenEmail.has(email)) {
      reject(rec, `Duplicate email "${email}" — already used on row ${seenEmail.get(email)}.`);
      continue;
    }

    // ── duplicates: against existing users (SKIP, never overwrite) ──
    if (byEmpId.has(empKey)) {
      reject(rec, `An employee with ID "${employeeId}" already exists — row skipped (existing users are never modified by an import).`);
      continue;
    }
    if (email && emails.has(email)) {
      reject(rec, `A user with email "${email}" already exists — row skipped (existing users are never modified by an import).`);
      continue;
    }

    seenEmpId.set(empKey, rec.__row);
    if (email) seenEmail.set(email, rec.__row);

    /*
     * Usernames, twice over. Within the sheet and within this tenant is what can
     * be answered here; the platform-wide claim happens at insert time, because
     * a name may be held by a different customer entirely and this function is
     * deliberately pure — it reads nothing outside the tenant and writes
     * nothing at all, so the preview and the commit cannot disagree.
     */
    if (username) {
      if (seenUsername.has(username)) {
        reject(rec, `Duplicate username "${username}" — already used on row ${seenUsername.get(username)}.`);
        continue;
      }
      if (usernames.has(username)) {
        reject(rec, `A user with username "${username}" already exists — row skipped (existing users are never modified by an import).`);
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
      year_of_birth: birth.year,
      birth_year: birth.year,
      role,
      department:    (rec.department || '').trim() || null,
      business_unit: (rec.business_unit || '').trim() || null,
      location:      (rec.location || '').trim() || null,
      phone:         (rec.phone || '').trim() || null,
      manager_employee_id: (rec.manager_employee_id || '').trim() || null,
    });
  }

  // ── managers: resolve, then reject cycles ──
  resolveManagers(valid, byEmpId, reject);

  return { valid: valid.filter((r) => !r.__rejected), errors };
}

/**
 * A manager may be an existing employee or another row in this same sheet
 * (forward references are fine). Anything unresolvable, self-referential, or
 * circular is rejected.
 *
 * Cycles matter beyond tidiness: the org-hierarchy screen renders the reporting
 * tree by recursing into each node's children, so A→B→A would recurse until the
 * browser tab dies.
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
        `Manager "${r.manager_employee_id}" was not found — it must be an existing employee_id or another row in this sheet.`);
    }
  }

  // Cycles can only form among NEW rows: an existing user's manager was set
  // before this import and can never point at somebody who does not exist yet.
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

// ─────────────────────────────────────────────────────────────────────────────
//  Commit
// ─────────────────────────────────────────────────────────────────────────────

function avatarInitials(name) {
  return String(name || '').split(' ').filter(Boolean).slice(0, 2)
    .map((w) => w[0].toUpperCase()).join('').slice(0, 4);  // column is VARCHAR(4)
}

/**
 * Insert the validated rows.
 *
 * Hashing happens first, on worker threads, OUTSIDE the transaction — holding a
 * transaction open for the minutes bcrypt needs would pin locks and undo log for
 * no reason.
 *
 * Then one transaction: insert everyone with manager_id NULL, then link managers
 * in a second pass. The two passes sidestep insert-ordering entirely — a row can
 * reference a manager that appears later in the same sheet without us having to
 * topologically sort anything.
 */
async function insertUsers(db, rows, onProgress, onPhase, tenant = null) {
  const hashes = await hashMany(
    rows.map((r) => ({ key: r.employee_id, password: tempPasswordFor(r.name, r.birth_year, r.employee_id) })),
    TEMP_PASSWORD_ROUNDS,
    onProgress
  );

  await onPhase?.('inserting');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Pass 1 — everyone, manager_id NULL for now.
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      const values = chunk.map((r) => [
        r.employee_id, r.username, r.name, r.email, hashes.get(r.employee_id),
        r.phone, r.department, r.business_unit, r.location, r.role,
        avatarInitials(r.name), r.salutation, r.first_name, r.last_name, r.year_of_birth,
      ]);
      await conn.query(
        `INSERT INTO users
           (employee_id, username, name, email, password_hash, phone, department, business_unit,
            location, role, avatar_initials, salutation, first_name, last_name, year_of_birth,
            status, points, must_change_password, password_changed_at)
         VALUES ?`,
        // The trailing constants are appended per-row below via map, so keep the
        // shape in sync with the column list above.
        [values.map((v) => [...v, 'active', 0, 1, new Date()])]
      );
    }

    // Pass 2 — resolve manager ids now that every row has one.
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

    /*
     * Claim the imported usernames platform-wide, now that the rows exist.
     *
     * validateRows() already refused any name held inside this tenant, but a
     * username is unique across every customer and that question can only be
     * answered by the registry. Any name lost here — because another
     * organisation claimed it between the preview and now — is cleared from the
     * account rather than left in place: a username that resolves to somebody
     * else's database would send this employee to a stranger's login, which is
     * far worse than an account that signs in by email or has to be given a
     * name by hand.
     */
    if (tenant) {
      const named = rows.filter((r) => r.username);
      for (const r of named) {
        const userId = idByEmp.get(r.employee_id.toLowerCase());
        if (!userId) continue;
        const won = await claimUsername(tenant, userId, r.username).catch(() => false);
        if (!won) {
          logger.warn(`import: username "${r.username}" was already taken — cleared on ${r.employee_id}`);
          await db.execute('UPDATE users SET username = NULL WHERE id = ?', [userId]).catch(() => {});
        }
      }
      // Addresses and numbers go in the directory the ordinary way, so imported
      // accounts can sign in without an org code like any other.
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

// ─────────────────────────────────────────────────────────────────────────────
//  Jobs
// ─────────────────────────────────────────────────────────────────────────────

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
    sample: valid.slice(0, 10).map((r) => ({
      employee_id: r.employee_id, name: r.name, email: r.email, role: r.role,
      temp_password: tempPasswordFor(r.name, r.birth_year, r.employee_id),
    })),
    errors: errors.slice(0, 200),
  };
}

/** Kick off a real import. Returns immediately; the work happens in background. */
export async function startImport(db, actor, buffer, filename, tenant = null) {
  // One at a time per tenant: two concurrent imports of the same file would race
  // on the same employee_ids and one would die on the unique index.
  const [running] = await db.query(
    "SELECT id FROM user_import_jobs WHERE status IN ('pending','running') ORDER BY id DESC LIMIT 1"
  );
  if (running.length && !(await isStale(db, running[0].id))) {
    throw new ApiError(409, 'An import is already running for this organisation. Wait for it to finish.');
  }

  // Parse + validate up-front so an unusable file fails fast, with a real error,
  // instead of "succeeding" into a background job that then fails.
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
  runJob(db, jobId, valid).catch(async (err) => {
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

async function runJob(db, jobId, valid) {
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

  await db.execute(
    `UPDATE user_import_jobs
        SET status='completed', phase=NULL, processed_rows=?, created_count=?, finished_at=NOW()
      WHERE id=?`,
    [created, created, jobId]
  );
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

  // The insert runs in a single transaction, so a crashed job created nothing —
  // marking it failed is safe and leaves no half-imported users behind.
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
  // prepared-statement parameter. Clamped to an integer first, so nothing but a
  // number can reach the statement.
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

  // These values came from an uploaded spreadsheet and are going straight back
  // into one. A cell starting with = + - or @ is executed as a formula by Excel,
  // so neutralise it — otherwise we would be handing the admin a CSV-injection
  // payload authored by whoever supplied the sheet.
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

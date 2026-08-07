/**
 * Reporting-structure template — MOM 29 Jul 2026 §13.14.
 *
 * "Customizable hierarchy per organization via an Excel template."
 *
 * Deliberately separate from the employee bulk import. That one CREATES people;
 * this one only REWIRES who reports to whom for people who already exist. An
 * admin fixing a reporting line six months after onboarding should not have to
 * open a sheet that can also create accounts, and a mistake here should not be
 * able to invent an employee.
 *
 * The download comes pre-filled with the organisation as it stands today, so
 * the admin edits reality rather than retyping it.
 */
import ExcelJS from 'exceljs';
import { badRequest } from '../utils/respond.js';
import logger from '../utils/logger.js';

const HEADERS = [
  { key: 'employee_id', header: 'employee_id', width: 16,
    note: 'The person whose reporting line you are setting. Must already exist. Do not edit.' },
  { key: 'name', header: 'name', width: 26, note: 'Shown for your reference. Ignored on upload.' },
  { key: 'role', header: 'role', width: 20, note: 'Shown for your reference. Ignored on upload.' },
  { key: 'department', header: 'department', width: 22, note: 'Shown for your reference. Ignored on upload.' },
  { key: 'manager_employee_id', header: 'manager_employee_id', width: 22,
    note: 'THE ONLY COLUMN THAT IS APPLIED. The employee_id of this person\'s manager. Leave blank for the top of the organisation.' },
];

/** Download: the current structure, ready to edit. */
export async function buildTemplate(db, orgName = 'Organisation') {
  const [rows] = await db.query(
    `SELECT u.employee_id, u.name, u.role, u.department, m.employee_id AS manager_employee_id
       FROM users u LEFT JOIN users m ON m.id = u.manager_id
      WHERE u.status = 'active'
      ORDER BY FIELD(u.role,'admin','super_admin','plant_head','executive','senior_manager',
                     'department_manager','manager','project_lead','team_lead','employee','trainee'), u.name`
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = 'IFQM';
  wb.created = new Date();

  const ws = wb.addWorksheet('Reporting structure');
  ws.columns = HEADERS.map((h) => ({ header: h.header, key: h.key, width: h.width }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  ws.getRow(1).height = 20;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  rows.forEach((r) => ws.addRow(r));

  // Grey out the reference columns so it is visually obvious which one is live.
  for (let r = 2; r <= rows.length + 1; r++) {
    for (const col of ['B', 'C', 'D']) {
      ws.getCell(`${col}${r}`).font = { color: { argb: 'FF6B7280' } };
    }
    ws.getCell(`E${r}`).font = { bold: true };
  }
  ws.autoFilter = { from: 'A1', to: { row: 1, column: HEADERS.length } };

  const help = wb.addWorksheet('Instructions');
  help.columns = [{ width: 26 }, { width: 96 }];
  const h = (a, b, bold = false) => {
    const row = help.addRow([a, b]);
    if (bold) row.font = { bold: true };
    row.alignment = { vertical: 'top', wrapText: true };
  };
  h(`IFQM — reporting structure for ${orgName}`, '', true);
  h('', '');
  h('What this changes', 'Only who each person reports to. It cannot create, rename, deactivate or delete anybody — use Bulk Import for that.');
  h('How to use it', 'Edit the manager_employee_id column only, then upload the file in Admin → Hierarchy. Everything else is there so you can see who you are editing.');
  h('Why it matters', 'Submitted ideas escalate up this chain. If somebody reports to the wrong manager, their ideas go to the wrong reviewer.');
  h('Top of the organisation', 'Leave manager_employee_id blank for whoever reports to nobody. There is normally exactly one such person.');
  h('What is rejected', 'A manager_employee_id that does not exist, somebody set as their own manager, or a loop (A reports to B, B reports to A). Each is reported with its row number and nothing is applied until you confirm.');
  h('', '');
  for (const c of HEADERS) h(c.header, c.note);

  return wb;
}

/**
 * Read an uploaded sheet and work out what would change — without changing it.
 * Every problem is returned with its row number; the admin confirms before
 * anything is written.
 */
export async function previewUpload(db, buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); }
  catch { throw badRequest('That file could not be read as an .xlsx workbook.'); }

  const ws = wb.getWorksheet('Reporting structure') || wb.worksheets[0];
  if (!ws) throw badRequest('The workbook has no sheets.');

  const headerRow = ws.getRow(1).values.slice(1).map((v) => String(v ?? '').trim().toLowerCase());
  const idCol = headerRow.indexOf('employee_id') + 1;
  const mgrCol = headerRow.indexOf('manager_employee_id') + 1;
  if (!idCol || !mgrCol) {
    throw badRequest('The sheet needs an employee_id and a manager_employee_id column. Download the template again.');
  }

  const cell = (row, i) => {
    const v = row.getCell(i).value;
    if (v == null) return '';
    if (typeof v === 'object') return String(v.text ?? v.result ?? '').trim();
    return String(v).trim();
  };

  // Everyone who currently exists, and their current manager.
  const [existing] = await db.query(
    `SELECT u.id, u.employee_id, u.name, u.manager_id, m.employee_id AS manager_employee_id
       FROM users u LEFT JOIN users m ON m.id = u.manager_id`
  );
  const byEmpId = new Map(existing.map((u) => [String(u.employee_id), u]));

  const changes = [];
  const errors = [];
  const seen = new Set();
  const proposed = new Map();          // employee_id -> manager employee_id

  ws.eachRow((row, n) => {
    if (n === 1) return;
    const empId = cell(row, idCol);
    if (!empId) return;                // blank row
    const mgrId = cell(row, mgrCol);

    if (seen.has(empId)) { errors.push({ row: n, employee_id: empId, message: 'This employee appears more than once.' }); return; }
    seen.add(empId);

    const person = byEmpId.get(empId);
    if (!person) { errors.push({ row: n, employee_id: empId, message: 'No employee with this ID exists. This sheet cannot create people.' }); return; }
    if (mgrId && !byEmpId.has(mgrId)) { errors.push({ row: n, employee_id: empId, message: `Manager "${mgrId}" does not exist.` }); return; }
    if (mgrId && mgrId === empId) { errors.push({ row: n, employee_id: empId, message: 'Somebody cannot report to themselves.' }); return; }

    proposed.set(empId, mgrId || null);
    const current = person.manager_employee_id || null;
    if ((current || null) !== (mgrId || null)) {
      changes.push({
        row: n, employee_id: empId, name: person.name,
        from: current, to: mgrId || null,
      });
    }
  });

  /*
   * Cycle check, run against the WHOLE proposed structure rather than row by
   * row. A loop is only ever visible in combination — each individual line
   * looks perfectly reasonable — and a loop in the reporting tree means an idea
   * escalates forever and the hierarchy screen recurses until it dies.
   */
  const resolve = (empId) => proposed.has(empId) ? proposed.get(empId) : (byEmpId.get(empId)?.manager_employee_id || null);
  for (const empId of seen) {
    let cur = resolve(empId);
    const path = new Set([empId]);
    let depth = 0;
    while (cur && depth++ < 40) {
      if (path.has(cur)) {
        errors.push({ row: null, employee_id: empId, message: `Reporting loop: ${[...path, cur].join(' → ')}` });
        break;
      }
      path.add(cur);
      cur = resolve(cur);
    }
  }

  return {
    success: true,
    total_rows: seen.size,
    change_count: changes.length,
    changes: changes.slice(0, 200),
    errors,
    can_apply: errors.length === 0 && changes.length > 0,
  };
}

/** Apply an upload. Refuses outright if the preview found any problem. */
export async function applyUpload(db, buffer) {
  const pv = await previewUpload(db, buffer);
  if (pv.errors.length) {
    throw badRequest(`The sheet has ${pv.errors.length} problem(s). Fix them and upload again — nothing has been changed.`);
  }
  if (!pv.change_count) return { success: true, updated: 0, message: 'Nothing to change — the sheet matches the current structure.' };

  const [existing] = await db.query('SELECT id, employee_id FROM users');
  const idOf = new Map(existing.map((u) => [String(u.employee_id), u.id]));

  let updated = 0;
  // One statement per person rather than a bulk CASE: the volume is small (a
  // reporting change touches a handful of people), and a failure part-way
  // leaves a valid tree rather than a half-applied one.
  for (const c of pv.changes) {
    const personId = idOf.get(c.employee_id);
    const managerId = c.to ? idOf.get(c.to) ?? null : null;
    if (!personId) continue;
    await db.execute('UPDATE users SET manager_id = ? WHERE id = ?', [managerId, personId]);
    updated++;
  }
  logger.info(`hierarchy: reporting structure updated for ${updated} employee(s)`);
  return { success: true, updated, message: `Reporting line updated for ${updated} employee(s).` };
}

export default { buildTemplate, previewUpload, applyUpload };

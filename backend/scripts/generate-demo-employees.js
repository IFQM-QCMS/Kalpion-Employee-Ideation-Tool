/**
 * Generate a dummy employee sheet for the bulk importer.
 *
 *   node scripts/generate-demo-employees.js [count] [outfile]
 *   node scripts/generate-demo-employees.js 500 ../docs/IFQM_Demo_Employees_500.xlsx
 *
 * Why this exists: demonstrating the tool, load-testing the user list, and
 * exercising the approval chain all need a realistic organisation, and typing
 * one by hand is not realistic. Every constraint the real importer enforces is
 * honoured here, so the output uploads cleanly rather than producing 500 error
 * rows that then have to be read.
 *
 * The important one is the reporting tree. `manager_employee_id` must name
 * somebody who either already exists in the tenant or appears in this same
 * sheet, so managers are generated before the people who report to them and
 * every row points strictly upward. A tree that referenced itself, or referenced
 * a row further down, would import as a pile of orphans and the escalation chain
 * would have nowhere to send anything.
 *
 * The column list is imported from the importer itself rather than restated, so
 * this file cannot drift out of step with the format it is producing.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { COLUMNS } from '../src/services/userImportService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Deterministic randomness ────────────────────────────────────────────────
// Seeded on purpose: regenerating the sheet gives the same people, so a demo
// scripted around "Priya Nair in Quality" does not break on the next run.
let seed = 20260807;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

// ── Name pools ──────────────────────────────────────────────────────────────
const MALE = [
  'Arjun', 'Rahul', 'Vikram', 'Suresh', 'Manoj', 'Anil', 'Ramesh', 'Karthik', 'Sandeep',
  'Prakash', 'Deepak', 'Naveen', 'Girish', 'Mahesh', 'Sunil', 'Rajesh', 'Ashok', 'Vinod',
  'Harish', 'Ganesh', 'Kiran', 'Srinivas', 'Balaji', 'Nitin', 'Pradeep', 'Sanjay', 'Vivek',
  'Mohan', 'Yogesh', 'Rohit', 'Amit', 'Shankar', 'Venkatesh', 'Dinesh', 'Praveen', 'Satish',
  'Ravi', 'Bhaskar', 'Umesh', 'Jagdish', 'Nagaraj', 'Chetan', 'Abhishek', 'Sagar', 'Tarun',
];
const FEMALE = [
  'Priya', 'Anitha', 'Lakshmi', 'Meena', 'Kavita', 'Shruti', 'Divya', 'Sunitha', 'Rekha',
  'Pooja', 'Sneha', 'Asha', 'Radha', 'Nandini', 'Vidya', 'Sushma', 'Geetha', 'Bhavana',
  'Swathi', 'Aarti', 'Deepa', 'Manjula', 'Roopa', 'Shilpa', 'Padma', 'Latha', 'Jyothi',
  'Chaitra', 'Ramya', 'Vandana', 'Neha', 'Ankita', 'Preethi', 'Sowmya', 'Harini', 'Kalpana',
];
const SURNAMES = [
  'Sharma', 'Rao', 'Nair', 'Iyer', 'Reddy', 'Kulkarni', 'Desai', 'Patil', 'Shetty', 'Menon',
  'Gowda', 'Hegde', 'Bhat', 'Naidu', 'Pillai', 'Joshi', 'Deshpande', 'Kamath', 'Prabhu',
  'Chandran', 'Krishnan', 'Subramanian', 'Varma', 'Mehta', 'Shah', 'Agarwal', 'Bose',
  'Chatterjee', 'Mukherjee', 'Sinha', 'Verma', 'Tiwari', 'Pandey', 'Yadav', 'Kaur', 'Singh',
  'Ahmed', 'Khan', 'Fernandes', 'D’Souza', 'Pinto', 'Thomas', 'Jacob', 'Mathew', 'Kurian',
];

// A manufacturing MSME's real shape, not a software company's.
const DEPARTMENTS = [
  'Production', 'Quality Assurance', 'Maintenance', 'Stores & Logistics', 'Tool Room',
  'Design & Engineering', 'Purchase', 'Human Resources', 'Finance & Accounts',
  'Safety & EHS', 'Information Technology', 'Dispatch & Packing',
];
/*
 * A site and the unit that occupies it are the same fact, so they are declared
 * together. Picking them independently produced people in "Plant 1, Coimbatore"
 * when Plant 1 is in Bengaluru.
 */
const SITES = [
  { business_unit: 'Plant 1', location: 'Bengaluru' },
  { business_unit: 'Plant 2', location: 'Mysuru' },
  { business_unit: 'Plant 3', location: 'Hosur' },
  { business_unit: 'Corporate Office', location: 'Chennai' },
];
const DOMAIN = 'vertexprecision.co.in';

/*
 * The pyramid. Ratios are picked to look like a real mid-size manufacturer:
 * one plant head, a thin layer of senior management, and most of the headcount
 * on the floor. An org chart with 40 managers and 60 workers would exercise the
 * approval chain in a way no real customer ever will.
 */
const LAYERS = [
  { role: 'plant_head',         share: 0.002, ageMin: 48, ageMax: 58 },
  { role: 'senior_manager',     share: 0.006, ageMin: 42, ageMax: 54 },
  // One per department (see DEPARTMENTS above), so every department has an
  // owner and none of them import with nobody in charge.
  { role: 'department_manager', share: 0.024, ageMin: 38, ageMax: 50 },
  { role: 'manager',            share: 0.044, ageMin: 34, ageMax: 48 },
  { role: 'project_lead',       share: 0.060, ageMin: 30, ageMax: 44 },
  { role: 'team_lead',          share: 0.110, ageMin: 27, ageMax: 42 },
  { role: 'employee',           share: 0.642, ageMin: 22, ageMax: 55 },
  { role: 'trainee',            share: 0.120, ageMin: 19, ageMax: 25 },
];

const THIS_YEAR = new Date().getFullYear();

function build(count) {
  const rows = [];
  const usedEmails = new Set();
  const byRole = Object.create(null);
  let n = 0;

  // Work out how many of each layer, giving the remainder to 'employee' so the
  // total lands exactly on `count` however the rounding falls.
  const sizes = {};
  let assigned = 0;
  for (const l of LAYERS) {
    if (l.role === 'employee') continue;
    sizes[l.role] = Math.max(1, Math.round(count * l.share));
    assigned += sizes[l.role];
  }
  sizes.employee = Math.max(1, count - assigned);

  const emailFor = (first, last) => {
    const base = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '');
    let addr = `${base}@${DOMAIN}`;
    let i = 2;
    while (usedEmails.has(addr)) addr = `${base}${i++}@${DOMAIN}`;
    usedEmails.add(addr);
    return addr;
  };

  // Round-robin cursors, one per layer. Managers are handed out in turn rather
  // than at random: random assignment reliably leaves some managers with no
  // reports at all and others with twenty, which is not what an org chart looks
  // like and makes the escalation chain lopsided when demoed.
  const cursor = Object.create(null);

  for (const [li, layer] of LAYERS.entries()) {
    byRole[layer.role] = [];
    for (let i = 0; i < sizes[layer.role]; i++) {
      const female = rnd() < 0.32;             // realistic for a plant floor
      const first = female ? pick(FEMALE) : pick(MALE);
      const last = pick(SURNAMES);
      const salutation = female ? (rnd() < 0.35 ? 'Mrs' : 'Ms') : 'Mr';
      const employeeId = `EMP${String(++n).padStart(4, '0')}`;

      // Everyone reports one layer up. Walk further up only if that layer is
      // empty, which can only happen on a very small sheet.
      let manager = null;
      for (let up = li - 1; up >= 0 && !manager; up--) {
        const pool = byRole[LAYERS[up].role];
        if (pool && pool.length) {
          const key = LAYERS[up].role;
          cursor[key] = (cursor[key] ?? -1) + 1;
          manager = pool[cursor[key] % pool.length];
        }
      }

      /*
       * Which department someone belongs to is decided at the level that owns a
       * department, and inherited below it.
       *
       * Inheriting it all the way from the top was wrong and looked it: the
       * plant head got one random department, 85% of the layer below copied it,
       * and by the bottom of the tree 378 of 500 people worked in the Tool Room.
       * A plant head runs every department, so there is nothing to inherit from
       * them — the department manager is the first person who actually owns one.
       */
      let department;
      let site;
      if (layer.role === 'plant_head') {
        department = 'Plant Leadership';
        site = SITES[SITES.length - 1];                       // corporate office
      } else if (layer.role === 'senior_manager') {
        department = 'Operations Management';
        site = SITES[i % SITES.length];
      } else if (layer.role === 'department_manager') {
        // One owner per department, cycling so every department is covered.
        department = DEPARTMENTS[i % DEPARTMENTS.length];
        site = SITES[i % SITES.length];
      } else {
        department = manager ? manager.department : pick(DEPARTMENTS);
        site = manager
          ? { business_unit: manager.business_unit, location: manager.location }
          : pick(SITES);
      }

      const row = {
        employee_id: employeeId,
        salutation,
        first_name: first,
        last_name: last,
        email: emailFor(first, last),
        year_of_birth: String(THIS_YEAR - int(layer.ageMin, layer.ageMax)),
        role: layer.role,
        department,
        business_unit: site.business_unit,
        location: site.location,
        phone: `${pick(['9', '8', '7', '6'])}${String(int(0, 999999999)).padStart(9, '0')}`,
        manager_employee_id: manager ? manager.employee_id : '',
      };
      rows.push(row);
      byRole[layer.role].push(row);
    }
  }
  return rows;
}

async function main() {
  const count = Math.max(1, parseInt(process.argv[2], 10) || 500);
  // Defaults into docs/, where the sample sheets and the rest of the project
  // documentation live. Pass a second argument to write somewhere else.
  const out = path.resolve(__dirname, '..', process.argv[3] || `../docs/IFQM_Demo_Employees_${count}.xlsx`);
  const rows = build(count);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'IFQM';
  wb.created = new Date();

  const ws = wb.addWorksheet('Employees');
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  ws.getRow(1).height = 20;
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  rows.forEach((r) => ws.addRow(r));

  // year_of_birth as text. Left as a number, Excel helpfully reformats 1994 into
  // a date on some locales and the import then rejects the whole column.
  const yobCol = ws.getColumn(COLUMNS.findIndex((c) => c.key === 'year_of_birth') + 1).letter;
  for (let r = 2; r <= rows.length + 1; r++) ws.getCell(`${yobCol}${r}`).numFmt = '@';
  ws.autoFilter = { from: 'A1', to: { row: 1, column: COLUMNS.length } };

  // ── A second sheet, so whoever opens this knows what they are looking at ──
  const info = wb.addWorksheet('About this file');
  info.columns = [{ width: 26 }, { width: 92 }];
  const line = (a, b, bold = false) => {
    const row = info.addRow([a, b]);
    if (bold) row.font = { bold: true };
    row.alignment = { vertical: 'top', wrapText: true };
  };
  line('IFQM — demo employee data', '', true);
  line('', '');
  line('What this is', `${rows.length} fictional employees for demonstrations and testing. Every name, email address and phone number is invented. No real person's data appears in this file.`);
  line('How to use it', 'Admin → User List → Bulk Import → upload the file. Review the preview, then confirm.');
  line('Reporting structure', 'Each person reports to someone one level above them, and departments follow the manager, so the approval chain works end to end after import.');
  line('First-time passwords', 'Each imported employee gets a temporary password: the first four letters of their first name, lowercase, plus their year of birth (e.g. Priya born 1991 becomes priy1991). They must change it at first sign-in.');
  line('Email domain', `All addresses use @${DOMAIN}, which is a made-up company. Nothing will ever be delivered to them, so do not enable email notifications while testing with this data.`);
  line('', '');
  line('Headcount by role', '', true);
  const counts = rows.reduce((a, r) => ({ ...a, [r.role]: (a[r.role] || 0) + 1 }), {});
  for (const l of LAYERS) line(l.role, String(counts[l.role] || 0));
  line('Total', String(rows.length), true);

  await wb.xlsx.writeFile(out);

  console.log(`Wrote ${rows.length} employees to ${out}`);
  for (const l of LAYERS) console.log(`  ${l.role.padEnd(20)} ${counts[l.role] || 0}`);
  console.log(`  ${'departments'.padEnd(20)} ${new Set(rows.map((r) => r.department)).size}`);
  console.log(`  ${'locations'.padEnd(20)} ${new Set(rows.map((r) => r.location)).size}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

/*
 * Dumps every ifqm_% schema (registry + all tenants) to timestamped.sql files under
 * BACKUP_DIR, then prunes old runs beyond BACKUP_KEEP.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..');

const { default: dotenv } = await import('dotenv');
dotenv.config({ path: path.join(BACKEND, '.env') });

const HOST = process.env.MASTER_DB_HOST || 'localhost';
const USER = process.env.MASTER_DB_USER || 'root';
const PASS = process.env.MASTER_DB_PASS || '';
const KEEP = Math.max(1, parseInt(process.env.BACKUP_KEEP, 10) || 14);
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(BACKEND, 'backups');

const log = (m) => console.log(`[backup] ${m}`);
const die = (m) => { console.error(`[backup] FATAL: ${m}`); process.exit(1); };

/** Find mysqldump: env override PATH the XAMPP default location. */
function mysqldumpBin() {
  if (process.env.MYSQLDUMP) return process.env.MYSQLDUMP;
  const xampp = 'C:\\xampp\\mysql\\bin\\mysqldump.exe';
  if (process.platform === 'win32' && fs.existsSync(xampp)) return xampp;
  return 'mysqldump'; // rely on PATH
}

const { default: mysql } = await import('mysql2/promise');

let conn;
try {
  conn = await mysql.createConnection({ host: HOST, user: USER, password: PASS });
} catch (e) {
  die(`cannot connect to MySQL: ${e.message}`);
}

const [rows] = await conn.query("SHOW DATABASES LIKE 'ifqm%'");
await conn.end();
const schemas = rows.map((r) => Object.values(r)[0]).filter((n) => /^ifqm[a-z0-9_]*$/.test(n));
if (!schemas.length) die("no ifqm_% schemas found - nothing to back up.");

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19); // 2026-07-18-03-15-00
const runDir = path.join(BACKUP_DIR, stamp);
fs.mkdirSync(runDir, { recursive: true });

const bin = mysqldumpBin();
log(`dumping ${schemas.length} schema(s) with ${bin}`);

for (const schema of schemas) {
  const outFile = path.join(runDir, `${schema}.sql`);
  const args = [
    `--host=${HOST}`, `--user=${USER}`,
    // Password via env, not argv - argv is visible to every local process list.
    '--databases', schema,       // emits CREATE DATABASE + USE one-file restore
    '--single-transaction',      // consistent InnoDB snapshot, no table locks
    '--routines', '--triggers',
    `--result-file=${outFile}`,
  ];
  try {
    await execFileAsync(bin, args, {
      env: { ...process.env, MYSQL_PWD: PASS },
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    die(`mysqldump failed for ${schema}: ${e.stderr || e.message}`);
  }
  const size = fs.statSync(outFile).size;
  if (size < 500) die(`${schema}.sql is suspiciously small (${size} bytes) - refusing to count this as a backup.`);
  log(`  ${schema}.sql  (${(size / 1024).toFixed(1)} KB)`);
}

// Uploads Attachments and tenant logos live on disk, not in MySQL - a database-only backup
// silently loses every attached document.
if (process.env.BACKUP_UPLOADS !== '0') {
  const uploadsSrc = path.join(BACKEND, 'uploads');
  if (fs.existsSync(uploadsSrc)) {
    fs.cpSync(uploadsSrc, path.join(runDir, 'uploads'), { recursive: true });
    log('  uploads/ copied');
  } else {
    log('  uploads/ not found - skipped');
  }
}

// Rotation
const runs = fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}-/.test(d.name))
  .map((d) => d.name)
  .sort(); // timestamp names sort chronologically
while (runs.length > KEEP) {
  const oldest = runs.shift();
  fs.rmSync(path.join(BACKUP_DIR, oldest), { recursive: true, force: true });
  log(`rotated out ${oldest}`);
}

log(`done → ${runDir}  (retaining ${Math.min(runs.length, KEEP)} run(s), keep=${KEEP})`);

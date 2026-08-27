/**
 * Run pending migrations against a remote (managed) MySQL.
 *
 *   node scripts/migrate-remote.mjs ../.env.render ../ca.pem
 *   node scripts/migrate-remote.mjs ../.env.render ../ca.pem --dry
 *
 * ── Why this exists next to migrate.js ─────────────────────────────────────
 *
 * `npm run migrate` reads backend/.env, which on any developer's machine points
 * at their local MySQL. Running it against production therefore meant either
 * editing .env and remembering to put it back, or pasting a database password
 * onto a command line — where it lands in shell history and in the process list
 * of every other user on the box.
 *
 * This reads the credentials out of a file instead, and prints a plan before it
 * writes anything. The migration ledger in ifqm_master.schema_migrations is
 * what decides the plan, so re-running is safe: only unrecorded (db, file)
 * pairs are applied.
 *
 * --dry connects, shows exactly what would run, and exits without applying.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { runMigrations } from './migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [, , envPath, caPath] = process.argv;
const dry = process.argv.includes('--dry');

if (!envPath) {
  console.error('usage: node scripts/migrate-remote.mjs <env-file> [ca.pem] [--dry]');
  process.exit(2);
}

/** Parse KEY=value, tolerating quotes and comments. Not a full dotenv. */
function readEnvFile(p) {
  const out = {};
  for (const line of fs.readFileSync(path.resolve(__dirname, p), 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^"(.*)"$/s, '$1');
  }
  return out;
}

const env = readEnvFile(envPath);
const ca = caPath ? fs.readFileSync(path.resolve(__dirname, caPath), 'utf8') : '';

const host = env.MASTER_DB_HOST;
const master = env.MASTER_DB_NAME || 'ifqm_master';
if (!host) {
  console.error(`[migrate] ${envPath} has no MASTER_DB_HOST`);
  process.exit(2);
}

console.log(`[migrate] target   ${env.MASTER_DB_USER}@${host}:${env.DB_PORT || 3306}/${master}`);
console.log(`[migrate] tls      ${String(env.DB_SSL).toLowerCase() === 'true' ? (ca ? 'verified against ' + caPath : 'ON, certificate NOT verified') : 'off'}`);
if (dry) console.log('[migrate] DRY RUN — nothing will be written');

let conn;
try {
  conn = await mysql.createConnection({
    host,
    port: parseInt(env.DB_PORT, 10) || 3306,
    user: env.MASTER_DB_USER,
    password: env.MASTER_DB_PASS,
    ssl: String(env.DB_SSL || '').toLowerCase() === 'true'
      ? (ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false })
      : undefined,
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  if (dry) {
    /*
     * The same question the runner asks, asked read-only: for every tenant in
     * the registry, which migration files have no ledger row yet.
     */
    const dir = path.join(__dirname, '..', '..', 'db', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const [[{ n }]] = await conn.query(
      `SELECT COUNT(*) n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=? AND TABLE_NAME='schema_migrations'`, [master]);
    const done = new Set();
    if (n) {
      const [rows] = await conn.query(`SELECT db_name, filename FROM \`${master}\`.schema_migrations`);
      for (const r of rows) done.add(`${r.db_name}|${r.filename}`);
    }
    const [tenants] = await conn.query(`SELECT db_name FROM \`${master}\`.tenants`);
    const targets = [master, ...tenants.map((t) => t.db_name)];

    let pending = 0;
    for (const db of targets) {
      const isMaster = db === master;
      for (const f of files) {
        if (f.endsWith('_master.sql') !== isMaster) continue;
        if (done.has(`${db}|${f}`)) continue;
        console.log(`[migrate] WOULD APPLY ${f} → ${db}`);
        pending++;
      }
    }
    console.log(pending ? `[migrate] ${pending} pending` : '[migrate] up to date');
  } else {
    await runMigrations(conn, (m) => console.log(`[migrate] ${m}`), master);
  }
} catch (e) {
  console.error(`[migrate] FATAL: ${e.message}`);
  process.exitCode = 1;
} finally {
  await conn?.end().catch(() => {});
}

/**
 * Migration runner with applied-tracking:  npm run migrate   (from backend/)
 *
 * Both schema incidents in this project's history had the same root cause: four
 * overlapping SQL files and no record of what had been applied where. This
 * replaces guesswork with a ledger — `ifqm_master.schema_migrations` records
 * (db_name, filename), and only unrecorded pairs are applied.
 *
 * Rules:
 *   • forward-only: fixing a bad migration means writing a new one, not editing
 *     an applied file (already-run copies of the old text can never be updated)
 *   • *_master.sql files target ifqm_master; everything else targets every
 *     tenant schema in the registry
 *   • a tenant created AFTER a migration shipped gets current columns from
 *     tenant_schema.sql, so the runner also back-fills its ledger rows the
 *     first time it sees the tenant (the files are idempotent, so re-applying
 *     would be harmless — but the ledger should reflect reality)
 *
 * Usable as a CLI (npm run migrate) and as a module (setup.js imports
 * runMigrations so the two entry points share one code path and one ledger).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');

/**
 * Apply pending migrations over an open multi-statement connection.
 * @param {import('mysql2/promise').Connection} conn
 * @param {(msg: string) => void} log
 * @param {string} masterName  registry schema name (tests use a scratch one)
 */
export async function runMigrations(conn, log = console.log, masterName = 'ifqm_master') {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS \`${masterName}\`.schema_migrations (
      db_name    VARCHAR(100) NOT NULL,
      filename   VARCHAR(255) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (db_name, filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [applied] = await conn.query(`SELECT db_name, filename FROM \`${masterName}\`.schema_migrations`);
  const done = new Set(applied.map((r) => `${r.db_name}|${r.filename}`));

  const [tenants] = await conn.query(`SELECT slug, db_name FROM \`${masterName}\`.tenants`);
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  let ran = 0;
  for (const file of files) {
    const isMaster = file.includes('master');
    const targets = isMaster ? [masterName] : tenants.map((t) => t.db_name);

    for (const dbName of targets) {
      if (!/^ifqm[a-z0-9_]*$/.test(dbName)) {
        log(`SKIP ${file} → "${dbName}" (unexpected schema name)`);
        continue;
      }
      if (done.has(`${dbName}|${file}`)) continue;

      log(`applying ${file} → ${dbName}`);
      await conn.query(`USE \`${dbName}\``);
      await conn.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      await conn.query(
        `INSERT IGNORE INTO \`${masterName}\`.schema_migrations (db_name, filename) VALUES (?, ?)`,
        [dbName, file]
      );
      ran++;
    }
  }

  log(ran ? `done — ${ran} migration application(s).` : 'up to date — nothing to apply.');
  return ran;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const { default: dotenv } = await import('dotenv');
  dotenv.config({ path: path.join(__dirname, '..', '.env') });
  const { default: mysql } = await import('mysql2/promise');

  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.MASTER_DB_HOST || 'localhost',
      // Non-3306 port / TLS for managed MySQL — see src/config/index.js.
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
        ? ((process.env.DB_SSL_CA || '').trim()
            ? { ca: process.env.DB_SSL_CA.trim(), rejectUnauthorized: true }
            : { rejectUnauthorized: false })
        : undefined,
      user: process.env.MASTER_DB_USER || 'root',
      password: process.env.MASTER_DB_PASS || '',
      multipleStatements: true,
      charset: 'utf8mb4',
    });
    await runMigrations(conn, (m) => console.log(`[migrate] ${m}`));
  } catch (e) {
    console.error(`[migrate] FATAL: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await conn?.end().catch(() => {});
  }
}

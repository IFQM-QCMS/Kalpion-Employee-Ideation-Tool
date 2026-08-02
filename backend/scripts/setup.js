/**
 * One-command environment setup:  npm run setup   (from backend/)
 *
 * Exists because a fresh clone used to require four ordered manual steps
 * (master.sql, then a schema per tenant, then migrations 001 and 002 against
 * every database) — and the documented schema file was incomplete, so "works on
 * my machine / broken on the clone" was the default outcome. This script is the
 * whole procedure, idempotent, so it is equally a first-time setup and a
 * repair tool for a half-built database.
 *
 * What it does, in order:
 *   1. backend/.env          created from .env.example if missing (never overwritten)
 *   2. ifqm_master           created/updated from db/master.sql
 *   3. every registry tenant schema created from backend/schema/tenant_schema.sql
 *      (CREATE TABLE IF NOT EXISTS throughout — existing data untouched)
 *   4. migrations            db/migrations/*.sql applied to master + each tenant
 *                            (guarded ALTERs — safe to re-run)
 *
 * Credentials come from backend/.env (MASTER_DB_*), so it works on any box
 * where the MySQL account can create databases.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..');
const ROOT = path.resolve(BACKEND, '..');

const log = (m) => console.log(`[setup] ${m}`);
const die = (m) => { console.error(`[setup] FATAL: ${m}`); process.exit(1); };

// ── 1. .env ──────────────────────────────────────────────────────────────────
const envPath = path.join(BACKEND, '.env');
const examplePath = path.join(BACKEND, '.env.example');
if (!fs.existsSync(envPath)) {
  if (!fs.existsSync(examplePath)) die('backend/.env.example is missing from the repo.');
  fs.copyFileSync(examplePath, envPath);
  log('created backend/.env from .env.example — review it (JWT_SECRET, DB password) before production.');
} else {
  log('backend/.env already exists — left untouched.');
}

// Load it AFTER the copy so a first run picks the fresh file up.
const { default: dotenv } = await import('dotenv');
dotenv.config({ path: envPath });

// Port and TLS mirror src/config/index.js, re-read here because this script
// runs before (and without) the app config so it can also repair a half-built
// database. Defaults are the local XAMPP ones: 3306, plaintext.
const DB = {
  host: process.env.MASTER_DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
    ? ((process.env.DB_SSL_CA || '').trim()
        ? { ca: process.env.DB_SSL_CA.trim(), rejectUnauthorized: true }
        : { rejectUnauthorized: false })
    : undefined,
  user: process.env.MASTER_DB_USER || 'root',
  password: process.env.MASTER_DB_PASS || '',
  multipleStatements: true, // the .sql files are multi-statement by nature
  charset: 'utf8mb4',
};

const MASTER_SQL = path.join(ROOT, 'db', 'master.sql');
const TENANT_SCHEMA = path.join(BACKEND, 'schema', 'tenant_schema.sql');

const read = (p) => fs.readFileSync(p, 'utf8');

let conn;
try {
  conn = await mysql.createConnection(DB);
} catch (e) {
  die(`cannot connect to MySQL at ${DB.host} as ${DB.user}: ${e.message}\n` +
      '        Is MySQL running (XAMPP)? Are MASTER_DB_USER / MASTER_DB_PASS in backend/.env correct?');
}

try {
  // ── 2. master registry ─────────────────────────────────────────────────────
  log('applying db/master.sql (registry, platform admin seed, tickets, settings)…');
  await conn.query(read(MASTER_SQL));

  // ── 3. tenant schemas ──────────────────────────────────────────────────────
  const [tenants] = await conn.query('SELECT slug, db_name FROM ifqm_master.tenants');
  if (!tenants.length) log('registry has no tenants yet — nothing to provision.');
  const schemaSql = read(TENANT_SCHEMA);

  for (const t of tenants) {
    if (!/^ifqm_[a-z0-9_]+$/.test(t.db_name)) {
      log(`SKIP tenant "${t.slug}": unexpected db name "${t.db_name}"`);
      continue;
    }
    log(`tenant "${t.slug}" → ${t.db_name}`);
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${t.db_name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE \`${t.db_name}\``);
    await conn.query(schemaSql);
  }

  // ── 4. migrations ──────────────────────────────────────────────────────────
  // Shared with `npm run migrate` — one code path, one applied-ledger
  // (ifqm_master.schema_migrations), so setup and migrate can never disagree
  // about what has run where.
  const { runMigrations } = await import('./migrate.js');
  await runMigrations(conn, log);

  log('done. Start the backend with:  node server.js');
  log('NOTE: a fresh .env still holds example values — set JWT_SECRET and DB credentials before production.');
} catch (e) {
  die(e.message);
} finally {
  await conn.end().catch(() => {});
}

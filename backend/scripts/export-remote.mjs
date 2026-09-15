/**
 * Export every ifqm_% schema from a remote (managed) MySQL as one SQL file
 * that a MariaDB can load:
 *
 *   node scripts/export-remote.mjs <env-file> [ca.pem] [--out <file>] [--tenant-host <host>]
 *
 * Why not mysqldump: the local client is MariaDB's and cannot authenticate to
 * MySQL 8 (caching_sha2_password), and a MySQL 8 mysqldump writes things a
 * MariaDB refuses - view definers that do not exist on the target, a
 * `DEFAULT ENCRYPTION` clause on CREATE DATABASE, GTID bookkeeping. The data
 * here is a few megabytes with no routines or triggers, so a plain,
 * predictable writer is the safer tool.
 *
 * --tenant-host rewrites tenants.db_host. The app connects to each tenant at
 * the host stored in its row (database/tenant.js), so rows exported from one
 * server point every tenant back at that server unless they are rewritten for
 * the destination. On the compose deployment that host is `kalpion-db`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { buildDbSsl } from '../src/config/dbSsl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const [envPath, caPath] = positional;
const tenantHost = opt('--tenant-host');
const BATCH = 500;
const BATCH_BYTES = 1024 * 1024;

if (!envPath) {
  console.error('usage: node scripts/export-remote.mjs <env-file> [ca.pem] [--out <file>] [--tenant-host <host>]');
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
  console.error(`[export] ${envPath} has no MASTER_DB_HOST`);
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const outPath = path.resolve(
  __dirname,
  opt('--out') || path.join('..', 'backups', 'aiven', `kalpion-${stamp}.sql`)
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const log = (m) => console.log(`[export] ${m}`);
log(`source   ${env.MASTER_DB_USER}@${host}:${env.DB_PORT || 3306}`);
log(`tls      ${String(env.DB_SSL).toLowerCase() === 'true' ? (ca ? 'verified against ' + caPath : 'ON, certificate NOT verified') : 'off'}`);
log(`output   ${outPath}`);
if (tenantHost) log(`tenants  db_host will be rewritten to "${tenantHost}"`);

const q = (s) => '`' + String(s).replace(/`/g, '``') + '`';

/** A view definition, without the parts that tie it to the source server. */
function portableView(createView) {
  return createView
    .replace(/\sDEFINER=`[^`]*`@`[^`]*`/, '')
    .replace(/\sSQL SECURITY (DEFINER|INVOKER)/, '')
    .replace(/^CREATE\s+/, 'CREATE OR REPLACE ');
}

let conn;
let out;
try {
  conn = await mysql.createConnection({
    host,
    port: parseInt(env.DB_PORT, 10) || 3306,
    user: env.MASTER_DB_USER,
    password: env.MASTER_DB_PASS,
    ssl: buildDbSsl(env, ca),
    charset: 'utf8mb4',
    // Values come back as text so they can be written back out verbatim.
    // Dates in particular: a Date object would be re-rendered in local time.
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
  });

  // Identifiers come back-quoted regardless of the server's ANSI_QUOTES, and a
  // single snapshot means the tables agree with each other.
  await conn.query("SET SESSION sql_mode=''");
  await conn.query('SET SESSION time_zone=\'+00:00\'');
  await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');

  const [dbRows] = await conn.query("SHOW DATABASES LIKE 'ifqm%'");
  const schemas = dbRows.map((r) => Object.values(r)[0]).filter((n) => /^ifqm[a-z0-9_]*$/.test(n));
  if (!schemas.includes(master)) throw new Error(`${master} not found on ${host}`);
  log(`schemas  ${schemas.join(', ')}`);

  out = fs.createWriteStream(outPath, { encoding: 'utf8' });
  const w = (s) => out.write(s + '\n');

  w(`-- Kalpion export from ${host} at ${new Date().toISOString()}`);
  w(`-- Load with:  mariadb -uroot -p < ${path.basename(outPath)}`);
  w('SET NAMES utf8mb4;');
  w("SET SESSION sql_mode='NO_AUTO_VALUE_ON_ZERO';");
  w("SET SESSION time_zone='+00:00';");
  w('SET FOREIGN_KEY_CHECKS=0;');
  w('SET UNIQUE_CHECKS=0;');
  w('');

  let tables = 0;
  let rowsTotal = 0;
  const counts = {};

  for (const schema of schemas) {
    w(`-- ---------------------------------------------------------------- ${schema}`);
    w(`CREATE DATABASE IF NOT EXISTS ${q(schema)} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    w(`USE ${q(schema)};`);
    w('');

    const [tl] = await conn.query(
      `SELECT TABLE_NAME name, TABLE_TYPE type FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=? ORDER BY TABLE_TYPE, TABLE_NAME`, [schema]);
    const base = tl.filter((t) => t.type === 'BASE TABLE').map((t) => t.name);
    const views = tl.filter((t) => t.type === 'VIEW').map((t) => t.name);

    for (const t of base) {
      const [[ddl]] = await conn.query(`SHOW CREATE TABLE ${q(schema)}.${q(t)}`);
      w(`DROP TABLE IF EXISTS ${q(t)};`);
      w(ddl['Create Table'] + ';');

      const [cols] = await conn.query(
        `SELECT COLUMN_NAME name FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND EXTRA NOT LIKE '%GENERATED%'
          ORDER BY ORDINAL_POSITION`, [schema, t]);
      const colList = cols.map((c) => q(c.name)).join(', ');
      const [rows] = await conn.query(`SELECT ${colList} FROM ${q(schema)}.${q(t)}`);
      counts[`${schema}.${t}`] = rows.length;
      rowsTotal += rows.length;
      tables++;

      // One INSERT per BATCH rows or BATCH_BYTES, whichever comes first. A
      // statement has to fit the target's max_allowed_packet (16 MB on
      // MariaDB's default), and a table with a blob column - tenants carries
      // each logo - can blow through that long before it reaches BATCH rows.
      let chunk = [];
      let bytes = 0;
      const flush = () => {
        if (chunk.length) w(`INSERT INTO ${q(t)} (${colList}) VALUES\n${chunk.join(',\n')};`);
        chunk = [];
        bytes = 0;
      };
      for (const r of rows) {
        const tuple = '(' + cols.map((c) => mysql.escape(r[c.name])).join(',') + ')';
        if (chunk.length && (chunk.length >= BATCH || bytes + tuple.length > BATCH_BYTES)) flush();
        chunk.push(tuple);
        bytes += tuple.length;
      }
      flush();
      w('');
    }

    for (const v of views) {
      const [[ddl]] = await conn.query(`SHOW CREATE VIEW ${q(schema)}.${q(v)}`);
      w(`DROP VIEW IF EXISTS ${q(v)};`);
      w(portableView(ddl['Create View']) + ';');
      w('');
    }
    log(`${schema.padEnd(16)} ${base.length} tables, ${views.length} views`);
  }

  if (tenantHost) {
    w(`-- Every tenant row pointed at ${host}; the app connects to the host in the row.`);
    w(`UPDATE ${q(master)}.tenants SET db_host=${mysql.escape(tenantHost)}, db_user='', db_pass='';`);
    w('');
  }

  w('SET UNIQUE_CHECKS=1;');
  w('SET FOREIGN_KEY_CHECKS=1;');
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
  out = null;

  fs.writeFileSync(outPath + '.counts.json', JSON.stringify(counts, null, 2));
  log(`done     ${tables} tables, ${rowsTotal} rows, ${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB`);
} catch (e) {
  console.error(`[export] FATAL: ${e.message}`);
  process.exitCode = 1;
} finally {
  out?.destroy();
  await conn?.end().catch(() => {});
}

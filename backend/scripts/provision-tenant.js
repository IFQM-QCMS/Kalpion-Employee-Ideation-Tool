/**
 * IFQM Tenant Provisioning CLI — Node port of provision_tenant.php.
 *
 * Usage:
 *   node scripts/provision-tenant.js --name="Acme Corp" --slug="acme" --domain="acme.example.com" \
 *        [--db-pass="secret"] [--db-user="root"] [--db-host="localhost"] \
 *        [--admin-email="admin@acme.example.com"] [--admin-pass="changeme"]
 *
 * Creates the tenant database, applies schema.sql, seeds a super_admin user and
 * the default approval settings, registers the tenant in ifqm_master, and
 * creates the per-tenant uploads directory.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import config from '../src/config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Consolidated tenant schema (see backend/schema/tenant_schema.sql header).
const SCHEMA_PATH = path.resolve(__dirname, '..', 'schema', 'tenant_schema.sql');
const UPLOADS_BASE = path.resolve(__dirname, '..', 'uploads');

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const name = opts.name || null;
  const slug = opts.slug || null;
  const domain = opts.domain || null;
  const dbPass = opts['db-pass'] ?? '';
  const dbUser = opts['db-user'] ?? 'root';
  const dbHost = opts['db-host'] ?? 'localhost';
  const adminEmail = opts['admin-email'] ?? ('admin@' + (domain || 'tenant.local'));
  const adminPass = opts['admin-pass'] ?? 'changeme123';

  if (!name || !slug || !domain) {
    console.error('ERROR: --name, --slug and --domain are required.');
    console.error('Usage: node scripts/provision-tenant.js --name="Acme" --slug="acme" --domain="acme.example.com"');
    process.exit(1);
  }
  if (!/^[a-z0-9_]+$/.test(slug)) {
    console.error('ERROR: --slug must be lowercase alphanumeric + underscores only.');
    process.exit(1);
  }

  const dbName = 'ifqm_' + slug;
  console.log('=== IFQM Tenant Provisioning ===');
  console.log(`Name   : ${name}`);
  console.log(`Slug   : ${slug}`);
  console.log(`Domain : ${domain}`);
  console.log(`DB     : ${dbName} on ${dbHost}\n`);

  // 1. Connect to master DB
  let master;
  try {
    master = await mysql.createConnection({
      host: config.masterDb.host, port: config.db.port, ssl: config.db.ssl,
      user: config.masterDb.user,
      password: config.masterDb.password, database: config.masterDb.database, charset: 'utf8mb4',
    });
    console.log('[1/5] Connected to ifqm_master OK');
  } catch (e) {
    console.error('ERROR: Cannot connect to ifqm_master: ' + e.message);
    console.error('       Run master.sql first.');
    process.exit(1);
  }

  // Duplicate check
  const [dup] = await master.execute('SELECT id FROM tenants WHERE slug=? OR domain=?', [slug, domain]);
  if (dup.length) {
    console.error(`ERROR: A tenant with slug '${slug}' or domain '${domain}' already exists.`);
    process.exit(1);
  }

  // 2. Create tenant database
  let rootConn;
  try {
    rootConn = await mysql.createConnection({ host: dbHost, port: config.db.port, ssl: config.db.ssl, user: dbUser, password: dbPass, charset: 'utf8mb4' });
    await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`[2/5] Created database \`${dbName}\` OK`);
  } catch (e) {
    console.error('ERROR: Cannot create database: ' + e.message);
    process.exit(1);
  }

  // 3. Apply schema.sql
  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error('ERROR: schema.sql not found at ' + SCHEMA_PATH);
    process.exit(1);
  }
  let tenantConn;
  try {
    // Send the schema as one batch and let the driver parse it, exactly as
    // platformService.createTenant does. Splitting the file on ';' shattered any
    // statement whose body contained a semicolon inside a comment (the
    // `-- …estimate; …` note in the ideas table), so provisioning died with a
    // bare SQL syntax error. It also breaks the PREPARE/EXECUTE guards the
    // schema now uses for indexes.
    tenantConn = await mysql.createConnection({
      host: dbHost, port: config.db.port, ssl: config.db.ssl,
      user: dbUser, password: dbPass, database: dbName, charset: 'utf8mb4',
      multipleStatements: true,
    });
    await tenantConn.query(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    console.log('[3/5] Schema applied OK');
  } catch (e) {
    console.error('ERROR: Schema failed: ' + e.message);
    process.exit(1);
  }

  // 4. Create super admin user
  const passHash = bcrypt.hashSync(adminPass, 10);
  const initials = (name.charAt(0).toUpperCase()) + 'A';
  try {
    await tenantConn.execute(
      `INSERT INTO users (employee_id,name,email,password_hash,department,business_unit,location,role,avatar_initials)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      ['SA-001', name + ' Admin', adminEmail, passHash, name, 'All Units', 'HQ', 'super_admin', initials]
    );
    console.log(`[4/5] Super admin created: ${adminEmail} / ${adminPass} OK`);
  } catch (e) {
    console.warn('WARNING: Could not create super admin: ' + e.message);
  }

  // 4b. Approval defaults
  try {
    const defaults = [
      ['approval_mode', 'default'],
      ['approval_reviewer_roles', 'team_lead,project_lead,manager,senior_manager'],
      ['approval_final_approver_roles', 'executive,admin,super_admin'],
      ['approval_threshold', '100'],
      ['approval_stages', 'originator,immediate_manager,department_manager,plant_head'],
    ];
    for (const [k, v] of defaults) {
      await tenantConn.execute('INSERT INTO org_settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value=value', [k, v]);
    }
    console.log('[4b/5] Approval defaults inserted OK');
  } catch (e) {
    console.warn('WARNING: Could not insert approval defaults: ' + e.message);
  }

  // 5. Register in master DB
  try {
    await master.execute(
      // db_user/db_pass are written empty on purpose. Tenant pools take their
      // credentials from config (APP_DB_*), never from this row — see
      // src/database/tenant.js — so persisting the live password here would put
      // a working database login in the registry for no benefit.
      `INSERT INTO tenants (name, slug, domain, db_host, db_name, db_user, db_pass, status, is_default)
       VALUES (?, ?, ?, ?, ?, '', '', 'active', 0)`,
      [name, slug, domain, dbHost, dbName]
    );
    console.log('[5/5] Tenant registered in ifqm_master OK');
  } catch (e) {
    console.error('ERROR: Could not register tenant: ' + e.message);
    process.exit(1);
  }

  // Upload folder
  const uploadDir = path.join(UPLOADS_BASE, slug);
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  console.log('\n=== Provisioning complete! ===');
  console.log(`Tenant '${name}' is live at: ${domain}`);
  console.log(`Upload folder: backend/uploads/${slug}/`);
  console.log('Done.');

  await tenantConn.end();
  await rootConn.end();
  await master.end();
  process.exit(0);
}

main().catch((e) => { console.error('FATAL: ' + e.message); process.exit(1); });

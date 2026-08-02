/**
 * Test harness. Import this FIRST in every test file — before anything that
 * touches src/ — because the app's config reads process.env at import time and
 * dotenv never overrides values that are already set. Setting them here is what
 * points the entire app at scratch databases instead of the real ones.
 *
 * The suite provisions:
 *   ifqm_test_master  registry (from db/master.sql, name-rewritten), with the
 *                     shipped seed tenants REPLACED by two test orgs — so no
 *                     code path, including default-tenant fallback, can ever
 *                     resolve to a real database.
 *   ifqm_test_a       tenant "orga"  (default) — admin + employee seeded
 *   ifqm_test_b       tenant "orgb"            — admin seeded
 *
 * Everything is dropped in teardown. Safe to run on a machine with live data.
 */
process.env.NODE_ENV = 'test';
process.env.MASTER_DB_NAME = 'ifqm_test_master';
process.env.FALLBACK_DB_NAME = 'ifqm_test_a'; // even the last-resort fallback stays in test land
process.env.AUTH_RATE_LIMIT = '10000';        // per-IP limiter must not throttle the suite
// The suite is also a load generator — the 300/min global cap is real (and is
// itself exercised deliberately), but leaving it in force here would 429 the
// concurrency and throughput cases and mask what they are actually measuring.
process.env.GLOBAL_RATE_LIMIT = '1000000';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..');
const ROOT = path.resolve(BACKEND, '..');

// Deferred imports so the env above is in force when config loads.
const { createApp } = await import('../src/app.js');
const { signToken } = await import('../src/utils/jwt.js');
const { closeAllPools } = await import('../src/database/tenant.js');
const { closeMasterPool } = await import('../src/database/master.js');
const { default: config } = await import('../src/config/index.js');

export const TEST_DBS = ['ifqm_test_master', 'ifqm_test_a', 'ifqm_test_b'];

// Cost 4: test users need valid bcrypt hashes, not slow ones. The stored hash
// carries its own cost, so login verifies these exactly as it would cost-12.
const cheapHash = (pw) => bcrypt.hashSync(pw, 4);

export const PASSWORDS = {
  orgaAdmin: 'OrgaAdminPass123',
  orgaUser: 'OrgaUserPass1234',
  orgbAdmin: 'OrgbAdminPass123',
  platform: 'password', // the master.sql seed account
};

let adminConn; // multi-statement root connection for provisioning
let server;
let baseUrl;

export async function setupSuite() {
  adminConn = await mysql.createConnection({
    host: config.masterDb.host,
    user: config.masterDb.user,
    password: config.masterDb.password,
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  // Start from nothing every run — half-torn-down state must not leak between runs.
  for (const db of TEST_DBS) await adminConn.query(`DROP DATABASE IF EXISTS \`${db}\``);

  // Registry: the real master.sql, rewritten to the test schema name.
  const masterSql = fs
    .readFileSync(path.join(ROOT, 'db', 'master.sql'), 'utf8')
    .replaceAll('ifqm_master', 'ifqm_test_master');
  await adminConn.query(masterSql);

  // Replace shipped seed tenants with the two test orgs. Without this, the
  // seeded default tenant points at ifqm_ideation — a REAL database.
  await adminConn.query(`
    USE ifqm_test_master;
    DELETE FROM tenants;
    INSERT INTO tenants (name, slug, domain, db_host, db_name, db_user, db_pass, status, is_default)
    VALUES ('Org A', 'orga', 'orga.test', '${config.masterDb.host}', 'ifqm_test_a', '', '', 'active', 1),
           ('Org B', 'orgb', 'orgb.test', '${config.masterDb.host}', 'ifqm_test_b', '', '', 'active', 0);
  `);

  // Tenant schemas from the canonical file (already includes migration columns).
  const tenantSchema = fs.readFileSync(path.join(BACKEND, 'schema', 'tenant_schema.sql'), 'utf8');
  for (const db of ['ifqm_test_a', 'ifqm_test_b']) {
    await adminConn.query(`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await adminConn.query(`USE \`${db}\`; ${tenantSchema}`);
  }

  await adminConn.query(`
    USE ifqm_test_a;
    INSERT INTO users (employee_id, name, email, password_hash, role, status, password_changed_at)
    VALUES ('A-ADMIN', 'Orga Admin', 'admin@orga.test', '${cheapHash(PASSWORDS.orgaAdmin)}', 'admin', 'active', NOW()),
           ('A-EMP', 'Orga Employee', 'user@orga.test', '${cheapHash(PASSWORDS.orgaUser)}', 'employee', 'active', NOW());
    USE ifqm_test_b;
    INSERT INTO users (employee_id, name, email, password_hash, role, status, password_changed_at)
    VALUES ('B-ADMIN', 'Orgb Admin', 'admin@orgb.test', '${cheapHash(PASSWORDS.orgbAdmin)}', 'admin', 'active', NOW());
  `);

  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

export async function teardownSuite() {
  if (server) await new Promise((r) => server.close(r));
  await closeAllPools();
  await closeMasterPool();
  if (adminConn) {
    for (const db of TEST_DBS) await adminConn.query(`DROP DATABASE IF EXISTS \`${db}\``).catch(() => {});
    await adminConn.end().catch(() => {});
  }
}

/** Raw SQL against the scratch environment (assertions on stored state). */
export async function sql(dbName, statement, params = []) {
  const [rows] = await adminConn.execute(`/* test */ ${statement.replace('__DB__', dbName)}`, params);
  return rows;
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

export async function api(method, urlPath, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (raw !== undefined) {
    payload = raw; // e.g. FormData — fetch sets its own content-type
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(baseUrl + urlPath, { method, headers, body: payload });
  // Read the body once as text, then try to parse JSON — so a non-JSON response
  // (a CSV, an HTML report, a PDF download) is still inspectable via `text` and
  // `contentType` instead of vanishing.
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* non-JSON body */ }
  return {
    status: res.status,
    data,
    text,
    contentType: res.headers.get('content-type') || '',
    // Response headers matter to several checks (security headers, attachment
    // disposition, rate-limit budget), so expose them rather than the body alone.
    headers: Object.fromEntries(res.headers.entries()),
  };
}

/** Base URL of the running instance — for checks that need a raw fetch. */
export const getBaseUrl = () => baseUrl;

export async function login(email, password, orgSlug = '') {
  const { status, data } = await api('POST', '/api/auth/login', {
    body: { email, password, org_slug: orgSlug },
  });
  return { status, token: data?.token, user: data?.user, error: data?.error };
}

/** Mint a token directly (same signer the server uses) — for tamper tests. */
export { signToken };

/** A minimal valid PNG (red 1×1) and a fake one, for upload validation tests. */
export function tinyPng() {
  return Buffer.from(
    '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
    '01f15c4890000000d4944415478da63f8cfc000000301010018dd8db0' +
    '0000000049454e44ae426082',
    'hex'
  );
}
export function fakePng() {
  return Buffer.from('GIF89a definitely not a png');
}

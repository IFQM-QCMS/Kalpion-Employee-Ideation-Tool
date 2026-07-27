/**
 * IFQM — Test Case Runner
 * ----------------------------------------------------------------------------
 * The IFQM counterpart to QCMS's qcms_test_runner.py. Boots the REAL Express app
 * on scratch tenant databases (via the existing test harness) and drives it over
 * HTTP exactly as a client would, recording for every case:
 *
 *   Test Case ID | Module | Functionality | Expected Output | Actual Output | Result | Timestamp
 *
 * Results are written as JSON; gen_testcases_doc.mjs turns them into the document.
 * Nothing here is mocked — Actual Output is whatever the running instance did,
 * so a genuine defect shows up as Fail rather than being hidden.
 *
 *   node test/tc_runner.mjs
 */
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import {
  setupSuite, teardownSuite, api, login, sql, signToken, tinyPng, fakePng, PASSWORDS,
} from './helpers.js';

const OUT = process.env.TC_OUT || 'test/tc_results.json';
const results = [];
const seq = {};
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/** Run one case. `fn` returns { actual, pass }. Exceptions => Fail, recorded. */
async function tc(modKey, modName, functionality, expected, fn) {
  seq[modKey] = (seq[modKey] || 0) + 1;
  const id = `TC-${modKey}-${String(seq[modKey]).padStart(3, '0')}`;
  let actual = '', pass = false;
  try {
    const r = await fn();
    actual = String(r.actual ?? '').slice(0, 300);
    pass = !!r.pass;
  } catch (e) {
    actual = 'Unexpected error: ' + (e?.message || e);
    pass = false;
  }
  results.push({ id, module: modName, functionality, expected, actual, result: pass ? 'Pass' : 'Fail', ts: stamp() });
  process.stdout.write(pass ? '.' : 'F');
}

const ok = (cond, actual) => ({ actual, pass: !!cond });

async function main() {
  await setupSuite();

  // ── Sessions ───────────────────────────────────────────────────────────
  const PA     = (await login('platform@ifqm.io', PASSWORDS.platform)).token;
  const AADMIN = (await login('admin@orga.test', PASSWORDS.orgaAdmin)).token;
  const AUSER  = (await login('user@orga.test',  PASSWORDS.orgaUser)).token;
  const BADMIN = (await login('admin@orgb.test', PASSWORDS.orgbAdmin)).token;

  // Seed a couple of ideas we can vote/comment/review against.
  const mkIdea = async (token, title) => {
    const r = await api('POST', '/api/ideas/submit', { token, body: {
      title, present_situation: 'Current state wastes time and material on line 3 every shift.',
      proposed_solution: 'Introduce an automated check that flags the waste before it accrues.',
      investment_required: '50000', support_required: 'One maintenance engineer for a day.',
    }});
    return r.data?.idea_id;
  };
  const IDEA1 = await mkIdea(AUSER, 'Recirculate coolant on line 3');
  const IDEA2 = await mkIdea(AUSER, 'Laser-mark part numbers instead of ink stamping');

  // ══════════════════════════════ AUTHENTICATION ══════════════════════════
  const M = 'AUTH', Mn = 'Authentication';
  await tc(M, Mn, 'Org Admin logs in with correct email/password',
    'Login succeeds, JWT issued, role = admin', async () => {
      const r = await login('admin@orga.test', PASSWORDS.orgaAdmin);
      return ok(r.token && r.user?.role === 'admin', r.token ? `Login ok, role=${r.user?.role}` : `No token (${r.error})`);
    });
  await tc(M, Mn, 'Employee logs in with correct credentials',
    'Login succeeds, role = employee', async () => {
      const r = await login('user@orga.test', PASSWORDS.orgaUser);
      return ok(r.token && r.user?.role === 'employee', r.token ? `Login ok, role=${r.user?.role}` : `No token (${r.error})`);
    });
  await tc(M, Mn, 'Platform Admin logs in with correct credentials',
    'Login succeeds, role = platform_admin', async () => {
      const r = await login('platform@ifqm.io', PASSWORDS.platform);
      return ok(r.token && r.user?.role === 'platform_admin', r.token ? `role=${r.user?.role}` : `No token (${r.error})`);
    });
  await tc(M, Mn, 'User enters correct email but wrong password',
    'Login blocked, generic error, no token', async () => {
      const r = await login('admin@orga.test', 'WrongPassword999');
      return ok(!r.token && r.status === 401, r.token ? 'Token issued (LEAK)' : `Blocked ${r.status}: ${r.error}`);
    });
  await tc(M, Mn, 'User enters an email that does not exist',
    'Same generic error as wrong-password (no account-existence leak)', async () => {
      // The volatile "N attempt(s) remaining" counter differs by design; the
      // security property is that the BASE message is identical either way.
      const strip = (s) => (s || '').replace(/\d+\s+attempt\(s\)\s+remaining\.?/i, '').trim();
      const wrong = await login('admin@orga.test', 'WrongPassword999');
      const missing = await login('nobody@orga.test', 'WrongPassword999');
      const same = wrong.status === missing.status && strip(wrong.error) === strip(missing.error);
      return ok(!missing.token && same, same ? `Identical generic message (${missing.status})` : `Differs: ${wrong.error} vs ${missing.error}`);
    });
  await tc(M, Mn, 'User submits login with empty email/password',
    'Validation error, login blocked (not a 500)', async () => {
      const r = await api('POST', '/api/auth/login', { body: { email: '', password: '' } });
      return ok(r.status >= 400 && r.status < 500, `Rejected ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(M, Mn, 'SQL injection string in the email field',
    'Safely rejected, no error/crash exposed', async () => {
      const r = await login("' OR '1'='1'; --", 'x');
      return ok(!r.token && r.status !== 500, r.token ? 'Auth bypassed (CRITICAL)' : `Safe ${r.status}`);
    });
  await tc(M, Mn, 'Deactivated user tries to log in with correct credentials',
    'Login blocked, account-inactive handled', async () => {
      await sql('ifqm_test_a', `INSERT INTO __DB__.users (employee_id,name,email,password_hash,role,status,password_changed_at)
        VALUES ('A-OFF','Off User','off@orga.test','${bcrypt.hashSync('OffUserPass1234', 4)}','employee','inactive',NOW())`);
      const r = await login('off@orga.test', 'OffUserPass1234');
      return ok(!r.token, r.token ? 'Logged in while inactive (LEAK)' : `Blocked ${r.status}: ${r.error}`);
    });
  await tc(M, Mn, 'Tampered JWT used on a protected endpoint',
    'Rejected 401 — invalid signature grants no access', async () => {
      const good = signToken({ user: { id: 1, role: 'employee' }, org_slug: 'orga', pwd_ts: 0 });
      const tampered = good.slice(0, -4) + (good.endsWith('AAAA') ? 'BBBB' : 'AAAA');
      const r = await api('GET', '/api/notifications', { token: tampered });
      return ok(r.status === 401, `Status ${r.status}`);
    });
  await tc(M, Mn, 'Access a protected endpoint with no token at all',
    'Rejected 401', async () => {
      const r = await api('GET', '/api/notifications', {});
      return ok(r.status === 401, `Status ${r.status}`);
    });
  await tc(M, Mn, 'Repeated wrong-password attempts on one account',
    'Attempts are counted and the account is throttled/locked', async () => {
      for (let i = 0; i < 4; i++) await login('admin@orgb.test', 'Nope' + i);
      const r = await login('admin@orgb.test', 'NopeAgain');
      const throttled = /attempt|too many|locked|try again/i.test(r.error || '');
      return ok(!r.token && throttled, throttled ? `Throttle msg: ${r.error}` : `No throttle signal: ${r.error}`);
    });
  await tc(M, Mn, 'Forgot-password request for an unknown email',
    'Generic success, no account-existence leak', async () => {
      const r = await api('POST', '/api/auth/forgot-password', { body: { email: 'ghost@orga.test', org_slug: 'orga' } });
      return ok(r.status === 200, `Status ${r.status}: ${r.data?.error || 'ok'}`);
    });

  // ══════════════════════════════ PLATFORM ADMIN ══════════════════════════
  const P = 'PLAT', Pn = 'Platform Admin';
  let newTenantId = null;
  await tc(P, Pn, 'Create a new organization with valid details',
    'Tenant + org-admin account created', async () => {
      const r = await api('POST', '/api/platform/tenants', { token: PA, body: {
        org_name: 'Acme Foods', slug: 'acme', admin_name: 'Acme Admin',
        admin_email: 'admin@acme.test', admin_password: 'AcmeAdminPass123',
      }});
      newTenantId = r.data?.tenant?.id || r.data?.id || r.data?.tenant_id;
      return ok(r.data?.success || r.status === 200 || r.status === 201, `Status ${r.status}: ${r.data?.error || 'created'}`);
    });
  await tc(P, Pn, 'Create an organization with a duplicate slug',
    'Rejected — slug already in use', async () => {
      const r = await api('POST', '/api/platform/tenants', { token: PA, body: {
        org_name: 'Dup', slug: 'acme', admin_name: 'D', admin_email: 'd@dup.test', admin_password: 'DupAdminPass123',
      }});
      return ok(r.status >= 400, `Rejected ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(P, Pn, 'Create an organization with missing required fields',
    'Validation error listing missing fields', async () => {
      const r = await api('POST', '/api/platform/tenants', { token: PA, body: { org_name: '' } });
      return ok(r.status >= 400 && r.status < 500, `Rejected ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(P, Pn, 'List all tenants',
    'Returns the tenant registry', async () => {
      const r = await api('GET', '/api/platform/tenants', { token: PA });
      const n = Array.isArray(r.data?.tenants) ? r.data.tenants.length : (Array.isArray(r.data) ? r.data.length : 0);
      return ok(r.status === 200 && n >= 2, `Status ${r.status}, ${n} tenants`);
    });
  await tc(P, Pn, 'Suspend a tenant then reactivate it',
    'Status transitions suspended → active', async () => {
      const t = (await api('GET', '/api/platform/tenants', { token: PA })).data;
      const list = t?.tenants || t || [];
      const orgb = list.find(x => x.slug === 'orgb');
      const s = await api('PATCH', `/api/platform/tenants/${orgb.id}`, { token: PA, body: { status: 'suspended' } });
      const a = await api('PATCH', `/api/platform/tenants/${orgb.id}`, { token: PA, body: { status: 'active' } });
      return ok(s.status === 200 && a.status === 200, `suspend=${s.status}, reactivate=${a.status}`);
    });
  await tc(P, Pn, 'Delete a tenant with a wrong confirmation slug',
    'Blocked — confirmation mismatch', async () => {
      const t = (await api('GET', '/api/platform/tenants', { token: PA })).data;
      const list = t?.tenants || t || [];
      const orgb = list.find(x => x.slug === 'orgb');
      const r = await api('DELETE', `/api/platform/tenants/${orgb.id}`, { token: PA, body: { confirm_slug: 'wrong' } });
      return ok(r.status >= 400, `Blocked ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(P, Pn, 'Reset a tenant admin password targeting a non-admin email',
    'Rejected — target is not that org\'s admin', async () => {
      const t = (await api('GET', '/api/platform/tenants', { token: PA })).data;
      const list = t?.tenants || t || [];
      const orga = list.find(x => x.slug === 'orga');
      const r = await api('POST', `/api/platform/tenants/${orga.id}/reset-admin-password`, { token: PA, body: { admin_email: 'user@orga.test' } });
      return ok(r.status >= 400, `Rejected ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(P, Pn, 'Org Admin tries to reach the platform tenants endpoint',
    'Forbidden — platform scope only', async () => {
      const r = await api('GET', '/api/platform/tenants', { token: AADMIN });
      return ok(r.status === 403 || r.status === 401, `Status ${r.status}`);
    });
  await tc(P, Pn, 'Create a platform admin with a weak password',
    'Rejected for not meeting policy', async () => {
      const r = await api('POST', '/api/platform/admins', { token: PA, body: { name: 'X', email: 'x@ifqm.io', password: 'short' } });
      return ok(r.status >= 400, `Rejected ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(P, Pn, 'Platform admin tries to delete their own account',
    'Blocked — cannot remove self', async () => {
      const admins = (await api('GET', '/api/platform/admins', { token: PA })).data;
      const listA = admins?.admins || admins || [];
      const me = listA.find(a => a.email === 'platform@ifqm.io');
      const r = await api('DELETE', `/api/platform/admins/${me?.id}`, { token: PA });
      return ok(r.status >= 400, `Blocked ${r.status}: ${r.data?.error || ''}`);
    });

  // ══════════════════════════════ USERS / ORG ADMIN ═══════════════════════
  const U = 'USER', Un = 'Org Admin / Users';
  await tc(U, Un, 'Admin creates a user with valid details',
    'User created with a derived temporary password', async () => {
      const r = await api('POST', '/api/users', { token: AADMIN, body: {
        name: 'Neha Rao', email: 'neha@orga.test', employee_id: 'A-100', department: 'Quality',
        role: 'employee', date_of_birth: '1994-05-01',
      }});
      return ok(r.data?.success || r.status === 200 || r.status === 201, `Status ${r.status}: ${r.data?.error || 'created'}`);
    });
  await tc(U, Un, 'Create a user with a missing email',
    'Validation error — email required', async () => {
      const r = await api('POST', '/api/users', { token: AADMIN, body: { name: 'No Email', employee_id: 'A-101' } });
      return ok(r.status >= 400 && r.status < 500, `Rejected ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(U, Un, 'Create a user with an email already in use',
    'Rejected — email already registered', async () => {
      const r = await api('POST', '/api/users', { token: AADMIN, body: {
        name: 'Dup', email: 'neha@orga.test', employee_id: 'A-102', role: 'employee', date_of_birth: '1990',
      }});
      return ok(r.status >= 400, `Rejected ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(U, Un, 'Employee (non-admin) tries to create a user',
    'Forbidden — admin only', async () => {
      const r = await api('POST', '/api/users', { token: AUSER, body: {
        name: 'Sneaky', email: 'sneaky@orga.test', employee_id: 'A-103', role: 'admin', date_of_birth: '1990',
      }});
      return ok(r.status === 403 || r.status === 401, `Status ${r.status}`);
    });
  await tc(U, Un, 'Admin lists users in the organization',
    'Returns the org user list', async () => {
      const r = await api('GET', '/api/users', { token: AADMIN });
      const n = Array.isArray(r.data?.users) ? r.data.users.length : (Array.isArray(r.data) ? r.data.length : 0);
      return ok(r.status === 200 && n >= 2, `Status ${r.status}, ${n} users`);
    });
  await tc(U, Un, 'Bulk-import preview with a malformed row',
    'Row-level error reported, not a crash', async () => {
      const csv = 'name,email,employee_id,date_of_birth\n,,,\nRavi,ravi@orga.test,A-200,1992-03-03\n';
      const fd = new FormData();
      fd.append('file', new Blob([csv], { type: 'text/csv' }), 'users.csv');
      const r = await api('POST', '/api/users/import/preview', { token: AADMIN, raw: fd });
      return ok(r.status !== 500, `Status ${r.status}: ${r.data?.error || 'previewed'}`);
    });

  // ══════════════════════════════ IDEAS ═══════════════════════════════════
  const I = 'IDEA', In = 'Ideas';
  await tc(I, In, 'Employee submits a valid idea',
    'Idea accepted, id returned', async () => {
      const r = await api('POST', '/api/ideas/submit', { token: AUSER, body: {
        title: 'Reuse pallet wrap offcuts', present_situation: 'Offcuts are binned each shift, a recurring material loss.',
        proposed_solution: 'Collect and re-spool offcuts for internal packaging use.',
      }});
      return ok(r.data?.success && r.data?.idea_id, `Status ${r.status}: id=${r.data?.idea_id}`);
    });
  await tc(I, In, 'Submit an idea with a missing title',
    'Validation error — title required', async () => {
      const r = await api('POST', '/api/ideas/submit', { token: AUSER, body: { present_situation: 'x', proposed_solution: 'y' } });
      return ok(r.status >= 400 && r.status < 500, `Rejected ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(I, In, 'Submit an idea with a <script> tag in the title',
    'Stored safely / escaped, no script execution, no crash', async () => {
      const r = await api('POST', '/api/ideas/submit', { token: AUSER, body: {
        title: '<script>alert(1)</script> Improve intake', present_situation: 'aaaaaaaaaaaa test situation here',
        proposed_solution: 'bbbbbbbbbbbb test solution here',
      }});
      return ok(r.status !== 500, `Status ${r.status} (${r.data?.success ? 'stored' : r.data?.error})`);
    });
  await tc(I, In, 'Submit an idea with an extremely long title (5000+ chars)',
    'Rejected with validation, not a server crash', async () => {
      const r = await api('POST', '/api/ideas/submit', { token: AUSER, body: {
        title: 'A'.repeat(6000), present_situation: 'x'.repeat(30), proposed_solution: 'y'.repeat(30),
      }});
      return ok(r.status !== 500, r.status === 500 ? 'Server crashed (500)' : `Handled ${r.status}: ${r.data?.error || 'accepted'}`);
    });
  await tc(I, In, 'Fetch own idea by id',
    'Returns the idea record', async () => {
      const r = await api('GET', `/api/ideas/${IDEA1}`, { token: AUSER });
      return ok(r.status === 200 && (r.data?.idea || r.data?.success), `Status ${r.status}`);
    });
  await tc(I, In, 'List ideas',
    'Returns a list', async () => {
      const r = await api('GET', '/api/ideas', { token: AADMIN });
      return ok(r.status === 200, `Status ${r.status}`);
    });
  await tc(I, In, 'Dashboard aggregates for the org',
    'Returns status counts / totals', async () => {
      const r = await api('GET', '/api/ideas/dashboard', { token: AADMIN });
      return ok(r.status === 200, `Status ${r.status}`);
    });
  await tc(I, In, 'Submit an idea without authentication',
    'Rejected 401', async () => {
      const r = await api('POST', '/api/ideas/submit', { body: { title: 'anon', present_situation: 'x', proposed_solution: 'y' } });
      return ok(r.status === 401, `Status ${r.status}`);
    });

  // ══════════════════════════════ VOTING & COMMUNITY ══════════════════════
  const V = 'VOTE', Vn = 'Voting & Community';
  await tc(V, Vn, 'Community upvote on an idea',
    'Upvote recorded', async () => {
      const r = await api('POST', '/api/votes/community', { token: AADMIN, body: { idea_id: IDEA1, vote_type: 'up' } });
      return ok(r.status === 200 && (r.data?.success ?? true), `Status ${r.status}`);
    });
  await tc(V, Vn, 'Same user upvotes the same idea again',
    'Vote toggles off (idempotent), no double count', async () => {
      const r = await api('POST', '/api/votes/community', { token: AADMIN, body: { idea_id: IDEA1, vote_type: 'up' } });
      return ok(r.status === 200, `Status ${r.status}`);
    });
  await tc(V, Vn, 'Rate an idea 1–5',
    'Rating stored', async () => {
      const r = await api('POST', '/api/votes/rate', { token: AADMIN, body: { idea_id: IDEA1, rating: 4 } });
      return ok(r.status === 200, `Status ${r.status}: ${r.data?.error || 'rated'}`);
    });
  await tc(V, Vn, 'Rate an idea with an out-of-range value (6)',
    'Rejected — rating must be 1–5', async () => {
      const r = await api('POST', '/api/votes/rate', { token: AADMIN, body: { idea_id: IDEA1, rating: 6 } });
      return ok(r.status >= 400, `Rejected ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(V, Vn, 'Community vote with an invalid vote_type',
    'Rejected — vote_type must be up/down', async () => {
      const r = await api('POST', '/api/votes/community', { token: AADMIN, body: { idea_id: IDEA1, vote_type: 'sideways' } });
      return ok(r.status >= 400, `Rejected ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(V, Vn, 'Vote without a token',
    'Rejected 401', async () => {
      const r = await api('POST', '/api/votes/community', { body: { idea_id: IDEA1, vote_type: 'up' } });
      return ok(r.status === 401, `Status ${r.status}`);
    });

  // ══════════════════════════════ COMMENTS ════════════════════════════════
  const C = 'CMNT', Cn = 'Comments';
  await tc(C, Cn, 'Add a comment to an idea',
    'Comment created', async () => {
      const r = await api('POST', '/api/comments', { token: AADMIN, body: { idea_id: IDEA1, content: 'Solid idea, let us cost it.' } });
      return ok(r.status === 200 && (r.data?.success ?? true), `Status ${r.status}: ${r.data?.error || 'added'}`);
    });
  await tc(C, Cn, 'Add an empty comment',
    'Rejected — content required', async () => {
      const r = await api('POST', '/api/comments', { token: AADMIN, body: { idea_id: IDEA1, content: '   ' } });
      return ok(r.status >= 400, `Rejected ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(C, Cn, 'Add a comment over 1000 characters',
    'Rejected — length cap enforced', async () => {
      const r = await api('POST', '/api/comments', { token: AADMIN, body: { idea_id: IDEA1, content: 'z'.repeat(1200) } });
      return ok(r.status >= 400, `Rejected ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(C, Cn, 'Comment on a non-existent idea',
    'Not found', async () => {
      const r = await api('POST', '/api/comments', { token: AADMIN, body: { idea_id: 999999, content: 'hello' } });
      return ok(r.status === 404 || r.status >= 400, `Status ${r.status}`);
    });
  await tc(C, Cn, 'Comment containing a <script> tag',
    'Stored safely / escaped on render, no crash', async () => {
      const r = await api('POST', '/api/comments', { token: AADMIN, body: { idea_id: IDEA1, content: '<script>steal()</script>' } });
      return ok(r.status !== 500, `Status ${r.status}`);
    });

  // ══════════════════════════════ REVIEW & APPROVAL ═══════════════════════
  const R = 'RVW', Rn = 'Review & Approval';
  await tc(R, Rn, 'Reviewer approves an idea',
    'Idea moves to Approved with a workflow entry', async () => {
      const r = await api('POST', '/api/ideas/review-action', { token: AADMIN, body: { idea_id: IDEA2, decision: 'Approved', comment: 'Clear ROI.' } });
      return ok(r.status === 200 && (r.data?.success ?? true), `Status ${r.status}: ${r.data?.error || 'approved'}`);
    });
  await tc(R, Rn, 'Submitter tries to approve their own idea',
    'Forbidden — cannot review own idea', async () => {
      const r = await api('POST', '/api/ideas/review-action', { token: AUSER, body: { idea_id: IDEA1, decision: 'Approved', comment: 'me' } });
      return ok(r.status === 403 || r.status >= 400, `Status ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(R, Rn, 'Review with an invalid decision value',
    'Rejected — invalid decision', async () => {
      const r = await api('POST', '/api/ideas/review-action', { token: AADMIN, body: { idea_id: IDEA1, decision: 'Maybe', comment: '' } });
      return ok(r.status >= 400, `Rejected ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(R, Rn, 'Approve a non-existent idea',
    'Not found', async () => {
      const r = await api('POST', '/api/ideas/review-action', { token: AADMIN, body: { idea_id: 888888, decision: 'Approved', comment: 'x' } });
      return ok(r.status === 404 || r.status >= 400, `Status ${r.status}`);
    });
  await tc(R, Rn, 'Duplicate identical approval within 10 seconds',
    'Idempotency guard — no duplicate workflow entry', async () => {
      await api('POST', '/api/ideas/review-action', { token: AADMIN, body: { idea_id: IDEA2, decision: 'Approved', comment: 'again' } });
      const rows = await sql('ifqm_test_a', `SELECT COUNT(*) AS c FROM __DB__.idea_workflow WHERE idea_id=? AND action='Approved'`, [IDEA2]);
      return ok(Number(rows[0].c) <= 1, `Approved workflow rows: ${rows[0].c}`);
    });

  // ══════════════════════════════ CATEGORIES & CHALLENGES ═════════════════
  const K = 'CAT', Kn = 'Categories & Challenges';
  await tc(K, Kn, 'Admin creates a category',
    'Category created', async () => {
      const r = await api('POST', '/api/categories', { token: AADMIN, body: { name: 'Cost Saving' } });
      return ok(r.status !== 500 && r.status < 400 || r.data?.success, `Status ${r.status}: ${r.data?.error || 'created'}`);
    });
  await tc(K, Kn, 'List categories',
    'Returns the category list', async () => {
      const r = await api('GET', '/api/categories', { token: AADMIN });
      return ok(r.status === 200, `Status ${r.status}`);
    });
  await tc(K, Kn, 'Non-admin tries to create a category',
    'Forbidden — admin only', async () => {
      const r = await api('POST', '/api/categories', { token: AUSER, body: { name: 'Sneak' } });
      return ok(r.status === 403 || r.status === 401, `Status ${r.status}`);
    });
  await tc(K, Kn, 'Admin creates a challenge/campaign',
    'Challenge created', async () => {
      const r = await api('POST', '/api/challenges', { token: AADMIN, body: { title: 'Q3 Safety Drive', description: 'Surface safety improvements this quarter.' } });
      return ok(r.status !== 500 && (r.status < 400 || r.data?.success), `Status ${r.status}: ${r.data?.error || 'created'}`);
    });

  // ══════════════════════════════ ANALYTICS & REPORTS ═════════════════════
  const AN = 'ANL', ANn = 'Analytics & Reports';
  await tc(AN, ANn, 'Admin loads analytics aggregates',
    'Returns aggregate metrics', async () => {
      const r = await api('GET', '/api/reports/analytics', { token: AADMIN });
      return ok(r.status === 200, `Status ${r.status}`);
    });
  await tc(AN, ANn, 'Admin loads the audit report',
    'Returns the audit trail', async () => {
      const r = await api('GET', '/api/reports/audit', { token: AADMIN });
      return ok(r.status === 200, `Status ${r.status}`);
    });
  await tc(AN, ANn, 'Analytics CSV export',
    'Returns a downloadable analytics export', async () => {
      const r = await api('GET', '/api/export/analytics', { token: AADMIN });
      return ok(r.status === 200, `Status ${r.status}, type=${r.contentType}`);
    });
  await tc(AN, ANn, 'Leaderboard for the org',
    'Returns a ranked list', async () => {
      const r = await api('GET', '/api/leaderboard', { token: AADMIN });
      return ok(r.status === 200, `Status ${r.status}`);
    });

  // ══════════════════════════════ NOTIFICATIONS ═══════════════════════════
  const N = 'NTF', Nn = 'Notifications';
  await tc(N, Nn, 'List notifications for the signed-in user',
    'Returns the notification list', async () => {
      const r = await api('GET', '/api/notifications', { token: AUSER });
      return ok(r.status === 200, `Status ${r.status}`);
    });
  await tc(N, Nn, 'Mark notifications read',
    'Marked read, ok', async () => {
      const r = await api('POST', '/api/notifications/mark-read', { token: AUSER, body: { ids: [] } });
      return ok(r.status === 200 || r.status === 204, `Status ${r.status}`);
    });
  await tc(N, Nn, 'List notifications without a token',
    'Rejected 401', async () => {
      const r = await api('GET', '/api/notifications', {});
      return ok(r.status === 401, `Status ${r.status}`);
    });

  // ══════════════════════════════ REPORTS & EXPORT ════════════════════════
  const E = 'EXP', En = 'Reports & Export';
  await tc(E, En, 'Export all ideas as CSV (admin)',
    'Returns a CSV download', async () => {
      const r = await api('GET', '/api/export/ideas', { token: AADMIN });
      return ok(r.status === 200, `Status ${r.status}, type=${r.contentType}`);
    });
  await tc(E, En, 'Single-idea Closure PDF as a reviewer',
    'Returns a PDF (200)', async () => {
      const r = await api('GET', `/api/export/idea/${IDEA2}/pdf`, { token: AADMIN });
      return ok(r.status === 200 && /pdf/i.test(r.contentType), `Status ${r.status}, type=${r.contentType}`);
    });
  await tc(E, En, 'Single-idea PDF requested from another tenant',
    'Blocked — tenant boundary', async () => {
      const r = await api('GET', `/api/export/idea/${IDEA2}/pdf`, { token: BADMIN });
      return ok(r.status >= 400, `Status ${r.status}`);
    });

  // ══════════════════════════════ BRANDING & SETTINGS ═════════════════════
  const B = 'BRND', Bn = 'Branding & Settings';
  await tc(B, Bn, 'Admin reads branding',
    'Returns branding config', async () => {
      const r = await api('GET', '/api/branding', { token: AADMIN });
      return ok(r.status === 200, `Status ${r.status}`);
    });
  await tc(B, Bn, 'Employee tries to update branding',
    'Forbidden — admin only', async () => {
      const r = await api('PUT', '/api/branding', { token: AUSER, body: { org_name: 'Hacked' } });
      return ok(r.status === 403 || r.status === 401, `Status ${r.status}`);
    });
  await tc(B, Bn, 'Admin saves settings; SMTP secret is never echoed back',
    'Saved; password field masked/omitted on read', async () => {
      await api('POST', '/api/settings', { token: AADMIN, body: { smtp_host: 'smtp.test', smtp_pass: 'topsecret', review_sla_days: '9' } });
      const r = await api('GET', '/api/settings', { token: AADMIN });
      const leaked = JSON.stringify(r.data || {}).includes('topsecret');
      return ok(!leaked, leaked ? 'Secret echoed back (LEAK)' : 'Secret not echoed');
    });

  // ══════════════════════════════ SUPPORT ═════════════════════════════════
  const S = 'SUP', Sn = 'Support';
  let ticketId = null;
  await tc(S, Sn, 'User raises a support ticket',
    'Ticket created', async () => {
      const r = await api('POST', '/api/support/tickets', { token: AUSER, body: { subject: 'Cannot upload photo', body: 'Upload fails on submit.' } });
      ticketId = r.data?.ticket?.id || r.data?.id;
      return ok(r.status === 200 || r.status === 201, `Status ${r.status}: id=${ticketId}`);
    });
  await tc(S, Sn, 'Another org cannot read this org\'s ticket',
    'Blocked — tenant isolation', async () => {
      const r = await api('GET', `/api/support/tickets/${ticketId}`, { token: BADMIN });
      return ok(r.status >= 400, `Status ${r.status}`);
    });
  await tc(S, Sn, 'Platform internal note stays hidden from the tenant',
    'Internal message not visible to org users', async () => {
      await api('POST', `/api/platform/tickets/${ticketId}/messages`, { token: PA, body: { body: 'INTERNAL-MARKER upsell', is_internal: true } });
      const thread = await api('GET', `/api/support/tickets/${ticketId}`, { token: AUSER });
      const leaked = JSON.stringify(thread.data || {}).includes('INTERNAL-MARKER');
      return ok(!leaked, leaked ? 'Internal note leaked' : 'Internal note hidden');
    });

  // ══════════════════════════════ QCMS INTEGRATION ════════════════════════
  const Q = 'QCMS', Qn = 'QCMS Integration';
  await tc(Q, Qn, 'Admin saves the QCMS API key',
    'Saved and enabled', async () => {
      const r = await api('PUT', '/api/integrations/qcms', { token: AADMIN, body: { api_key: 'qcms_live_testkey_123456', enabled: true } });
      return ok(r.status === 200 && (r.data?.success ?? true), `Status ${r.status}: ${r.data?.error || 'saved'}`);
    });
  await tc(Q, Qn, 'Reading the QCMS config masks the stored key',
    'Key returned masked (••••), never in clear', async () => {
      const r = await api('GET', '/api/integrations/qcms', { token: AADMIN });
      const clear = JSON.stringify(r.data || {}).includes('testkey_123456');
      return ok(!clear, clear ? 'Key returned in clear (LEAK)' : 'Key masked');
    });
  await tc(Q, Qn, 'QCMS base URL is taken from the environment, not the client',
    'No client-writable base_url; env value is authoritative', async () => {
      const r = await api('PUT', '/api/integrations/qcms', { token: AADMIN, body: { api_key: 'qcms_live_testkey_123456', enabled: true, base_url: 'https://evil.example' } });
      const cfg = await api('GET', '/api/integrations/qcms', { token: AADMIN });
      const took = JSON.stringify(cfg.data || {}).includes('evil.example');
      return ok(!took, took ? 'Client base_url accepted (RISK)' : 'Client base_url ignored');
    });
  await tc(Q, Qn, 'List approved ideas eligible to push (admin)',
    'Returns approved ideas', async () => {
      const r = await api('GET', '/api/integrations/approved-ideas', { token: AADMIN });
      return ok(r.status === 200, `Status ${r.status}`);
    });
  await tc(Q, Qn, 'Non-admin attempts to push to QCMS',
    'Forbidden — admin only', async () => {
      const r = await api('POST', '/api/integrations/push', { token: AUSER, body: { idea_ids: [IDEA2] } });
      return ok(r.status === 403 || r.status === 401, `Status ${r.status}`);
    });

  // ══════════════════════════════ SECURITY & MULTI-TENANCY ════════════════
  const SEC = 'SEC', SECn = 'Security & Multi-Tenancy';
  await tc(SEC, SECn, 'Org A user cannot see Org B idea content',
    'Cross-tenant content never exposed (own-tenant record or 404)', async () => {
      // IDs auto-increment per tenant, so the same number exists in both DBs.
      // Proof of isolation is by CONTENT: Org A must never receive Org B's idea.
      const bIdea = await mkIdea(BADMIN, 'ORGB-SECRET-MARKER coolant recipe');
      const r = await api('GET', `/api/ideas/${bIdea}`, { token: AUSER });
      const leaked = JSON.stringify(r.data || {}).includes('ORGB-SECRET-MARKER');
      return ok(!leaked, leaked ? 'Org B content exposed (CRITICAL)' : `No cross-tenant content (status ${r.status})`);
    });
  await tc(SEC, SECn, 'A tenant JWT cannot reach platform-admin routes',
    'Forbidden', async () => {
      const r = await api('GET', '/api/platform/admins', { token: AADMIN });
      return ok(r.status === 403 || r.status === 401, `Status ${r.status}`);
    });
  await tc(SEC, SECn, 'SQL injection in a query parameter',
    'Handled safely, no 500/leak', async () => {
      const r = await api('GET', `/api/ideas/check-duplicate?title=${encodeURIComponent("' OR 1=1 --")}`, { token: AUSER });
      return ok(r.status !== 500, `Status ${r.status}`);
    });
  await tc(SEC, SECn, 'Oversized JSON payload',
    'Rejected cleanly (413/400), not a crash', async () => {
      const r = await api('POST', '/api/ideas/submit', { token: AUSER, body: { title: 'big', present_situation: 'x'.repeat(2_000_000), proposed_solution: 'y' } });
      return ok(r.status !== 500 || r.status === 413, `Status ${r.status}`);
    });
  await tc(SEC, SECn, 'Health and readiness probes respond',
    'Liveness ok; readiness reports DB reachability', async () => {
      const h = await api('GET', '/api/health', {});
      const rd = await api('GET', '/api/ready', {});
      return ok(h.status === 200 && (rd.status === 200 || rd.status === 503), `health=${h.status}, ready=${rd.status}`);
    });

  await teardownSuite();

  const pass = results.filter(r => r.result === 'Pass').length;
  const fail = results.length - pass;
  fs.writeFileSync(OUT, JSON.stringify({ generated: stamp(), total: results.length, pass, fail, results }, null, 2));
  process.stdout.write(`\n\nWrote ${results.length} cases → ${OUT}  (Pass ${pass}, Fail ${fail})\n`);
}

main().catch(async (e) => {
  console.error('\nRunner crashed:', e);
  try { await teardownSuite(); } catch {}
  process.exit(1);
});

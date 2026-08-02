/**
 * Backend invariant suite.
 *
 * These are not unit tests — they drive the real Express app over HTTP against
 * scratch databases, because every regression this suite exists to catch was a
 * cross-layer one: a controller trusting a service, a service trusting a
 * driver, a mask string dying in transport. Each test names the incident or
 * property it guards.
 *
 * Run:  npm test   (from backend/)
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  setupSuite, teardownSuite, api, login, sql, signToken,
  tinyPng, fakePng, PASSWORDS,
} from './helpers.js';
import { mapIdeaToQcms, pushIdeaToQcms } from '../src/services/qcmsService.js';
import config from '../src/config/index.js';

let PA;       // platform admin token
let AADMIN;   // org A admin token
let AUSER;    // org A employee token
let BADMIN;   // org B admin token
let tenantAId;
let tenantBId;

before(async () => {
  await setupSuite();
  PA = (await login('platform@ifqm.io', PASSWORDS.platform)).token;
  AADMIN = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;
  AUSER = (await login('user@orga.test', PASSWORDS.orgaUser, 'orga')).token;
  BADMIN = (await login('admin@orgb.test', PASSWORDS.orgbAdmin, 'orgb')).token;
  assert.ok(PA && AADMIN && AUSER && BADMIN, 'all four seed accounts must be able to sign in');

  const tenants = await sql('ifqm_test_master', 'SELECT id, slug FROM ifqm_test_master.tenants');
  tenantAId = tenants.find((t) => t.slug === 'orga').id;
  tenantBId = tenants.find((t) => t.slug === 'orgb').id;
});

after(async () => { await teardownSuite(); });

// ── Authentication ──────────────────────────────────────────────────────────

test('wrong password is 401 and counts toward lockout', async () => {
  const r = await login('user@orga.test', 'not-the-password', 'orga');
  assert.equal(r.status, 401);
  assert.match(r.error, /attempt\(s\) remaining/);
});

test('nonexistent email gets the same 401 as a wrong password (no enumeration)', async () => {
  const r = await login('nobody@orga.test', 'whatever', 'orga');
  assert.equal(r.status, 401);
  assert.match(r.error, /Invalid email\/phone or password/);
});

test('5 failures lock the account for 15 minutes', async () => {
  for (let i = 0; i < 5; i++) await login('locked@orga.test', 'bad', 'orga');
  const r = await login('locked@orga.test', 'bad', 'orga');
  assert.equal(r.status, 429);
  assert.match(r.error, /try again in/i);
});

test('a tampered JWT signature is rejected', async () => {
  const good = signToken({ user: { id: 1, role: 'admin' }, org_slug: 'orga', pwd_ts: 0 });
  const bad = good.slice(0, -4) + (good.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  const r = await api('GET', '/api/auth/me', { token: bad });
  // optionalAuth treats an invalid token as "not signed in", never as an error.
  assert.equal(r.status, 200);
  assert.equal(r.data.authenticated, false);
});

test('a token with a stale pwd_ts is rejected (password change revokes sessions)', async () => {
  const rows = await sql('ifqm_test_a', 'SELECT id FROM ifqm_test_a.users WHERE email = ?', ['user@orga.test']);
  const stale = signToken({ user: { id: rows[0].id, role: 'employee' }, org_slug: 'orga', pwd_ts: 12345 });
  const r = await api('GET', '/api/notifications', { token: stale });
  assert.equal(r.status, 401);
});

// ── Cross-tenant isolation ──────────────────────────────────────────────────

test('a ticket raised in org A is invisible to org B — list and direct read', async () => {
  const created = await api('POST', '/api/support/tickets', {
    token: AUSER,
    body: { subject: 'Isolation probe', body: 'raised inside org A' },
  });
  assert.equal(created.data.success, true);
  const id = created.data.ticket_id;

  const bList = await api('GET', '/api/support/tickets', { token: BADMIN });
  assert.equal(bList.data.tickets.length, 0, 'org B must see an empty list');

  const bRead = await api('GET', `/api/support/tickets/${id}`, { token: BADMIN });
  assert.equal(bRead.status, 404, 'direct read across tenants must 404, not 403 (no existence oracle)');
});

test('an employee sees only their own tickets; their org admin sees the org', async () => {
  const asAdmin = await api('GET', '/api/support/tickets', { token: AADMIN });
  assert.ok(asAdmin.data.tickets.length >= 1);
  const asUser = await api('GET', '/api/support/tickets', { token: AUSER });
  assert.ok(asUser.data.tickets.every((t) => t.requester_name === 'Orga Employee'));
});

// ── Ticket privacy: internal notes ──────────────────────────────────────────

test('IFQM internal notes never reach any tenant reader', async () => {
  const created = await api('POST', '/api/support/tickets', {
    token: AUSER, body: { subject: 'Note privacy', body: 'help' },
  });
  const id = created.data.ticket_id;

  await api('POST', `/api/platform/tickets/${id}/messages`, {
    token: PA, body: { body: 'public answer' },
  });
  await api('POST', `/api/platform/tickets/${id}/messages`, {
    token: PA, body: { body: 'INTERNAL-MARKER-9f2a upsell them', is_internal: true },
  });

  for (const [who, token] of [['employee', AUSER], ['tenant admin', AADMIN]]) {
    const thread = await api('GET', `/api/support/tickets/${id}`, { token });
    const text = JSON.stringify(thread.data);
    assert.ok(!text.includes('INTERNAL-MARKER-9f2a'), `internal note leaked to ${who}`);
    assert.ok(text.includes('public answer'), `${who} should still see the public reply`);
  }

  const paThread = await api('GET', `/api/platform/tickets/${id}`, { token: PA });
  assert.ok(JSON.stringify(paThread.data).includes('INTERNAL-MARKER-9f2a'), 'platform must see its own note');
});

test('tenants may close their ticket but never set IFQM triage statuses', async () => {
  const created = await api('POST', '/api/support/tickets', {
    token: AUSER, body: { subject: 'Status rules', body: 'x' },
  });
  const id = created.data.ticket_id;

  const resolve = await api('PATCH', `/api/support/tickets/${id}`, { token: AUSER, body: { status: 'resolved' } });
  assert.equal(resolve.status, 403);

  const close = await api('PATCH', `/api/support/tickets/${id}`, { token: AUSER, body: { status: 'closed' } });
  assert.equal(close.data.success, true);

  const replyClosed = await api('POST', `/api/support/tickets/${id}/messages`, { token: AUSER, body: { body: 'hi' } });
  assert.equal(replyClosed.status, 400, 'replying to a closed ticket must be refused');
});

// ── Branding ────────────────────────────────────────────────────────────────

test('any user reads branding; only admins write it', async () => {
  const read = await api('GET', '/api/branding', { token: AUSER });
  assert.equal(read.data.success, true);

  const write = await api('PUT', '/api/branding', { token: AUSER, body: { org_name: 'Hacked' } });
  assert.equal(write.status, 403);
});

test('logo upload validates the actual bytes, not the filename', async () => {
  const upload = (bytes) => {
    const fd = new FormData();
    fd.append('logo', new Blob([bytes], { type: 'image/png' }), 'logo.png');
    return api('POST', '/api/branding/logo', { token: AADMIN, raw: fd });
  };

  const fake = await upload(fakePng());
  assert.equal(fake.status, 400, 'GIF bytes in a .png must be rejected');

  const real = await upload(tinyPng());
  assert.equal(real.data.success, true);
  assert.match(real.data.logo, /^data:image\/png;base64,/);

  // org B must not see org A's logo
  const bBranding = await api('GET', '/api/branding', { token: BADMIN });
  assert.equal(bBranding.data.branding.logo, null);
});

// ── SMTP password lifecycle (the wipe incidents) ────────────────────────────

test('saving unrelated tenant settings never wipes a stored SMTP password', async () => {
  await sql('ifqm_test_a', `UPDATE ifqm_test_a.org_settings SET value = 'MailSecret1' WHERE key_name = 'smtp_pass'`);

  // The exact request AdminPage sends with an untouched password field.
  const save = await api('POST', '/api/settings', {
    token: AADMIN, body: { smtp_host: 'smtp.test', smtp_pass: '', review_sla_days: '9' },
  });
  assert.equal(save.data.success, true);

  const rows = await sql('ifqm_test_a', `SELECT value FROM ifqm_test_a.org_settings WHERE key_name = 'smtp_pass'`);
  assert.equal(rows[0].value, 'MailSecret1', 'untouched field wiped the stored password');
});

test('platform console never returns smtp_pass, and empty writes preserve it', async () => {
  const get = await api('GET', `/api/platform/tenants/${tenantAId}/settings`, { token: PA });
  assert.equal('smtp_pass' in get.data.settings, false, 'smtp_pass must never be in a response');
  assert.equal(get.data.settings.smtp_pass_set, true);

  await api('PUT', `/api/platform/tenants/${tenantAId}/settings`, {
    token: PA, body: { smtp_pass: '', review_sla_days: '7' },
  });
  let rows = await sql('ifqm_test_a', `SELECT value FROM ifqm_test_a.org_settings WHERE key_name = 'smtp_pass'`);
  assert.equal(rows[0].value, 'MailSecret1');

  await api('PUT', `/api/platform/tenants/${tenantAId}/settings`, {
    token: PA, body: { smtp_pass_clear: true },
  });
  rows = await sql('ifqm_test_a', `SELECT value FROM ifqm_test_a.org_settings WHERE key_name = 'smtp_pass'`);
  assert.equal(rows[0].value, '', 'explicit clear must actually clear');
});

// ── Platform privacy boundary ───────────────────────────────────────────────

test('platform tenant views expose no employee PII — only admin contacts', async () => {
  for (const path of ['/api/platform/tenants', `/api/platform/tenants/${tenantAId}`]) {
    const r = await api('GET', path, { token: PA });
    const text = JSON.stringify(r.data);
    assert.ok(!text.includes('Orga Employee'), `employee name leaked via ${path}`);
    assert.ok(!text.includes('user@orga.test'), `employee email leaked via ${path}`);
    assert.ok(!text.includes('db_pass'), `db credentials leaked via ${path}`);
  }
  const detail = await api('GET', `/api/platform/tenants/${tenantAId}`, { token: PA });
  assert.equal(detail.data.admins.length, 1);
  assert.equal(detail.data.admins[0].email, 'admin@orga.test');
});

test('the old org-chart endpoint stays dead', async () => {
  const r = await api('GET', `/api/platform/tenants/${tenantAId}/hierarchy`, { token: PA });
  assert.equal(r.status, 404);
});

test('tenant admins cannot reach platform endpoints', async () => {
  const r = await api('GET', '/api/platform/tenants', { token: AADMIN });
  assert.equal(r.status, 401);
});

// ── Tenant management ───────────────────────────────────────────────────────

test('suspending a tenant blocks its logins; reactivating restores them', async () => {
  await api('PATCH', `/api/platform/tenants/${tenantBId}`, { token: PA, body: { status: 'suspended' } });
  const blocked = await login('admin@orgb.test', PASSWORDS.orgbAdmin, 'orgb');
  assert.equal(blocked.status, 404);

  await api('PATCH', `/api/platform/tenants/${tenantBId}`, { token: PA, body: { status: 'active' } });
  const restored = await login('admin@orgb.test', PASSWORDS.orgbAdmin, 'orgb');
  assert.ok(restored.token, 'reactivated org must be able to sign in again');
  BADMIN = restored.token;
});

test('the default org cannot be suspended; deletion requires the org code', async () => {
  const suspend = await api('PATCH', `/api/platform/tenants/${tenantAId}`, { token: PA, body: { status: 'suspended' } });
  assert.equal(suspend.status, 400);

  const del = await api('DELETE', `/api/platform/tenants/${tenantBId}`, { token: PA, body: { confirm_slug: 'wrong' } });
  assert.equal(del.status, 400);
});

test('admin password reset is scoped to admins only', async () => {
  const employee = await api('POST', `/api/platform/tenants/${tenantAId}/reset-admin-password`, {
    token: PA, body: { admin_email: 'user@orga.test' },
  });
  assert.equal(employee.status, 404, 'must not be usable to take over an employee account');
});

// ── Platform admin accounts ─────────────────────────────────────────────────

test('platform admin account guards hold', async () => {
  const weak = await api('POST', '/api/platform/admins', {
    token: PA, body: { name: 'X', email: 'x@ifqm.io', password: 'short' },
  });
  assert.equal(weak.status, 400);

  const admins = await api('GET', '/api/platform/admins', { token: PA });
  const meId = admins.data.admins[0].id;

  const self = await api('DELETE', `/api/platform/admins/${meId}`, { token: PA });
  assert.equal(self.status, 400, 'self-delete must be refused');

  const wrongPw = await api('POST', '/api/platform/admins/change-password', {
    token: PA, body: { current_password: 'nope', new_password: 'SomethingLong123' },
  });
  assert.equal(wrongPw.status, 400);
});

// ── Notifications (the platform-admin 500) ──────────────────────────────────

test('notification polling as a platform admin returns empty, not 500', async () => {
  const r = await api('GET', '/api/notifications', { token: PA });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { success: true, notifications: [], unread_count: 0 });
});

// ── Support-required attachment + single-idea PDF export ─────────────────────

test('an employee can attach a document to the Support Required section', async () => {
  const submit = await api('POST', '/api/ideas/submit', {
    token: AUSER,
    body: {
      title: 'Recirculate coolant on line 3',
      present_situation: 'Coolant is drained weekly regardless of condition, wasting usable fluid and driving cost.',
      proposed_solution: 'Add an inline filtration loop and replace coolant only on measured breakdown.',
      investment_required: '85000', support_required: 'Maintenance team plus a 4-hour line stop.',
    },
  });
  assert.equal(submit.data.success, true, 'the idea must submit');
  const ideaId = submit.data.idea_id;

  // The new 'support' section is accepted and stored under that label.
  const fd = new FormData();
  fd.append('file', new Blob([tinyPng()], { type: 'image/png' }), 'quote.png');
  fd.append('idea_id', String(ideaId));
  fd.append('section', 'support');
  const up = await api('POST', '/api/upload', { token: AUSER, raw: fd });
  assert.equal(up.data.success, true, 'a support-section upload must succeed');

  const rows = await sql('ifqm_test_a',
    `SELECT section FROM ifqm_test_a.idea_attachments WHERE idea_id = ? AND filename = 'quote.png'`, [ideaId]);
  assert.equal(rows[0]?.section, 'support', 'the attachment must be stored under the support section');

  // A section outside the whitelist is still refused.
  const fd2 = new FormData();
  fd2.append('file', new Blob([tinyPng()], { type: 'image/png' }), 'x.png');
  fd2.append('idea_id', String(ideaId));
  fd2.append('section', 'bogus');
  const bad = await api('POST', '/api/upload', { token: AUSER, raw: fd2 });
  assert.equal(bad.status, 400, 'an unknown section must be rejected');
});

test('the single-idea Closure Summary PDF honours the review hierarchy and tenant boundary', async () => {
  const submit = await api('POST', '/api/ideas/submit', {
    token: AUSER,
    body: {
      title: 'Laser-mark part numbers instead of ink stamping',
      present_situation: 'Ink stamps smudge and fail traceability audits on about three percent of parts.',
      proposed_solution: 'Replace the ink stamp with an inline fibre laser marker tied to the MES part record.',
      roi_value: 450000, roi_type: 'quality_improvement',
    },
  });
  const ideaId = submit.data.idea_id;

  // A reviewer (the org admin) gets an actual PDF back.
  const asAdmin = await api('GET', `/api/export/idea/${ideaId}/pdf`, { token: AADMIN });
  assert.equal(asAdmin.status, 200);
  assert.match(asAdmin.contentType, /application\/pdf/);
  assert.ok(asAdmin.text.startsWith('%PDF'), 'the body must be a PDF document');

  // The employee who submitted it is not in the review hierarchy → forbidden.
  const asUser = await api('GET', `/api/export/idea/${ideaId}/pdf`, { token: AUSER });
  assert.equal(asUser.status, 403);

  // An admin in another tenant cannot reach org A's idea at all.
  const asOrgB = await api('GET', `/api/export/idea/${ideaId}/pdf`, { token: BADMIN });
  assert.equal(asOrgB.status, 404);
});

// ── Login with no org code — email or registered phone ──────────────────────

test('a user signs in with just their email — no organisation code needed', async () => {
  // Note the missing third argument: org_slug is empty, so the platform must
  // work out the tenant from the email itself (login directory → tenant scan).
  const r = await login('user@orga.test', PASSWORDS.orgaUser);
  assert.ok(r.token, 'email-only login must succeed');
  assert.equal(r.user.org_slug, 'orga', 'the correct organisation must be resolved from the email');
});

test('a user signs in with their registered phone number', async () => {
  await sql('ifqm_test_a', "UPDATE ifqm_test_a.users SET phone = '+91-98765 43210' WHERE email = 'user@orga.test'");
  const r = await login('9876543210', PASSWORDS.orgaUser); // typed as a phone, no org code
  assert.ok(r.token, 'phone-number login must succeed');
  assert.equal(r.user.email, 'user@orga.test', 'the phone must resolve to the right account');
});

test('an unknown email is refused generically, exactly like a wrong password', async () => {
  const r = await login('does-not-exist@nowhere.test', 'whatever'); // no org code
  assert.equal(r.status, 401);
  assert.match(r.error, /Invalid email\/phone or password/);
});

// ── Co-suggesters beyond two, benefits attachment, monthly dashboard ────────

test('an idea can credit more than two co-suggesters', async () => {
  await sql('ifqm_test_a', `INSERT INTO ifqm_test_a.users (employee_id,name,email,password_hash,role,status,password_changed_at) VALUES
    ('C1','Co One','co1@orga.test','x','employee','active',NOW()),
    ('C2','Co Two','co2@orga.test','x','employee','active',NOW()),
    ('C3','Co Three','co3@orga.test','x','employee','active',NOW())`);
  const rows = await sql('ifqm_test_a', "SELECT id FROM ifqm_test_a.users WHERE email IN ('co1@orga.test','co2@orga.test','co3@orga.test') ORDER BY email");
  const coIds = rows.map((r) => r.id);
  assert.equal(coIds.length, 3);

  const submit = await api('POST', '/api/ideas/submit', {
    token: AUSER,
    body: {
      title: 'Idea crediting three colleagues',
      present_situation: 'A present situation described in enough detail to pass the validation checks.',
      proposed_solution: 'A proposed solution described here in a sentence.',
      co_suggester_ids: coIds,
    },
  });
  assert.equal(submit.data.success, true);

  const got = await api('GET', `/api/ideas/${submit.data.idea_id}`, { token: AADMIN });
  assert.equal(got.data.idea.co_suggesters.length, 3, 'all three co-suggesters must be stored, not just two');
});

test('a document can be attached to the Benefits Expected section', async () => {
  const submit = await api('POST', '/api/ideas/submit', {
    token: AUSER,
    body: {
      title: 'Idea with a benefits document',
      present_situation: 'A present situation described in enough detail to pass validation.',
      proposed_solution: 'A proposed solution.',
      benefits_expected: 'Projected savings attached.',
    },
  });
  const fd = new FormData();
  fd.append('file', new Blob([tinyPng()], { type: 'image/png' }), 'projection.png');
  fd.append('idea_id', String(submit.data.idea_id));
  fd.append('section', 'benefits');
  const up = await api('POST', '/api/upload', { token: AUSER, raw: fd });
  assert.equal(up.data.success, true, 'a benefits-section upload must succeed');
});

test('the dashboard reports monthly submission activity', async () => {
  const r = await api('GET', '/api/ideas/dashboard', { token: AADMIN });
  assert.equal(r.data.success, true);
  assert.ok(Array.isArray(r.data.monthly), 'a monthly submission series must be present');
});

// ── QCMS integration (push approved ideas) ──────────────────────────────────

test('QCMS payload maps our idea onto the documented field shape', () => {
  const p = mapIdeaToQcms({
    idea_code: 'IDA-2026-006', title: 'Reduce Paint Defects', impact_areas: 'Quality',
    present_situation: 'Paint rejection rose 2%→6%.', proposed_solution: 'Automatic viscosity monitoring.',
    department: 'Production', submitter_name: 'John Doe', is_anonymous: 0,
    co_suggester_names: 'Smith, David', roi_value: 100000, intangible_benefit: 'Customer satisfaction',
    investment_required: '₹ 2,50,000', implementation_duration: '8 Weeks', impact_level: 'Medium',
  });
  assert.equal(p.ideaCode, 'IDA-2026-006');
  assert.equal(p.status, 'Approved');
  assert.equal(p.category, 'Quality');
  assert.equal(p.submittedBy, 'John Doe');
  assert.deepEqual(p.coSuggesters, ['Smith', 'David']);
  assert.equal(p.tangibleBenefit, 100000);
  assert.equal(p.investmentRequired, 250000);       // parsed out of "₹ 2,50,000"
  assert.equal(p.implementationTime, '8 Weeks');
  assert.equal(p.impactLevel, 'Medium');
});

test('QCMS integration: approved-ideas list, key masking, and the push flow', async () => {
  // Approved-ideas + config are org-admin only.
  const asUser = await api('GET', '/api/integrations/approved-ideas', { token: AUSER });
  assert.equal(asUser.status, 403);

  // Seed an approved idea in org A.
  const submit = await api('POST', '/api/ideas/submit', {
    token: AUSER,
    body: {
      title: 'Reduce paint defects', present_situation: 'Paint rejection rose from 2% to 6% on line 3.',
      proposed_solution: 'Install automatic viscosity monitoring on the paint line.',
      roi_value: 100000, investment_required: '250000',
    },
  });
  const ideaId = submit.data.idea_id;
  await sql('ifqm_test_a', "UPDATE ifqm_test_a.ideas SET status = 'Approved' WHERE id = ?", [ideaId]);

  const list = await api('GET', '/api/integrations/approved-ideas', { token: AADMIN });
  assert.ok(list.data.ideas.some((i) => i.id === ideaId), 'the approved idea must appear in the list');

  // A stand-in QCMS server: checks the Bearer key, 409s a repeat ideaCode, else 201.
  const VALID = 'qcms_live_testkey';
  const seen = new Set();
  const qcms = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const auth = req.headers.authorization || '';
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (auth !== `Bearer ${VALID}`) return send(401, { error: 'Unauthorized', message: 'Invalid or disabled API Key.' });
      let body = {}; try { body = JSON.parse(raw); } catch { /* */ }
      if (seen.has(body.ideaCode)) return send(409, { message: 'Idea already imported.' });
      seen.add(body.ideaCode);
      return send(201, { success: true, message: 'Idea imported successfully.', ideaCode: body.ideaCode });
    });
  });
  await new Promise((r) => qcms.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${qcms.address().port}/api/v1/integrations`;
  // Exercise the default (no per-tenant override) path: point the runtime config
  // at the mock server for the duration of this test.
  const savedBase = config.qcms.baseUrl;
  config.qcms.baseUrl = base;

  try {
    // Save config; the key comes back masked, never in the clear.
    await api('PUT', '/api/integrations/qcms', { token: AADMIN, body: { api_key: VALID, enabled: true } });
    const cfg = await api('GET', '/api/integrations/qcms', { token: AADMIN });
    assert.equal(cfg.data.config.api_key, '••••••••');
    assert.equal(cfg.data.config.api_key_set, true);
    assert.equal(cfg.data.config.enabled, true);

    // Saving with the mask (an untouched field) must NOT wipe the stored key.
    await api('PUT', '/api/integrations/qcms', { token: AADMIN, body: { enabled: true, api_key: '••••••••' } });

    // First push → imported, and recorded on the idea.
    const push1 = await api('POST', '/api/integrations/push', { token: AADMIN, body: { idea_ids: [ideaId] } });
    assert.equal(push1.data.imported, 1);
    const rows = await sql('ifqm_test_a', 'SELECT qcms_push_status FROM ifqm_test_a.ideas WHERE id = ?', [ideaId]);
    assert.equal(rows[0].qcms_push_status, 'imported');

    // Second push of the same idea → duplicate (QCMS 409).
    const push2 = await api('POST', '/api/integrations/push', { token: AADMIN, body: { idea_ids: [ideaId] } });
    assert.equal(push2.data.duplicate, 1);

    // A bad key → failed (QCMS 401), never a server crash.
    await api('PUT', '/api/integrations/qcms', { token: AADMIN, body: { api_key: 'wrong-key', enabled: true } });
    const push3 = await api('POST', '/api/integrations/push', { token: AADMIN, body: { idea_ids: [ideaId] } });
    assert.equal(push3.data.failed, 1);

    // An employee cannot push.
    const pushAsUser = await api('POST', '/api/integrations/push', { token: AUSER, body: { idea_ids: [ideaId] } });
    assert.equal(pushAsUser.status, 403);
  } finally {
    config.qcms.baseUrl = savedBase;
    await new Promise((r) => qcms.close(r));
  }
});

test('the QCMS base URL can be overridden per tenant from the admin dashboard', async () => {
  // A stand-in QCMS that always imports, so a push proves which base URL was used.
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Idea imported successfully.' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const override = `http://127.0.0.1:${server.address().port}/custom/v1`;
  // The .env default must NOT be reachable — only the override may satisfy a push.
  const savedBase = config.qcms.baseUrl;
  config.qcms.baseUrl = 'http://127.0.0.1:1/unreachable';

  try {
    // Out of the box the field is empty and the .env default is reported.
    const before = await api('GET', '/api/integrations/qcms', { token: AADMIN });
    assert.equal(before.data.config.base_url_custom, false);
    assert.equal(before.data.config.base_url, config.qcms.baseUrl);
    assert.equal(before.data.config.default_base_url, config.qcms.baseUrl);

    // A typo must be rejected rather than silently sending ideas nowhere.
    const bad = await api('PUT', '/api/integrations/qcms', { token: AADMIN, body: { base_url: 'not a url' } });
    assert.equal(bad.status, 400);
    const badScheme = await api('PUT', '/api/integrations/qcms', { token: AADMIN, body: { base_url: 'ftp://qcms.example.com' } });
    assert.equal(badScheme.status, 400);

    // Save the override (trailing slashes trimmed) alongside a working key.
    const saved = await api('PUT', '/api/integrations/qcms', {
      token: AADMIN, body: { base_url: `${override}/`, api_key: 'qcms_live_override', enabled: true },
    });
    assert.equal(saved.data.config.base_url, override);
    assert.equal(saved.data.config.base_url_custom, true);
    assert.equal(saved.data.config.default_base_url, config.qcms.baseUrl, 'the .env default stays visible as the fallback');

    // The push must go to the override, not the (unreachable) default.
    const [idea] = await sql('ifqm_test_a', "SELECT id FROM ifqm_test_a.ideas WHERE status = 'Approved' LIMIT 1");
    const push = await api('POST', '/api/integrations/push', { token: AADMIN, body: { idea_ids: [idea.id] } });
    assert.equal(push.data.imported, 1);
    assert.deepEqual(hits, ['/custom/v1/ideas']);

    // An org admin cannot reach into another tenant: org B still sees the default.
    const otherOrg = await api('GET', '/api/integrations/qcms', { token: BADMIN });
    assert.equal(otherOrg.data.config.base_url_custom, false);

    // Clearing the field falls back to the .env default.
    const cleared = await api('PUT', '/api/integrations/qcms', { token: AADMIN, body: { base_url: '' } });
    assert.equal(cleared.data.config.base_url_custom, false);
    assert.equal(cleared.data.config.base_url, config.qcms.baseUrl);
    assert.equal(cleared.data.config.api_key_set, true, 'clearing the URL must not wipe the stored key');
  } finally {
    config.qcms.baseUrl = savedBase;
    await new Promise((r) => server.close(r));
  }
});

test('a QCMS duplicate-key leak (HTTP 500) is treated as a duplicate, not a failure', async () => {
  // Some QCMS builds return a raw Postgres unique-constraint error with a 500
  // instead of the documented 409 when an idea already exists. The idea IS in
  // QCMS, so we must classify it as a duplicate — never a hard failure.
  const server = http.createServer((_req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      message: '(psycopg2.errors.UniqueViolation) duplicate key value violates unique constraint "imported_ideas_idea_code_key"\nDETAIL:  Key (idea_code)=(IDA-2026-006) already exists.',
    }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const r = await pushIdeaToQcms({
      baseUrl: `http://127.0.0.1:${server.address().port}/api/v1/integrations`,
      apiKey: 'qcms_live_x',
      idea: { idea_code: 'IDA-2026-006', title: 'x', impact_areas: 'Quality', impact_level: 'Medium' },
    });
    assert.equal(r.status, 'duplicate', 'a leaked unique-constraint error must be read as a duplicate');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

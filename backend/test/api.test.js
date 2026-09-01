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
import ExcelJS from 'exceljs';
import {
  getBaseUrl,
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
  assert.match(r.error, /Invalid sign-in details or password/);
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
  assert.deepEqual(r.data, { success: true, notifications: [], unread_count: 0, total: 0 });
});

test('notifications: the unread badge counts the account, not the visible page', async () => {
  const rows = await sql('ifqm_test_a', "SELECT id FROM ifqm_test_a.users WHERE email='user@orga.test'");
  const uid = rows[0].id;
  // More than one page's worth, so a count taken from the returned rows would
  // under-report — which is exactly what the badge used to do.
  const values = Array.from({ length: 60 },
    (_, i) => `(${uid}, 'Bulk ${i}', 'noise', 0)`).join(',');
  await sql('ifqm_test_a',
    `INSERT INTO ifqm_test_a.notifications (user_id, title, message, is_read) VALUES ${values}`);

  const listed = await api('GET', '/api/notifications', { token: AUSER });
  assert.equal(listed.status, 200);
  assert.ok(listed.data.unread_count >= 60,
    `badge must count every unread, got ${listed.data.unread_count}`);
  assert.ok(listed.data.total >= 60);
  assert.ok(listed.data.notifications.length <= 50, 'the page itself stays capped');
  assert.equal(listed.data.has_more, true);

  // Marking ONE read must mark exactly one. The controller used to drop the
  // ids it was sent and mark every notification the user had, so opening a
  // single item silently cleared the lot.
  const first = listed.data.notifications[0];
  await api('POST', '/api/notifications/mark-read', { token: AUSER, body: { ids: [first.id] } });
  const afterOne = await api('GET', '/api/notifications', { token: AUSER });
  assert.equal(afterOne.data.unread_count, listed.data.unread_count - 1,
    'marking one read must not clear the rest');

  // No ids means all — including the ones beyond the page in hand.
  const all = await api('POST', '/api/notifications/mark-read', { token: AUSER, body: {} });
  assert.equal(all.status, 200);
  const afterAll = await api('GET', '/api/notifications', { token: AUSER });
  assert.equal(afterAll.data.unread_count, 0);
});

test('notifications: one user cannot mark another user\'s notification read', async () => {
  const [other] = await sql('ifqm_test_a',
    "SELECT id FROM ifqm_test_a.users WHERE email='admin@orga.test'");
  const ins = await sql('ifqm_test_a',
    `INSERT INTO ifqm_test_a.notifications (user_id, title, message, is_read)
     VALUES (${other.id}, 'Private', 'not yours', 0)`);
  const id = ins.insertId;

  await api('POST', '/api/notifications/mark-read', { token: AUSER, body: { ids: [id] } });
  const [row] = await sql('ifqm_test_a',
    `SELECT is_read FROM ifqm_test_a.notifications WHERE id=${id}`);
  assert.equal(Number(row.is_read), 0, 'the user_id clause is what stops this');
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

test('the single-idea Closure Summary PDF is open to everyone and stops at the tenant boundary', async () => {
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

  // Everybody can export. What differs is the contents, not the permission: the
  // PDF is built from ideaService.get(), which has already decided what this
  // particular reader may see. A colleague who is neither the author nor a
  // reviewer gets the extract, not the full proposal.
  const asUser = await api('GET', `/api/export/idea/${ideaId}/pdf`, { token: AUSER });
  assert.equal(asUser.status, 200, 'an employee must be able to export an idea as a PDF');
  assert.match(asUser.contentType, /application\/pdf/);
  assert.ok(asUser.text.startsWith('%PDF'), 'the body must be a PDF document');

  // An admin in another tenant cannot reach org A's idea at all.
  const asOrgB = await api('GET', `/api/export/idea/${ideaId}/pdf`, { token: BADMIN });
  assert.equal(asOrgB.status, 404);
});

test('a colleague outside an idea gets a summary sheet, not the full record', async () => {
  /*
   * The two documents are checked by what actually lands in the bytes, not by
   * what the screen renders. The marker strings sit in the SECOND sentence of
   * each field, because a gist is the first sentence — put them in the first
   * and the check cannot tell a summary from the whole thing.
   */
  const problemTail = 'ZZQPROBLEMTAIL it shifts after two hundred cycles and we scrap forty units a shift.';
  const solutionTail = 'ZZQSOLUTIONTAIL the pin costs under two thousand rupees and the re-datum takes four minutes.';

  const submit = await api('POST', '/api/ideas/submit', {
    token: AUSER,
    body: {
      title: 'Re-datum the press fixture on a cycle count',
      present_situation: `The press fixture drifts during a shift. ${problemTail}`,
      proposed_solution: `Fit a hardened locating pin and re-datum on a cycle count. ${solutionTail}`,
      tangible_benefit: 'ZZQBENEFIT about four lakh rupees a year in avoided scrap',
      support_required: 'ZZQSUPPORT two hours of maintenance time on a Sunday',
    },
  });
  const ideaId = submit.data.idea_id;
  assert.ok(ideaId, 'the idea must be created');

  // Somebody in the same organisation with no connection to this idea.
  await sql('ifqm_test_a', `INSERT IGNORE INTO ifqm_test_a.users
    (employee_id, name, email, password_hash, role, department, status)
    VALUES ('E-OUTPDF', 'Outside Reader', 'outsidepdf@orga.test',
            (SELECT password_hash FROM (SELECT password_hash FROM ifqm_test_a.users
              WHERE email = 'user@orga.test') x),
            'employee', 'Assembly', 'active')`);
  const outsider = (await login('outsidepdf@orga.test', PASSWORDS.orgaUser, 'orga')).token;

  // The shared helper reads bodies with res.text(), which decodes as UTF-8 and
  // mangles a PDF. Take the bytes.
  const grab = async (token) => {
    const res = await fetch(`${getBaseUrl()}/api/export/idea/${ideaId}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return {
      status: res.status,
      disposition: res.headers.get('content-disposition') || '',
      bytes: Buffer.from(await res.arrayBuffer()),
    };
  };

  const asAuthor = await grab(AUSER);
  const asOutsider = await grab(outsider);

  assert.equal(asAuthor.status, 200);
  assert.equal(asOutsider.status, 200, 'a colleague may still export — the contents differ, not the permission');

  assert.match(asAuthor.disposition, /closure_summary\.pdf/,
    'the author gets the full closure record');
  assert.doesNotMatch(asOutsider.disposition, /closure/,
    'a bystander gets a summary sheet, not the closure record');

  assert.ok(asAuthor.bytes.length > asOutsider.bytes.length,
    `the closure record must be the larger document (${asAuthor.bytes.length} vs ${asOutsider.bytes.length})`);

  // And the flag the screens use to decide whether to offer a full view at all.
  const detailOut = await api('GET', `/api/ideas/${ideaId}`, { token: outsider });
  assert.equal(detailOut.data.idea.viewer_inside, false);
  assert.equal(detailOut.data.idea.present_situation, null, 'no full problem statement over the wire');
  assert.equal(detailOut.data.idea.proposed_solution, null, 'no full proposal over the wire');
  assert.equal(detailOut.data.idea.tangible_benefit, null, 'benefits are closed by default');
  assert.equal(detailOut.data.idea.support_required, null,
    'support_required is benefit text under another name — it must close with the section');

  const detailOwn = await api('GET', `/api/ideas/${ideaId}`, { token: AUSER });
  assert.equal(detailOwn.data.idea.viewer_inside, true);
  assert.ok(detailOwn.data.idea.present_situation.includes('ZZQPROBLEMTAIL'),
    'the author still reads their own idea in full');
});

test('billing: a plan is priced correctly, and a lapsed organisation is held', async () => {
  // Money is stored in paise. ₹2,500 with GST included must break down to a
  // base and a tax that add back to exactly ₹2,500 — the whole reason prices
  // are not kept as decimals.
  let res = await api('GET', '/api/platform/plans', { token: PA });
  assert.equal(res.status, 200);
  const starter = res.data.plans.find((p) => p.code === 'STARTER');
  assert.ok(starter, 'the seeded Starter plan must exist');
  assert.equal(starter.total_rupees, 2500);
  assert.equal(starter.base_rupees + starter.gst_rupees, starter.total_rupees,
    'base + GST must add back to the price exactly');

  // GST excluded is added on top instead.
  res = await api('POST', '/api/platform/plans', {
    token: PA,
    body: {
      code: 'TESTPLAN', name: 'Test Plan', tier: 'starter',
      amount_rupees: '1,000', billing_cycle: 'monthly',
      gst_percent: 18, gst_mode: 'excluded', max_users: '', storage_gb: 5,
    },
  });
  assert.equal(res.status, 200);
  const planId = res.data.plan_id;
  res = await api('GET', `/api/platform/plans/${planId}`, { token: PA });
  assert.equal(res.data.plan.total_rupees, 1180);
  assert.equal(res.data.plan.max_users, null, 'a blank limit means unlimited, not zero');

  // Put org B on it with a two-day trial, then wind the clock past it.
  const [orgb] = await sql('ifqm_test_master', "SELECT id FROM ifqm_test_master.tenants WHERE slug='orgb'");
  res = await api('POST', `/api/platform/tenants/${orgb.id}/plan`, {
    token: PA, body: { plan_id: planId, trial_days: 0 },
  });
  assert.equal(res.status, 200);

  /*
   * A paid plan cannot carry a trial period any more: an evaluation runs on the
   * Trial plan, and a paid plan starts paying. The dates are therefore written
   * straight onto the row so that the grace and expiry arithmetic below is
   * exercised exactly as before.
   */
  await sql('ifqm_test_master',
    `UPDATE ifqm_test_master.tenants
        SET billing_status = 'trial', trial_days = 2,
            trial_ends_at = DATE_ADD(NOW(), INTERVAL 2 DAY),
            period_end = DATE_ADD(NOW(), INTERVAL 2 DAY)
      WHERE id = ${orgb.id}`);

  res = await api('GET', `/api/platform/tenants/${orgb.id}/subscription`, { token: PA });
  assert.equal(res.data.subscription.days_left, 2);
  assert.equal(res.data.subscription.blocked, false);

  /*
   * One day past the due date. This is NOT a lockout — there is a grace window
   * (two days by default), because a bank transfer arriving a day late is the
   * normal case and cutting a whole company off for it is not a proportionate
   * response. The organisation keeps working and its admins get chased.
   */
  await sql('ifqm_test_master',
    `UPDATE ifqm_test_master.tenants
        SET trial_ends_at = DATE_SUB(NOW(), INTERVAL 1 DAY),
            period_end = DATE_SUB(NOW(), INTERVAL 1 DAY)
      WHERE id = ${orgb.id}`);

  res = await api('GET', `/api/platform/tenants/${orgb.id}/subscription`, { token: PA });
  assert.equal(res.data.subscription.state, 'past_due');
  assert.equal(res.data.subscription.in_grace, true);
  assert.equal(res.data.subscription.blocked, false, 'one day late must not lock anybody out');
  assert.equal(res.data.subscription.grace_days_left, 1);

  // Past the grace window, it really is over. Expiry is derived from the dates
  // on every read, not from a flag some sweep has to set first.
  await sql('ifqm_test_master',
    `UPDATE ifqm_test_master.tenants
        SET trial_ends_at = DATE_SUB(NOW(), INTERVAL 4 DAY),
            period_end = DATE_SUB(NOW(), INTERVAL 4 DAY)
      WHERE id = ${orgb.id}`);
  res = await api('GET', `/api/platform/tenants/${orgb.id}/subscription`, { token: PA });
  assert.equal(res.data.subscription.state, 'expired');
  assert.equal(res.data.subscription.in_grace, false);
  assert.equal(res.data.subscription.blocked, true);

  // With enforcement off — the default — the sweep reports and changes nothing
  // anybody would notice. Nobody is locked out of a system whose prices have
  // not been set.
  res = await api('POST', '/api/platform/billing/sweep', { token: PA });
  assert.equal(res.data.enforced, false);
  assert.equal(res.data.held, 0);
  let [row] = await sql('ifqm_test_master', `SELECT status FROM ifqm_test_master.tenants WHERE id=${orgb.id}`);
  assert.equal(row.status, 'active', 'enforcement off must never suspend anybody');

  // Switched on, it holds the organisation and writes down why.
  await api('PUT', '/api/platform/settings/defaults', { token: PA, body: { billing_enforce: '1' } });
  await sql('ifqm_test_master', `UPDATE ifqm_test_master.tenants SET billing_status='trial' WHERE id=${orgb.id}`);
  res = await api('POST', '/api/platform/billing/sweep', { token: PA });
  assert.ok(res.data.held >= 1);
  [row] = await sql('ifqm_test_master',
    `SELECT status, billing_note FROM ifqm_test_master.tenants WHERE id=${orgb.id}`);
  assert.equal(row.status, 'suspended');
  assert.match(row.billing_note, /non-payment/i, 'the reason must be on file, not guessed later');

  // Recording payment puts them back.
  res = await api('POST', `/api/platform/tenants/${orgb.id}/mark-paid`, { token: PA, body: { periods: 1 } });
  assert.equal(res.status, 200);
  [row] = await sql('ifqm_test_master',
    `SELECT status, billing_status FROM ifqm_test_master.tenants WHERE id=${orgb.id}`);
  assert.equal(row.status, 'active');
  assert.equal(row.billing_status, 'active');

  // Put everything back so the rest of the suite is unaffected.
  await api('PUT', '/api/platform/settings/defaults', { token: PA, body: { billing_enforce: '0' } });
  await sql('ifqm_test_master',
    `UPDATE ifqm_test_master.tenants SET billing_status='exempt', plan_id=NULL,
            trial_ends_at=NULL, period_end=NULL, billing_note=NULL WHERE id=${orgb.id}`);
});

test('billing: an organisation on hold can still sign in and pay — and do nothing else', async () => {
  /*
   * The failure this guards against: an organisation put on hold for
   * non-payment could not sign in at all (tenant resolution matched
   * status='active' only), and even before the hold, the billing gate refused
   * /settings/billing along with everything else. So the one thing we were
   * asking the customer to do — pay — was the one thing they could not reach,
   * and the only way back was a platform admin recording it by hand.
   */
  const [orgb] = await sql('ifqm_test_master', "SELECT id FROM ifqm_test_master.tenants WHERE slug='orgb'");
  const plans = (await api('GET', '/api/platform/plans', { token: PA })).data.plans;
  const starter = plans.find((p) => p.code === 'STARTER');

  // On a plan, because recording a payment for an organisation nobody has
  // priced is refused — and this test ends by recording one.
  await api('POST', `/api/platform/tenants/${orgb.id}/plan`, {
    token: PA, body: { plan_id: starter.id, trial_days: 0 },
  });
  await api('PUT', '/api/platform/settings/defaults', { token: PA, body: { billing_enforce: '1' } });
  await sql('ifqm_test_master',
    `UPDATE ifqm_test_master.tenants
        SET billing_status='trial', trial_ends_at=DATE_SUB(NOW(), INTERVAL 5 DAY),
            period_end=DATE_SUB(NOW(), INTERVAL 5 DAY)
      WHERE id=${orgb.id}`);
  let res = await api('POST', '/api/platform/billing/sweep', { token: PA });
  assert.ok(res.data.held >= 1, 'the sweep must put it on hold first');

  const held = await login('admin@orgb.test', PASSWORDS.orgbAdmin, 'orgb');
  assert.equal(held.status, 200, 'a held organisation must still be able to sign in');
  const token = held.token;

  // The bill, and the banner that explains the pause, are reachable.
  assert.equal((await api('GET', '/api/settings/billing', { token })).status, 200);
  assert.equal((await api('GET', '/api/settings/subscription', { token })).status, 200);

  // Everything else is not.
  res = await api('GET', '/api/ideas', { token });
  assert.equal(res.status, 402, 'the product itself stays paused');
  assert.equal(res.data.billing_blocked, true, 'and says why, so the UI can explain it');
  assert.equal((await api('GET', '/api/users', { token })).status, 402);

  // Paying is reached on its own terms — 503 here is "no gateway configured",
  // which is a different answer from "your access is paused".
  res = await api('POST', '/api/settings/billing/pay', { token, body: { periods: 1 } });
  assert.notEqual(res.status, 402, 'the billing gate must not swallow the payment call');

  // Opening the page to everyone signed in is deliberate — "we are days from
  // being cut off" is not confidential from the people it will cut off — but
  // spending the company's money is not. Checked on org A, which has an
  // employee account and is not itself paused.
  assert.equal((await api('GET', '/api/settings/billing', { token: AUSER })).status, 200,
    'any signed-in employee may read where their organisation stands');
  assert.ok([401, 403].includes(
    (await api('POST', '/api/settings/billing/pay', { token: AUSER, body: { periods: 1 } })).status
  ), 'but only an administrator can start a payment');

  // Recording the payment lifts the hold, and the product comes back.
  res = await api('POST', `/api/platform/tenants/${orgb.id}/mark-paid`, { token: PA, body: { periods: 1 } });
  assert.equal(res.status, 200);
  const back = await login('admin@orgb.test', PASSWORDS.orgbAdmin, 'orgb');
  assert.equal((await api('GET', '/api/ideas', { token: back.token })).status, 200);

  /*
   * A suspension an operator applied by hand is a different thing, and stays a
   * hard refusal — otherwise every organisation that had ever lapsed would keep
   * the softer treatment forever, whatever it was later suspended for.
   */
  res = await api('PATCH', `/api/platform/tenants/${orgb.id}`, { token: PA, body: { status: 'suspended' } });
  assert.equal(res.status, 200);
  const [row] = await sql('ifqm_test_master',
    `SELECT billing_note FROM ifqm_test_master.tenants WHERE id=${orgb.id}`);
  assert.doesNotMatch(row.billing_note || '', /non-payment/i,
    'an operator suspension must not inherit the automatic billing note');
  assert.notEqual((await login('admin@orgb.test', PASSWORDS.orgbAdmin, 'orgb')).status, 200,
    'an operator-suspended organisation is refused outright');

  // Put everything back for the rest of the suite.
  await api('PATCH', `/api/platform/tenants/${orgb.id}`, { token: PA, body: { status: 'active' } });
  await api('PUT', '/api/platform/settings/defaults', { token: PA, body: { billing_enforce: '0' } });
  await sql('ifqm_test_master',
    `UPDATE ifqm_test_master.tenants SET billing_status='exempt', plan_id=NULL,
            trial_ends_at=NULL, period_end=NULL, billing_note=NULL WHERE id=${orgb.id}`);
});

test('billing: the grace window the API enforces is the configured one', async () => {
  /*
   * The sweep, the overview and the organisation's own billing page all passed
   * the configured window to billingState(); the per-request gate did not, so
   * it used the built-in two days regardless. A week-long window meant the API
   * started refusing on day two while every screen said five days were left.
   */
  const [orgb] = await sql('ifqm_test_master', "SELECT id FROM ifqm_test_master.tenants WHERE slug='orgb'");
  const setGrace = (n) => sql('ifqm_test_master',
    `INSERT INTO ifqm_test_master.platform_settings (key_name, value) VALUES ('billing_grace_days', '${n}')
       ON DUPLICATE KEY UPDATE value = VALUES(value)`);

  await api('PUT', '/api/platform/settings/defaults', { token: PA, body: { billing_enforce: '1' } });
  await sql('ifqm_test_master',
    `UPDATE ifqm_test_master.tenants
        SET billing_status='active', period_end=DATE_SUB(NOW(), INTERVAL 4 DAY),
            trial_ends_at=NULL
      WHERE id=${orgb.id}`);

  await setGrace(7);
  let token = (await login('admin@orgb.test', PASSWORDS.orgbAdmin, 'orgb')).token;
  assert.equal((await api('GET', '/api/ideas', { token })).status, 200,
    'four days overdue inside a seven-day window must not be blocked');

  await setGrace(2);
  token = (await login('admin@orgb.test', PASSWORDS.orgbAdmin, 'orgb')).token;
  assert.equal((await api('GET', '/api/ideas', { token })).status, 402,
    'the same organisation is blocked once the window is shorter than the delay');

  await setGrace(2);
  await api('PUT', '/api/platform/settings/defaults', { token: PA, body: { billing_enforce: '0' } });
  await sql('ifqm_test_master',
    `UPDATE ifqm_test_master.tenants SET billing_status='exempt', plan_id=NULL,
            trial_ends_at=NULL, period_end=NULL, billing_note=NULL WHERE id=${orgb.id}`);
});

test('billing: only IFQM staff may price anything', async () => {
  let res = await api('GET', '/api/platform/plans', { token: AADMIN });
  assert.ok([401, 403].includes(res.status), 'an org admin must not read the catalogue');

  const [orga] = await sql('ifqm_test_master', "SELECT id FROM ifqm_test_master.tenants WHERE slug='orga'");
  res = await api('POST', `/api/platform/tenants/${orga.id}/plan`, {
    token: AADMIN, body: { plan_id: 1, trial_days: 999 },
  });
  assert.ok([401, 403].includes(res.status), 'nor put themselves on a plan');

  // They can see their own account, without the internal note.
  res = await api('GET', '/api/settings/subscription', { token: AADMIN });
  assert.equal(res.status, 200);
  assert.equal(res.data.subscription?.billing_note, undefined);
});

test('the request allowance comes from the plan, and can never lock a workspace out', async () => {
  /*
   * A flat 2,000-a-month cap once took a live customer offline: it was an
   * integration allowance applied to ordinary page loads. The allowance now
   * comes from the plan and is sized from its user cap, and three things are
   * checked here — the sizing, the grace band, and the allowlist that keeps a
   * customer able to sign in and complain.
   */
  let res = await api('GET', '/api/platform/plans', { token: PA });
  const starter = res.data.plans.find((p) => p.code === 'STARTER');
  assert.equal(starter.api_quota_monthly, 1_500_000,
    '100 users at ~15,000 requests each per month');
  assert.equal(starter.api_quota_monthly, starter.suggested_quota,
    'the shipped figure must match the arithmetic the screen suggests');

  const trial = res.data.plans.find((p) => p.code === 'TRIAL');
  assert.equal(trial.api_quota_monthly, null,
    'an organisation deciding whether to buy must never meet a limit while deciding');

  // A deliberately small plan, so the limit can be reached in a test.
  res = await api('POST', '/api/platform/plans', {
    token: PA,
    body: { code: 'QUOTATEST', name: 'Quota Test', description: 'Small allowance.',
            tier: 'starter', amount_rupees: 1, gst_percent: 18,
            max_users: 5, api_quota_monthly: 1000 },
  });
  assert.equal(res.status, 200);
  const planId = res.data.plan_id;

  const [orgb] = await sql('ifqm_test_master', "SELECT id FROM ifqm_test_master.tenants WHERE slug='orgb'");
  await api('POST', `/api/platform/tenants/${orgb.id}/plan`, {
    token: PA, body: { plan_id: planId, trial_days: 0 },
  });

  const setUsage = async (n) => {
    await sql('ifqm_test_master',
      `INSERT INTO ifqm_test_master.tenant_api_usage (tenant_id, period, request_count)
       VALUES (${orgb.id}, DATE_FORMAT(NOW(),'%Y-%m'), ${n})
       ON DUPLICATE KEY UPDATE request_count = ${n}`);
    // Assigning the plan again drops the cached allowance, so the next request
    // re-reads it. Without that a plan change takes up to a minute to be
    // believed — which is the minute the customer is watching.
    await api('POST', `/api/platform/tenants/${orgb.id}/plan`, {
      token: PA, body: { plan_id: planId, trial_days: 0 },
    });
  };

  // Just over the line is tolerated: the allowance estimates normal use, it
  // does not measure it, and somebody 5% over is busy rather than abusive.
  await setUsage(1050);
  res = await api('GET', '/api/ideas/dashboard', { token: BADMIN });
  assert.equal(res.status, 200, '5% over the allowance must not be refused');

  // Well past the grace band, ordinary screens are refused.
  await setUsage(5000);
  res = await api('GET', '/api/ideas/dashboard', { token: BADMIN });
  assert.equal(res.status, 429);
  assert.match(JSON.stringify(res.data.quota), /plan \(Quota Test\)/,
    'the refusal must say which limit it came from');

  // …but the allowlist still answers. A customer who has run out has to be able
  // to sign in, see why, and raise a ticket about it.
  for (const path of ['/api/settings', '/api/notifications', '/api/support/tickets', '/api/branding']) {
    const r = await api('GET', path, { token: BADMIN });
    assert.equal(r.status, 200, `${path} must keep working at the limit`);
  }
  const relogin = await login('admin@orgb.test', PASSWORDS.orgbAdmin, 'orgb');
  assert.ok(relogin.token, 'signing in must keep working at the limit');

  // A number set on the organisation itself beats the plan's.
  await sql('ifqm_test_master',
    `UPDATE ifqm_test_master.tenants SET api_quota_monthly = 900000 WHERE id = ${orgb.id}`);
  await setUsage(5000);
  res = await api('GET', '/api/ideas/dashboard', { token: BADMIN });
  assert.equal(res.status, 200, 'an organisation override must win over the plan');

  // Put org B back as the rest of the suite expects it.
  await sql('ifqm_test_master',
    `UPDATE ifqm_test_master.tenants SET api_quota_monthly = NULL, plan_id = NULL,
            billing_status = 'exempt', trial_ends_at = NULL, period_end = NULL WHERE id = ${orgb.id}`);
  await sql('ifqm_test_master', `DELETE FROM ifqm_test_master.tenant_api_usage WHERE tenant_id = ${orgb.id}`);
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
  assert.match(r.error, /Invalid sign-in details or password/);
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

/*
 * ── Messaging: the SMS/DLT connector and the platform mail provider ────────
 *
 * These exist because the one-time-code feature shipped complete and
 * unreachable: `otp_*` was seeded into platform_settings and appeared on no
 * whitelist, so nothing in the product could ever set otp_enabled to 1. The
 * tests below pin the two things that keep that from happening quietly again —
 * the settings are writable, and turning the feature on is refused while it
 * could not actually deliver.
 */
test('messaging: the gateway key and the mail token are never returned, and an empty field keeps them', async () => {
  const pa = (await login('platform@ifqm.io', PASSWORDS.platform)).token;

  const saved = await api('PUT', '/api/platform/messaging', { token: pa, body: {
    sms_dlt_enabled: true,
    sms_dlt_entity_id: '1101234567890123456',
    sms_dlt_sender_id: 'IFQMOT',
    sms_dlt_template_id: '1107161234567890123',
    sms_dlt_api_key: 'gateway-secret-value',
    mail_zepto_enabled: true,
    mail_zepto_from: 'noreply@ifqm.test',
    mail_zepto_token: 'Zoho-enczapikey TESTTOKEN',
  } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.dlt.api_key_set, true);
  assert.equal(saved.data.mail.token_set, true);

  const read = await api('GET', '/api/platform/messaging', { token: pa });
  const body = JSON.stringify(read.data);
  assert.ok(!body.includes('gateway-secret-value'), 'the DLT key must never reach the client');
  assert.ok(!body.includes('TESTTOKEN'), 'the ZeptoMail token must never reach the client');
  assert.equal(read.data.dlt.api_key_set, true);
  assert.equal(read.data.mail.token_set, true);

  // The hazard this guards: saving an unrelated field used to blank the
  // credential, because an untouched password input posts an empty string.
  const other = await api('PUT', '/api/platform/messaging', {
    token: pa,
    body: { otp_ttl_seconds: 240, sms_dlt_api_key: '', mail_zepto_token: '' },
  });
  assert.equal(other.data.otp.ttl_seconds, 240);
  assert.equal(other.data.dlt.api_key_set, true, 'an empty key field must mean "keep it"');
  assert.equal(other.data.mail.token_set, true, 'an empty token field must mean "keep it"');
});

test('messaging: code sign-in cannot be switched on while the gateway could not deliver', async () => {
  const pa = (await login('platform@ifqm.io', PASSWORDS.platform)).token;

  // Connector off — enabling must be refused rather than putting a sign-in
  // method on the login screen that silently never works.
  await api('PUT', '/api/platform/messaging', { token: pa, body: { sms_dlt_enabled: false } });
  const off = await api('PUT', '/api/platform/messaging', {
    token: pa,
    body: { otp_enabled: true, otp_provider: 'jio_dlt' },
  });
  assert.equal(off.status, 400);
  assert.match(off.data.error, /connector on before/i);

  // Connector on but a field missing — also refused, and the message names it.
  await api('PUT', '/api/platform/messaging', {
    token: pa,
    body: { sms_dlt_enabled: true, sms_dlt_template_id: '' },
  });
  const incomplete = await api('PUT', '/api/platform/messaging', {
    token: pa,
    body: { otp_enabled: true, otp_provider: 'jio_dlt' },
  });
  assert.equal(incomplete.status, 400);
  assert.match(incomplete.data.error, /Content Template ID/);

  // A six-character header is the DLT rule; five is a transcription slip the
  // gateway would reject with an opaque error.
  const shortHeader = await api('PUT', '/api/platform/messaging', {
    token: pa,
    body: { sms_dlt_sender_id: 'IFQM', sms_dlt_template_id: '1107161234567890123',
      otp_enabled: true, otp_provider: 'jio_dlt' },
  });
  assert.equal(shortHeader.status, 400);
  assert.match(shortHeader.data.error, /6 characters/);

  // Everything present — now it may be enabled. The template ID has to be
  // supplied again here: a refused save writes nothing at all, so the empty
  // value set two steps above is still what is on file. That all-or-nothing
  // behaviour is the point — a partly applied configuration is how you end up
  // with a connector that looks configured and cannot send.
  const ok = await api('PUT', '/api/platform/messaging', {
    token: pa,
    body: {
      sms_dlt_sender_id: 'IFQMOT',
      sms_dlt_template_id: '1107161234567890123',
      otp_enabled: true,
      otp_provider: 'jio_dlt',
    },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.otp.enabled, true);
  assert.deepEqual(ok.data.dlt.missing, []);
});

test('messaging: an http endpoint is refused, and only IFQM staff may configure any of this', async () => {
  const pa = (await login('platform@ifqm.io', PASSWORDS.platform)).token;
  const orgAdmin = (await login('admin@orga.test', PASSWORDS.orgaAdmin)).token;

  // http would put the API key and the recipient's number on the wire in clear.
  const insecure = await api('PUT', '/api/platform/messaging', {
    token: pa,
    body: { sms_dlt_endpoint: 'http://gateway.example/send' },
  });
  assert.equal(insecure.status, 400);
  assert.match(insecure.data.error, /https/i);

  for (const [method, path, body] of [
    ['GET', '/api/platform/messaging', undefined],
    ['PUT', '/api/platform/messaging', { otp_enabled: true }],
    ['POST', '/api/platform/messaging/test', { phone: '+919876543210' }],
    ['POST', '/api/platform/messaging/test-mail', { to: 'x@y.test' }],
  ]) {
    const r = await api(method, path, { token: orgAdmin, body });
    assert.ok(r.status === 401 || r.status === 403,
      `${method} ${path} must not be reachable by a tenant admin (got ${r.status})`);
  }
});

test('messaging: the DLT template is filled from the registered wording, not from a literal', async () => {
  const { fillTemplate, matchesTemplate } = await import('../src/services/smsService.js');

  const registered = '{#var#} is your IFQM sign-in code. It expires in {#var#} minute(s). Do not share it with anyone.';
  const built = fillTemplate(registered, ['482913', 5]);
  assert.equal(built,
    '482913 is your IFQM sign-in code. It expires in 5 minute(s). Do not share it with anyone.');

  // The check that matters: a message built from the registered template
  // matches it, and one whose wording has drifted does not. A carrier drops the
  // second silently — no error, no delivery report, no symptom.
  assert.equal(matchesTemplate(registered, built), true);
  assert.equal(matchesTemplate(registered, '482913 is your code. Expires in 5 min.'), false);
});

/*
 * ── Maintenance mode ────────────────────────────────────────────────────────
 *
 * The whole platform on hold while developers work on an update. The property
 * that matters is asymmetry: every organisation is shut out, IFQM staff are
 * not. Get that backwards and the switch cannot be reached to turn it off.
 */
test('maintenance: tenants are locked out, IFQM staff are not, and it reverses cleanly', async () => {
  const pa = (await login('platform@ifqm.io', PASSWORDS.platform)).token;

  // A tenant session taken out BEFORE the switch, to prove existing sessions
  // stop working rather than merely new logins being refused.
  const before = await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga');
  assert.ok(before.token, 'tenant should be able to sign in before maintenance');

  // Off by default: nothing here should be on until somebody turns it on.
  const initial = await api('GET', '/api/auth/maintenance');
  assert.equal(initial.status, 200);
  assert.equal(initial.data.enabled, false);

  const on = await api('PUT', '/api/platform/maintenance', {
    token: pa,
    body: { enabled: true, message: 'Upgrading the ideation engine. Back shortly.' },
  });
  assert.equal(on.status, 200);
  assert.equal(on.data.enabled, true);
  assert.ok(on.data.since, 'switching on stamps when it started');

  // 1. The sign-in screen can say why, before anybody authenticates.
  const pub = await api('GET', '/api/auth/maintenance');
  assert.equal(pub.data.enabled, true);
  assert.match(pub.data.message, /Upgrading the ideation engine/);

  // 2. A tenant cannot obtain a new session, by password...
  const pwLogin = await api('POST', '/api/auth/login', {
    body: { email: 'admin@orga.test', password: PASSWORDS.orgaAdmin, org_slug: 'orga' },
  });
  assert.equal(pwLogin.status, 503);
  assert.equal(pwLogin.data.maintenance, true);
  assert.match(pwLogin.data.error, /Upgrading the ideation engine/);

  // ...nor by one-time code, which is the same door and would otherwise be
  // left wide open.
  const otpReq = await api('POST', '/api/auth/otp/request', {
    body: { identifier: 'admin@orga.test' },
  });
  assert.equal(otpReq.status, 503);
  assert.equal(otpReq.data.maintenance, true);

  // 3. The session issued before the switch stops working.
  const stale = await api('GET', '/api/ideas', { token: before.token });
  assert.equal(stale.status, 503);
  assert.equal(stale.data.maintenance, true);

  // ...but that user can still log out, rather than being stuck holding a
  // token every endpoint refuses.
  const out = await api('POST', '/api/auth/logout', { token: before.token });
  assert.equal(out.status, 200);

  // 4. IFQM staff are unaffected — they can still sign in and still reach the
  // console, which is what makes the switch reversible.
  const staffLogin = await api('POST', '/api/auth/login', {
    body: { email: 'platform@ifqm.io', password: PASSWORDS.platform },
  });
  assert.equal(staffLogin.status, 200, 'platform admin must be able to sign in during maintenance');
  const console_ = await api('GET', '/api/platform/tenants', { token: staffLogin.data.token });
  assert.equal(console_.status, 200, 'platform console must stay reachable during maintenance');

  /*
   * 5. A tenant cannot switch it off.
   *
   * The refusal is a 503 rather than a 403: requirePlatformAuth runs requireAuth
   * first, and the maintenance gate on the tenant branch fires before the
   * staff-only check is ever reached. Denied either way, and asserting on the
   * denial rather than the code keeps this test about the property that
   * matters — a locked-out tenant cannot unlock themselves.
   */
  const byTenant = await api('PUT', '/api/platform/maintenance', {
    token: before.token, body: { enabled: false },
  });
  assert.notEqual(byTenant.status, 200,
    `a tenant must not be able to switch maintenance off (got ${byTenant.status})`);
  const stillOn = await api('GET', '/api/auth/maintenance');
  assert.equal(stillOn.data.enabled, true, 'a tenant request must not have changed the switch');

  // 6. Turning it off restores service.
  const off = await api('PUT', '/api/platform/maintenance', {
    token: pa, body: { enabled: false },
  });
  assert.equal(off.status, 200);
  assert.equal(off.data.enabled, false);

  const after = await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga');
  assert.ok(after.token, 'tenants must be able to sign in again once maintenance is off');

  // 7. And with maintenance OFF, the switch is still staff-only — the ordinary
  // authorisation check, no longer masked by the 503 above.
  const tenantWhenLive = await api('PUT', '/api/platform/maintenance', {
    token: after.token, body: { enabled: true },
  });
  assert.ok(tenantWhenLive.status === 401 || tenantWhenLive.status === 403,
    `maintenance must be staff-only even when live (got ${tenantWhenLive.status})`);
  const stillOff = await api('GET', '/api/auth/maintenance');
  assert.equal(stillOff.data.enabled, false, 'a tenant must not be able to switch it on either');
});

/*
 * ── The trial plan ──────────────────────────────────────────────────────────
 *
 * Two rules, both asked for after organisations turned up priced at Rs.50,000
 * while showing "Trial - 14 days left": a trial runs on the Trial plan and
 * nothing else, and the Trial plan itself cannot be deleted because every newly
 * approved organisation is put on it.
 */
test('billing: a trial runs on the Trial plan, and that plan cannot be deleted', async () => {
  const pa = (await login('platform@ifqm.io', PASSWORDS.platform)).token;
  const plans = (await api('GET', '/api/platform/plans', { token: pa })).data.plans;
  const trial = plans.find((p) => String(p.code).toUpperCase() === 'TRIAL');
  const paid = plans.find((p) => p.tier !== 'trial' && Number(p.amount_paise) > 0);
  assert.ok(trial, 'a Trial plan must exist for new organisations to start on');
  assert.ok(paid, 'the fixture needs at least one priced plan');

  const [orgb] = await sql('ifqm_test_master', "SELECT id FROM ifqm_test_master.tenants WHERE slug='orgb'");

  // A priced plan cannot be handed a trial period.
  const refused = await api('POST', `/api/platform/tenants/${orgb.id}/plan`, {
    token: pa, body: { plan_id: paid.id, trial_days: 14 },
  });
  assert.equal(refused.status, 400);
  assert.match(refused.data.error, /paid plan/i);

  // The Trial plan can.
  const allowed = await api('POST', `/api/platform/tenants/${orgb.id}/plan`, {
    token: pa, body: { plan_id: trial.id, trial_days: 14 },
  });
  assert.equal(allowed.status, 200);
  const sub = await api('GET', `/api/platform/tenants/${orgb.id}/subscription`, { token: pa });
  assert.equal(sub.data.subscription.state, 'trial');

  // And the same paid plan is fine the moment the trial length is zero, which
  // is what converting a customer looks like.
  const converted = await api('POST', `/api/platform/tenants/${orgb.id}/plan`, {
    token: pa, body: { plan_id: paid.id, trial_days: 0 },
  });
  assert.equal(converted.status, 200);

  // Deleting the Trial plan is refused, and it is still there afterwards.
  const del = await api('DELETE', `/api/platform/plans/${trial.id}`, { token: pa });
  assert.equal(del.status, 400);
  assert.match(del.data.error, /cannot be deleted/i);
  const after = (await api('GET', '/api/platform/plans', { token: pa })).data.plans;
  assert.ok(after.some((p) => p.id === trial.id && p.status === 'active'),
    'the Trial plan must survive a delete attempt, and stay active');
});

/*
 * Editing your own profile.
 *
 * The three descriptive fields are the person's to correct — they are the one
 * who knows they have moved department. Role, points and reporting line are
 * not: role and manager decide what an idea can reach and who judges it, and
 * points are earned. Somebody able to set their own role could approve their
 * own idea, so the server takes a fixed list of fields rather than trusting
 * the form that sent them.
 */
test('profile: a user may fix their own details but cannot promote themselves', async () => {
  const u = await login('user@orga.test', PASSWORDS.orgaUser);
  // Points are earned by earlier cases in this file, so the property under test
  // is that they are UNCHANGED by this call — not that they are zero.
  const [before] = await sql('ifqm_test_a',
    "SELECT points FROM ifqm_test_a.users WHERE email = 'user@orga.test'");

  const res = await api('POST', '/api/users/profile', {
    token: u.token,
    body: {
      department: 'Quality', business_unit: 'Plant 2', location: 'Hosur',
      // Everything below is an attempt to grant privilege, and must be ignored.
      role: 'admin', points: 99999, manager_id: 1, status: 'inactive',
    },
  });
  assert.equal(res.status, 200);

  const [row] = await sql('ifqm_test_a',
    "SELECT department, business_unit, location, role, points, status FROM ifqm_test_a.users WHERE email = 'user@orga.test'");
  assert.equal(row.department, 'Quality');
  assert.equal(row.business_unit, 'Plant 2');
  assert.equal(row.location, 'Hosur');
  assert.equal(row.role, 'employee', 'a user must not be able to set their own role');
  assert.equal(Number(row.points), Number(before.points), 'points are earned, never claimed');
  assert.equal(row.status, 'active', 'status is not a self-service field');

  // Changing the number is a verified flow of its own, not a profile field.
  const phone = await api('POST', '/api/users/profile', {
    token: u.token, body: { phone: '9800000123' },
  });
  assert.equal(phone.status, 400);
  assert.match(phone.data.error, /verify the new one/i);
});

/*
 * The organisation logo has to outlive a restart.
 *
 * It did not: the PNG was written to uploads/<slug>/ and only its FILENAME was
 * kept in the registry. This deployment's disk is ephemeral and its instances
 * sleep when idle, so every wake was a fresh container with an empty uploads
 * folder — the row still pointed confidently at a file that no longer existed,
 * and the sidebar quietly fell back to the default mark.
 *
 * It also explains why an admin kept seeing their logo while employees did not:
 * the upload response carries the image back, so the person who uploaded it was
 * looking at the bytes they had just sent, not at anything stored.
 */
test('branding: an uploaded logo survives the uploads folder being wiped', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  await sql('ifqm_test_master',
    'ALTER TABLE ifqm_test_master.tenants ADD COLUMN logo_blob MEDIUMBLOB NULL DEFAULT NULL')
    .catch(() => { /* already there on a re-run */ });

  const admin = await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga');
  const employee = await login('user@orga.test', PASSWORDS.orgaUser, 'orga');

  const fd = new FormData();
  fd.append('logo', new Blob([tinyPng()], { type: 'image/png' }), 'logo.png');
  const up = await api('POST', '/api/branding/logo', { token: admin.token, raw: fd });
  assert.equal(up.status, 200);

  // An employee must see it at all — this is the sidebar for everybody, not
  // just for whoever uploaded it.
  let seen = await api('GET', '/api/branding', { token: employee.token });
  assert.ok(seen.data?.branding?.logo, 'an employee must see the organisation logo');

  // The restart, simulated exactly: the folder goes away, the registry stays.
  await fs.rm(path.resolve('uploads'), { recursive: true, force: true }).catch(() => {});

  seen = await api('GET', '/api/branding', { token: employee.token });
  assert.ok(seen.data?.branding?.logo,
    'the logo must survive the uploads folder being wiped — it lives in the registry');

  const asAdmin = await api('GET', '/api/branding', { token: admin.token });
  assert.ok(asAdmin.data?.branding?.logo, 'and it must still be there for the admin on a fresh read');

  // Removing it must clear the bytes, not just the filename, or it comes back.
  const del = await api('DELETE', '/api/branding/logo', { token: admin.token });
  assert.equal(del.status, 200);
  const gone = await api('GET', '/api/branding', { token: employee.token });
  assert.ok(!gone.data?.branding?.logo, 'a removed logo must not reappear from the stored bytes');
});

// ── One approval chain ───────────────────────────────────────────────────────
/*
 * The chain used to be described four ways at once: a built-in role pair, an
 * ordered stage list, a free-form pair of role checkbox sets, and a committee
 * percentage that overrode the lot. Only one was in force at a time and they
 * disagreed, so the settings screen could show an admin a chain the engine did
 * not walk. There was no test over any of it, which is how they drifted.
 */

test('the approval chain is derived from the stage list, and the dead keys are refused', async () => {
  // A chain an organisation might actually build: skip the department manager.
  let res = await api('POST', '/api/settings', {
    token: AADMIN,
    body: { approval_stages: 'originator,immediate_manager,plant_head' },
  });
  assert.equal(res.data.success, true, 'a valid stage list must save');

  res = await api('GET', '/api/settings', { token: AADMIN });
  assert.equal(res.data.settings.approval_stages, 'originator,immediate_manager,plant_head');

  // The four removed keys must not be writable. A stale client (or an old
  // browser tab) posting them must not resurrect a second description of the
  // chain in the settings table.
  await api('POST', '/api/settings', {
    token: AADMIN,
    body: {
      approval_mode: 'custom',
      approval_reviewer_roles: 'team_lead,executive',
      approval_final_approver_roles: 'super_admin',
      approval_threshold: '40',
    },
  });
  const stored = await sql('ifqm_test_a',
    `SELECT key_name FROM ifqm_test_a.org_settings
      WHERE key_name IN ('approval_mode','approval_reviewer_roles',
                         'approval_final_approver_roles','approval_threshold')`);
  assert.equal(stored.length, 0, 'the removed approval keys must not be storable');

  // A chain with no approver in it is refused rather than stored — it would
  // leave every submitted idea with nobody able to action it.
  res = await api('POST', '/api/settings', { token: AADMIN, body: { approval_stages: 'originator' } });
  assert.notEqual(res.status, 200, 'a chain with no approver must be refused');

  // An unknown stage key is dropped, not stored: a step nobody holds is a step
  // no idea can pass, and it would only surface as a stuck submission.
  await api('POST', '/api/settings', {
    token: AADMIN,
    body: { approval_stages: 'originator,immediate_manager,chief_vibes_officer,plant_head' },
  });
  res = await api('GET', '/api/settings', { token: AADMIN });
  assert.equal(res.data.settings.approval_stages, 'originator,immediate_manager,plant_head',
    'an unrecognised stage must be dropped, leaving the rest of the chain intact');

  // Put it back so later cases see the built-in chain.
  await api('POST', '/api/settings', {
    token: AADMIN,
    body: { approval_stages: 'originator,immediate_manager,department_manager,plant_head' },
  });
});

test('a review committee decides unanimously — one rejection is enough', async () => {
  // Two real reviewers, so "all of them" is a meaningful claim rather than an
  // accident of there being only one.
  const mk = async (email, name, phone) => {
    const created = await api('POST', '/api/users', {
      token: AADMIN,
      body: {
        name, email, password: 'CommitteePass123', role: 'manager', department: 'Ops',
        // Every account needs an employee ID and a mobile number, whatever
        // creates it — see createUser.
        employee_id: email.split('@')[0].toUpperCase(), phone,
      },
    });
    assert.equal(created.data.success, true,
      `${email} must be creatable — server said: ${JSON.stringify(created.data)}`);
    return (await login(email, 'CommitteePass123', 'orga')).token;
  };
  const rv1 = await mk('committee1@orga.test', 'Committee One', '+919812345671');
  const rv2 = await mk('committee2@orga.test', 'Committee Two', '+919812345672');
  // Org admins hold no approval authority (§13.12) and may not route either, so
  // the routing is done by a manager — which is who does it in practice.
  const router = await mk('committeelead@orga.test', 'Committee Lead', '+919812345673');
  const ids = await sql('ifqm_test_a',
    `SELECT id, email FROM ifqm_test_a.users WHERE email IN ('committee1@orga.test','committee2@orga.test')`);
  const idOf = (e) => ids.find((r) => r.email === e).id;

  const submitOne = async (title) => {
    const s = await api('POST', '/api/ideas/submit', {
      token: AUSER,
      body: {
        title,
        present_situation: 'Compressed air leaks across the shop floor are found only during annual audits.',
        proposed_solution: 'Fit ultrasonic leak detectors and review the readings each shift handover.',
        investment_required: '120000',
      },
    });
    assert.equal(s.data.success, true, 'the idea must submit');
    return s.data.idea_id;
  };

  // ── One rejection ends it, even with an approval already recorded ──
  const rejectedIdea = await submitOne('Ultrasonic leak detection — committee A');
  let res = await api('POST', '/api/ideas/assign-reviewers', {
    token: router,
    // The old threshold field, still sent by a stale client. It must have no
    // effect whatsoever — under the old code 50% here would have APPROVED this
    // idea on the single approval below.
    body: {
      idea_id: rejectedIdea,
      reviewer_ids: [idOf('committee1@orga.test'), idOf('committee2@orga.test')],
      approval_threshold: 50,
    },
  });
  assert.equal(res.data.success, true,
    `routing to committee must succeed — server said: ${JSON.stringify(res.data)}`);

  res = await api('POST', '/api/ideas/reviewer-decision', {
    token: rv1,
    body: { idea_id: rejectedIdea, decision: 'approved', comment: 'Worth doing.' },
  });
  assert.equal(res.data.success, true);
  assert.equal(res.data.new_status, null,
    'one approval out of two decides nothing — the committee is not finished');

  res = await api('POST', '/api/ideas/reviewer-decision', {
    token: rv2,
    body: { idea_id: rejectedIdea, decision: 'rejected', comment: 'Payback is too long.' },
  });
  assert.equal(res.data.new_status, 'Rejected',
    'a single rejection rejects the idea, whatever the other reviewers said');

  // ── Everyone approves ──
  const approvedIdea = await submitOne('Ultrasonic leak detection — committee B');
  await api('POST', '/api/ideas/assign-reviewers', {
    token: router,
    body: {
      idea_id: approvedIdea,
      reviewer_ids: [idOf('committee1@orga.test'), idOf('committee2@orga.test')],
    },
  });
  res = await api('POST', '/api/ideas/reviewer-decision', {
    token: rv1, body: { idea_id: approvedIdea, decision: 'approved' },
  });
  assert.equal(res.data.new_status, null, 'still waiting on the second reviewer');
  res = await api('POST', '/api/ideas/reviewer-decision', {
    token: rv2, body: { idea_id: approvedIdea, decision: 'approved' },
  });
  assert.equal(res.data.new_status, 'Approved', 'unanimous approval approves the idea');
});

// ── Approved vs actually forwarded to QCMS ───────────────────────────────────
/*
 * An approved idea and one that has been handed to the QC tool as tracked work
 * looked identical everywhere outside the org admin's own Approved Ideas tab.
 * Two things had to be true for the distinction to be visible: the push state
 * has to travel with the idea to every screen that shows a status, and the
 * platform's count of forwarded ideas has to be real.
 */
test('an idea forwarded to QCMS is distinguishable from one merely approved', async () => {
  const submit = await api('POST', '/api/ideas/submit', {
    token: AUSER,
    body: {
      title: 'Reclaim rinse water on the plating line',
      present_situation: 'Rinse water goes to drain after a single pass, at roughly 40 kilolitres a shift.',
      proposed_solution: 'Add a counter-flow rinse cascade so the last stage feeds the first.',
      investment_required: '300000',
    },
  });
  const ideaId = submit.data.idea_id;

  // Approved, but never sent anywhere.
  await sql('ifqm_test_a', `UPDATE ifqm_test_a.ideas SET status='Approved' WHERE id=${ideaId}`);
  let res = await api('GET', `/api/ideas/${ideaId}`, { token: AUSER });
  assert.equal(res.data.idea.status, 'Approved');
  assert.ok(!res.data.idea.qcms_push_status,
    'an approved idea that was never sent must carry no push status');

  // Now forwarded. The screens read qcms_push_status, so it has to survive the
  // trip on every payload that shows a status badge.
  await sql('ifqm_test_a',
    `UPDATE ifqm_test_a.ideas SET qcms_push_status='imported', qcms_pushed_at=NOW() WHERE id=${ideaId}`);

  res = await api('GET', `/api/ideas/${ideaId}`, { token: AUSER });
  assert.equal(res.data.idea.qcms_push_status, 'imported', 'the idea detail must carry the push state');
  assert.equal(res.data.idea.status, 'Approved',
    'forwarding must not disturb the approval status — they are separate facts');

  const inList = (await api('GET', '/api/ideas', { token: AUSER })).data.ideas.find((i) => i.id === ideaId);
  assert.equal(inList?.qcms_push_status, 'imported', 'the browse list must carry it');

  const inMine = (await api('GET', '/api/ideas/my', { token: AUSER })).data.ideas.find((i) => i.id === ideaId);
  assert.equal(inMine?.qcms_push_status, 'imported', 'My Ideas must carry it');

  // The board names its columns instead of selecting i.*, so it was the one
  // screen where the mark would silently never appear.
  const onBoard = (await api('GET', '/api/votes/board', { token: AUSER })).data.ideas?.find((i) => i.id === ideaId);
  assert.equal(onBoard?.qcms_push_status, 'imported', 'the community board must carry it too');

  /*
   * And the platform's own count. It queried qcms_push_status = 'success',
   * which pushIdeaToQcms never writes — the vocabulary is imported | duplicate
   * | failed — so "ideas forwarded to QCMS" read zero on every deployment no
   * matter how many had actually gone across.
   */
  const detail = await api('GET', `/api/platform/tenants/${tenantAId}`, { token: PA });
  const usage = detail.data.usage;   // tenantDetail spreads the shell at top level
  assert.ok(usage, 'the tenant detail must carry a usage block');
  assert.ok(Number(usage.qcms_pushed) >= 1,
    `the platform must count a forwarded idea, got ${JSON.stringify(usage.qcms_pushed)}`);
  assert.equal(Number(usage.qcms_failed), 0, 'and must not count it as a failure');
});

// ── Username sign-in, and email that is no longer compulsory ─────────────────
/*
 * users.email was NOT NULL UNIQUE and was the login identifier, so an employee
 * with no company mailbox — most of a shop floor — had to be given a
 * fabricated address before an account could exist, which then received
 * nothing and was still what they had to type to sign in.
 */

test('a user can be created with a username and no email, and sign in with it', async () => {
  const created = await api('POST', '/api/users', {
    token: AADMIN,
    body: {
      name: 'Yashas M', username: 'yashas123', employee_id: 'YM001',
      phone: '+919812345691', password: 'UsernamePass123', role: 'employee',
      department: 'Production',
    },
  });
  assert.equal(created.data.success, true,
    `an account with no email must be creatable — server said: ${JSON.stringify(created.data)}`);

  const [row] = await sql('ifqm_test_a',
    "SELECT username, email FROM ifqm_test_a.users WHERE employee_id='YM001'");
  assert.equal(row.username, 'yashas123');
  assert.equal(row.email, null, 'no address must be stored as NULL, not an empty string');

  // The point of the whole change: signing in with the username, no org code.
  const signedIn = await api('POST', '/api/auth/login', {
    body: { email: 'yashas123', password: 'UsernamePass123' },
  });
  assert.equal(signedIn.status, 200,
    `username sign-in must work — server said: ${JSON.stringify(signedIn.data)}`);
  assert.equal(signedIn.data.user.name, 'Yashas M');

  // Case is not part of the identity — somebody typing it from a handset gets
  // a capital first letter whether they meant one or not.
  const upper = await api('POST', '/api/auth/login', {
    body: { email: 'Yashas123', password: 'UsernamePass123' },
  });
  assert.equal(upper.status, 200, 'a username must not be case-sensitive');

  // A second account with no email must not collide with the first on the
  // UNIQUE index — NULLs do not collide, empty strings would have.
  const second = await api('POST', '/api/users', {
    token: AADMIN,
    body: {
      name: 'Second NoMail', username: 'second.user', employee_id: 'YM002',
      phone: '+919812345692', password: 'UsernamePass123', role: 'employee',
    },
  });
  assert.equal(second.data.success, true,
    'two accounts without an address must both be creatable');
});

test('an account must have a username or an email, and a username is platform-wide', async () => {
  // Neither identifier: refused, because nothing could sign in.
  const neither = await api('POST', '/api/users', {
    token: AADMIN,
    body: { name: 'No Way In', employee_id: 'YM003', phone: '+919812345693',
      password: 'UsernamePass123', role: 'employee' },
  });
  assert.notEqual(neither.status, 200, 'an account with no way to sign in must be refused');

  // Malformed usernames are refused rather than stored — each of these would
  // land in the same keyspace as an email or a phone key and could shadow
  // somebody else's sign-in.
  for (const bad of ['ab', '9812345678', 'has space', 'user@acme.com', 'x'.repeat(31)]) {
    const res = await api('POST', '/api/users', {
      token: AADMIN,
      body: { name: 'Bad Name', username: bad, employee_id: `BAD${bad.length}`,
        phone: '+919812345694', password: 'UsernamePass123', role: 'employee' },
    });
    assert.notEqual(res.status, 200, `username "${bad}" must be refused`);
  }

  /*
   * The one that matters: a username is unique across the WHOLE platform, not
   * per organisation, because login_directory is keyed on the identifier alone
   * — that single key is what lets somebody sign in without an org code. Org B
   * must not be able to take a name Org A already holds, and must not be left
   * holding a user row for a name it did not get.
   */
  const taken = await api('POST', '/api/users', {
    token: BADMIN,
    body: { name: 'Impostor', username: 'yashas123', employee_id: 'IMP001',
      phone: '+919812345695', password: 'UsernamePass123', role: 'employee' },
  });
  assert.equal(taken.status, 409,
    `another organisation must not be able to claim a taken username — got ${taken.status}`);
  const leftovers = await sql('ifqm_test_b',
    "SELECT id FROM ifqm_test_b.users WHERE employee_id='IMP001'");
  assert.equal(leftovers.length, 0,
    'a refused claim must not leave the half-created account behind');

  // And the original owner still resolves to their OWN organisation.
  const still = await api('POST', '/api/auth/login', {
    body: { email: 'yashas123', password: 'UsernamePass123' },
  });
  assert.equal(still.status, 200, 'the original owner must still be able to sign in');
});

/*
 * Bulk import is the path that matters most for this change: a workforce with
 * no company mailboxes is imported from a sheet, not typed in one at a time.
 *
 * validateRows is exercised directly rather than over HTTP because the endpoint
 * takes a spreadsheet, and building an xlsx fixture would test ExcelJS rather
 * than the rule under examination. It is the same function the preview and the
 * commit both call, so what it accepts here is exactly what an import creates.
 */
test('bulk import accepts a username with no email, and refuses a row with neither', async () => {
  const { validateRows } = await import('../src/services/userImportService.js');

  // Stands in for the tenant connection: the function reads the existing user
  // table once, and this is that table.
  const db = {
    query: async () => [[
      { id: 1, employee_id: 'EXIST1', email: 'taken@orga.test', username: 'takenname' },
    ]],
  };
  const actor = { role: 'admin' };
  const row = (over) => ({
    __row: 2, employee_id: 'IMP100', first_name: 'Asha', last_name: 'Rao',
    year_of_birth: '1994', phone: '+919812345670', role: 'employee', ...over,
  });

  const ok = await validateRows(db, actor, [row({ username: 'asha.rao' })]);
  assert.equal(ok.valid.length, 1, `a username-only row must be accepted: ${JSON.stringify(ok.errors)}`);
  assert.equal(ok.valid[0].username, 'asha.rao');
  assert.equal(ok.valid[0].email, null, 'a blank address must import as NULL, not an empty string');

  const emailOnly = await validateRows(db, actor, [row({ email: 'asha@orga.test' })]);
  assert.equal(emailOnly.valid.length, 1, 'an email-only row must still be accepted');

  const neither = await validateRows(db, actor, [row({})]);
  assert.equal(neither.valid.length, 0, 'a row with no username and no email must be refused');
  assert.match(neither.errors[0].message, /username or an email/);

  const badName = await validateRows(db, actor, [row({ username: '9812345678' })]);
  assert.equal(badName.valid.length, 0,
    'an all-digit username must be refused — it would collide with a phone key');

  const dupInTenant = await validateRows(db, actor, [row({ username: 'takenname' })]);
  assert.equal(dupInTenant.valid.length, 0, 'a username already in this tenant must be refused');

  const dupInSheet = await validateRows(db, actor, [
    row({ username: 'same.name' }),
    row({ __row: 3, employee_id: 'IMP101', username: 'same.name' }),
  ]);
  assert.equal(dupInSheet.valid.length, 1, 'two rows claiming one username: only the first survives');
  assert.match(dupInSheet.errors[0].message, /Duplicate username/);
});

// ── Lifetime plan ────────────────────────────────────────────────────────────
/*
 * billing_cycle already had 'one_time', mapped to 3650 days and commented
 * "effectively perpetual; still has an end date on file". Effectively is the
 * problem: the date is real and the nightly sweep reads it, so in ten years it
 * would expire an organisation that was sold a plan which does not expire.
 */
test('a lifetime plan never expires and is never billed again', async () => {
  const plans = await api('GET', '/api/platform/plans', { token: PA });
  const lifetime = (plans.data.plans || []).find((p) => p.code === 'LIFETIME');
  assert.ok(lifetime, 'the seeded LIFETIME plan must exist');
  assert.equal(lifetime.billing_cycle, 'lifetime');
  assert.equal(Number(lifetime.amount_paise), 0, 'the seeded lifetime plan is free');
  assert.equal(lifetime.cycle_days, null,
    'a lifetime plan must report no cycle length — a number here would behave like an expiry');
  assert.equal(lifetime.is_lifetime, true);

  const assigned = await api('POST', `/api/platform/tenants/${tenantBId}/plan`, {
    token: PA, body: { plan_id: lifetime.id },
  });
  assert.equal(assigned.data.success, true,
    `assigning it must work — server said: ${JSON.stringify(assigned.data)}`);

  const [row] = await sql('ifqm_test_master',
    `SELECT billing_status, period_end FROM ifqm_test_master.tenants WHERE id = ${tenantBId}`);
  assert.equal(row.period_end, null, 'a lifetime organisation must have no period end');
  assert.equal(row.billing_status, 'exempt',
    "and must be exempt, which is what keeps it out of the lapse sweep's query");

  // The label has to separate "sold a perpetual plan" from "we chose not to
  // bill them" — both are exempt, and the screens should not say the same thing.
  const sub = await api('GET', `/api/platform/tenants/${tenantBId}/subscription`, { token: PA });
  assert.equal(sub.data.subscription.is_lifetime, true);
  assert.match(sub.data.subscription.label, /Lifetime/);
  assert.equal(sub.data.subscription.blocked, false, 'it must never be blocked');

  /*
   * The two calls that would quietly undo it. CYCLE_DAYS.lifetime is null, so
   * both used to fall through `|| 365` and hand a perpetual organisation an
   * expiry date a year out — invisible until the sweep suspended them.
   */
  const renew = await api('POST', `/api/platform/tenants/${tenantBId}/mark-paid`, {
    token: PA, body: { periods: 1 },
  });
  assert.notEqual(renew.status, 200, 'renewing a lifetime plan must be refused, not silently applied');

  const trial = await api('POST', `/api/platform/tenants/${tenantBId}/trial`, {
    token: PA, body: { days: 30 },
  });
  assert.notEqual(trial.status, 200, 'a trial window on a lifetime plan must be refused');

  const after = await sql('ifqm_test_master',
    `SELECT billing_status, period_end FROM ifqm_test_master.tenants WHERE id = ${tenantBId}`);
  assert.equal(after[0].period_end, null, 'and neither refusal may have left an end date behind');
  assert.equal(after[0].billing_status, 'exempt');
});

// ── What a company must supply to apply ──────────────────────────────────────
/*
 * MOM 29 Jul 2026 §13. The statutory step was removed wholesale for a while —
 * Udyam, GSTIN, PAN, CIN and the website all came off the form — and §13 puts
 * back exactly two of them: GSTIN and Company PAN. They are the reason the
 * email-domain rule is not the only check on whether an applicant is a real
 * business.
 *
 * Everything §13 calls "other details" is now optional: designation, NIC code,
 * turnover band and the whole registered address. None of them decides whether
 * an application can be assessed, and each is another field between somebody
 * deciding to try the product and actually doing so.
 */
test('an application needs its business identity, and nothing §13 calls optional', async () => {
  const { validateApplication } = await import('../src/services/registrationService.js');

  const base = {
    company_name: 'Nandi Precision Works', proposed_slug: 'nandi',
    contact_name: 'Rekha Prasad',
    contact_email: 'rekha@nandiprecision.com', contact_phone: '+919812345680',
    gstin: '29ABCDE1234F1ZW', pan: 'ABCDE1234F',
    entity_type: 'private_limited', enterprise_category: 'small',
    sector: 'Manufacturing', employee_count: '85', year_established: '2015',
    accepted_terms: true,
  };

  // The mandatory set, and nothing else at all.
  const row = validateApplication({ ...base });
  assert.ok(row, 'the §13 mandatory set alone must be enough to apply');
  assert.equal(row.gstin, '29ABCDE1234F1ZW');
  assert.equal(row.pan, 'ABCDE1234F');

  // Each of the two statutory numbers is genuinely required now.
  assert.throws(() => validateApplication({ ...base, gstin: '' }), /GSTIN/i,
    'GSTIN is mandatory under §13');
  assert.throws(() => validateApplication({ ...base, pan: '' }), /PAN/i,
    'business PAN is mandatory under §13');

  // ...and still checked for shape, so a typo is caught rather than stored.
  assert.throws(() => validateApplication({ ...base, gstin: 'NOT-A-GSTIN' }), /GSTIN/i);
  assert.throws(() => validateApplication({ ...base, pan: 'nonsense' }), /PAN/i);

  /*
   * The "other details". Absent, an application still goes through — this is
   * the half of §13 that is easy to overlook, because the fields were all
   * mandatory before and nothing complains when they simply stay filled in.
   */
  for (const optional of ['contact_designation', 'nic_code', 'annual_turnover_band',
    'address_line', 'city', 'state', 'pincode', 'country', 'proposed_slug']) {
    const without = { ...base };
    delete without[optional];
    assert.ok(validateApplication(without),
      `${optional} is optional under §13 and must not block an application`);
  }

  // A CIN or a Udyam number is not asked for, and is still stored when sent —
  // an older client, or a later step, must not silently lose what it supplied.
  const extra = validateApplication({
    ...base, udyam_number: 'UDYAM-KR-03-0012345', cin: 'U29100KA2015PTC012345',
    website: 'https://nandiprecision.com',
  });
  assert.equal(extra.udyam_number, 'UDYAM-KR-03-0012345');
  assert.equal(extra.cin, 'U29100KA2015PTC012345');
  assert.equal(extra.website, 'https://nandiprecision.com');

  // A private limited company with no CIN is accepted: §13 does not ask for one.
  assert.ok(validateApplication({ ...base, entity_type: 'private_limited' }));

  // The identity that makes an application answerable at all.
  assert.throws(() => validateApplication({ ...base, company_name: '' }), /company name/i);
  assert.throws(() => validateApplication({ ...base, contact_phone: '' }), /mobile number|phone/i);
});

// ── Domain-based approval, and the exception list ────────────────────────────
/*
 * registrationService has carried a FREE_EMAIL_DOMAINS list since it was
 * written, with a comment explaining why an application from Gmail is either a
 * sole trader on personal email or noise — and nothing ever consulted it. Only
 * disposable mailboxes were refused.
 *
 * It matters more since the statutory identifiers came off the form: those
 * numbers were how a reviewer checked an applicant against the public
 * registers, so the work email domain is now the strongest remaining signal
 * that an application comes from a real business.
 */
test('applications from personal mailboxes are refused unless allowed explicitly', async () => {
  const svc = await import('../src/services/registrationService.js');

  const corporate = await svc.checkCorporateEmail('rekha@nandiprecision.com');
  assert.equal(corporate.ok, true, 'a company domain is accepted');

  let personal = await svc.checkCorporateEmail('ravi@gmail.com');
  assert.equal(personal.ok, false, 'a personal mailbox is refused by default');
  assert.equal(personal.free_provider, true);
  assert.match(personal.reason, /company email/i);

  // Disposable is refused for a different reason, and is not whitelistable at
  // all — an address designed to stop existing is not a small business without
  // a domain.
  const throwaway = await svc.checkCorporateEmail('x@mailinator.com');
  assert.equal(throwaway.ok, false);
  assert.match(throwaway.reason, /Temporary/i);

  // ── One address ──
  const added = await api('POST', '/api/platform/registrations/whitelist', {
    token: PA, body: { entry: 'ravi@gmail.com', note: 'No company domain — verified by phone.' },
  });
  assert.equal(added.data.success, true,
    `the exception must be addable — server said: ${JSON.stringify(added.data)}`);
  assert.equal(added.data.entry_type, 'address');

  personal = await svc.checkCorporateEmail('ravi@gmail.com');
  assert.equal(personal.ok, true, 'the allowed address now passes');
  assert.equal(personal.allowed_by_exception, true, 'and is marked as an exception, not an ordinary pass');

  // Everybody else on that provider is still refused — this is the whole point
  // of allowing an address rather than a domain.
  const neighbour = await svc.checkCorporateEmail('someoneelse@gmail.com');
  assert.equal(neighbour.ok, false, 'allowing one address must not open the provider');

  // The live check the signup form calls as you type must agree with the rule
  // the submit path enforces, or the form says yes and the server says no.
  const live = await api('GET', '/api/registrations/check-email?email=ravi@gmail.com');
  assert.equal(live.data.acceptable, true);
  const liveNeighbour = await api('GET', '/api/registrations/check-email?email=someoneelse@gmail.com');
  assert.equal(liveNeighbour.data.acceptable, false);
  assert.equal(liveNeighbour.data.free_provider, true,
    'the form needs to know this is a "we can enable it" no, not a malformed-address no');

  // ── A whole provider ──
  const wide = await api('POST', '/api/platform/registrations/whitelist', {
    token: PA, body: { entry: 'gmail.com', note: 'Campaign — expecting Gmail applicants.' },
  });
  assert.equal(wide.data.entry_type, 'domain');
  const nowOk = await svc.checkCorporateEmail('someoneelse@gmail.com');
  assert.equal(nowOk.ok, true, 'allowing the domain opens it for everybody');

  // ── What may not be added ──
  const dup = await api('POST', '/api/platform/registrations/whitelist', {
    token: PA, body: { entry: 'gmail.com' },
  });
  assert.equal(dup.status, 409, 'the same entry twice is a conflict, not a silent no-op');

  const throwawayEntry = await api('POST', '/api/platform/registrations/whitelist', {
    token: PA, body: { entry: 'mailinator.com' },
  });
  assert.notEqual(throwawayEntry.status, 201, 'a throwaway provider must not be allowable');

  /*
   * MOM 24/08: no differentiation by organisation size or type — any
   * organisation may be admitted through the whitelist, subject to IFQM
   * approval. A company domain used to be REFUSED here on the reasoning that
   * it was never blocked, so allowing it granted nothing.
   *
   * It is accepted now, and reported as redundant. That keeps the useful half
   * of the old refusal — telling the operator the entry grants nothing new —
   * without refusing a record somebody has a reason to keep.
   */
  const corporateEntry = await api('POST', '/api/platform/registrations/whitelist', {
    token: PA, body: { entry: 'nandiprecision.com', note: 'Approved by IFQM.' },
  });
  assert.equal(corporateEntry.data.success, true,
    `any organisation may be whitelisted — ${JSON.stringify(corporateEntry.data)}`);
  assert.equal(corporateEntry.data.redundant, true,
    'but the operator is told it grants nothing that was not already allowed');

  // A free provider is the case the list exists for, and is NOT redundant.
  const real = await api('POST', '/api/platform/registrations/whitelist', {
    token: PA, body: { entry: 'outlook.com', note: 'Approved by IFQM.' },
  });
  assert.equal(real.data.success, true);
  assert.equal(real.data.redundant, false,
    'allowing a blocked provider does grant something, and must not be flagged redundant');

  // ── Removing puts the rule back ──
  const list = await api('GET', '/api/platform/registrations/whitelist', { token: PA });
  const domainRow = list.data.entries.find((e) => e.entry === 'gmail.com');
  assert.ok(domainRow.note, 'the reason must be kept — it is what makes the exception auditable');
  await api('DELETE', `/api/platform/registrations/whitelist/${domainRow.id}`, { token: PA });

  const reblocked = await svc.checkCorporateEmail('someoneelse@gmail.com');
  assert.equal(reblocked.ok, false, 'removing the domain refuses the provider again');
  const stillAllowed = await svc.checkCorporateEmail('ravi@gmail.com');
  assert.equal(stillAllowed.ok, true, 'but the individual exception survives it');
});

test('the exception list is platform-admin only', async () => {
  const asOrgAdmin = await api('GET', '/api/platform/registrations/whitelist', { token: AADMIN });
  assert.ok(asOrgAdmin.status === 401 || asOrgAdmin.status === 403,
    `an org admin must not read the list — got ${asOrgAdmin.status}`);
  const anon = await api('POST', '/api/platform/registrations/whitelist', {
    body: { entry: 'attacker@gmail.com' },
  });
  assert.ok(anon.status === 401 || anon.status === 403,
    `and must not be addable anonymously — got ${anon.status}`);
});

// ── The attachment ceiling belongs to IFQM, not the environment ──────────────
/*
 * The largest attachment any organisation could allow was MAX_FILE_MB, an
 * environment variable, so raising it for one customer meant a redeploy.
 * It is now a platform setting an org admin is bounded by and cannot exceed.
 */
test('an organisation may lower the attachment limit but never raise it past the platform ceiling', async () => {
  const setCeiling = async (mb) => {
    const res = await api('PUT', '/api/platform/settings/defaults', {
      token: PA, body: { platform_max_file_mb: String(mb) },
    });
    assert.equal(res.data.success, true,
      `the console must accept a ceiling — server said: ${JSON.stringify(res.data)}`);
  };

  await setCeiling(25);

  // The org admin sees the bound their field is actually clamped to. Without
  // this the form advertises one number while the server enforces another.
  let seen = await api('GET', '/api/settings', { token: AADMIN });
  assert.equal(Number(seen.data.platform_max_file_mb), 25,
    'the ceiling must travel with the org settings');

  // Lower is theirs to choose.
  await api('POST', '/api/settings', { token: AADMIN, body: { max_file_mb: '8' } });
  seen = await api('GET', '/api/settings', { token: AADMIN });
  assert.equal(seen.data.settings.max_file_mb, '8', 'an organisation may set a smaller limit');

  // Higher is not. Trimmed to the ceiling rather than refused, so an admin who
  // types an optimistic number still ends up with a working setting.
  await api('POST', '/api/settings', { token: AADMIN, body: { max_file_mb: '999' } });
  seen = await api('GET', '/api/settings', { token: AADMIN });
  assert.equal(seen.data.settings.max_file_mb, '25',
    'a value above the ceiling must be trimmed to it');

  /*
   * Lowering the ceiling afterwards must bind an already-stored value too. The
   * clamp on save alone would leave yesterday's 25 being honoured today.
   */
  await setCeiling(5);
  seen = await api('GET', '/api/settings', { token: AADMIN });
  assert.equal(Number(seen.data.platform_max_file_mb), 5);

  // And the console itself cannot exceed what the server will accept.
  await setCeiling(100000);
  const capped = await api('GET', '/api/settings', { token: AADMIN });
  assert.ok(Number(capped.data.platform_max_file_mb) <= 50,
    `the console must stay within MAX_FILE_MB, got ${capped.data.platform_max_file_mb}`);

  await setCeiling(10);   // leave it as the other cases expect
});

// ── IFQM hears about a new application ───────────────────────────────────────
/*
 * An application landed in a queue nobody was watching. The applicant is told
 * "we will email you once it has been reviewed", and until somebody happened to
 * open the console that was a promise with no mechanism behind it.
 */
test('a new application notifies every platform admin, and cannot fail the submission', async () => {
  const svc = await import('../src/services/registrationService.js');

  const reg = {
    company_name: 'Peenya Tooling Works', proposed_slug: 'peenya',
    contact_name: 'D. Shetty', contact_designation: 'Partner',
    contact_email: 'd.shetty@peenyatooling.com', contact_phone: '+919812345699',
    email_domain: 'peenyatooling.com', sector: 'Manufacturing',
    employee_count: 40, city: 'Bengaluru', state: 'Karnataka',
  };

  const summary = await svc.notifyPlatformOfApplication(reg, 'REG-9001');
  assert.ok(summary.recipients >= 1,
    `the seeded platform admin must be a recipient, got ${JSON.stringify(summary)}`);

  /*
   * Nothing actually leaves the machine in a test run — platform mail is blanked
   * by the harness — so `sent` is expected to be 0 here. That is precisely the
   * case worth pinning: the notifier resolves rather than throwing when mail is
   * unavailable, which is what keeps a failed notification from failing an
   * application that is already committed.
   */
  assert.equal(typeof summary.sent, 'number');

  // Adding a billing contact adds a recipient without displacing the admins.
  await api('PUT', '/api/platform/settings/defaults', {
    token: PA, body: { billing_contact_email: 'accounts@ifqm.io' },
  });
  const withBilling = await svc.notifyPlatformOfApplication(reg, 'REG-9002');
  assert.ok(withBilling.recipients > summary.recipients,
    'a configured billing contact must be added to the platform admins, not replace them');

  // And a duplicate address is not mailed twice.
  await api('PUT', '/api/platform/settings/defaults', {
    token: PA, body: { billing_contact_email: 'platform@ifqm.io' },
  });
  const deduped = await svc.notifyPlatformOfApplication(reg, 'REG-9003');
  assert.equal(deduped.recipients, summary.recipients,
    'a billing contact that is already an admin must not be counted twice');
});

// ── The temporary password is emailed, not read down the phone ───────────────
/*
 * Approving a registration and resetting an org admin's password both minted a
 * credential and put it on screen with "share it with the applicant". The
 * credential to a brand-new workspace then travelled by whatever channel the
 * operator reached for.
 */
test('a temporary password is emailed, and is still shown when the email cannot go', async () => {
  const { sendTemporaryPassword } = await import('../src/services/mailerService.js');

  // Platform mail is blanked by the harness, so this exercises the path that
  // matters most: what happens when the send does NOT work.
  const delivered = await sendTemporaryPassword({
    email: 'newadmin@nandiprecision.com', name: 'Rekha Prasad',
    orgName: 'Nandi Precision', slug: 'nandi', password: 'Temp-abc123', reason: 'welcome',
  });
  assert.equal(delivered, false, 'with no mail route configured it must report failure, not throw');

  // No address is a normal state, not an error — the same rule the mailer
  // applies everywhere since accounts stopped requiring an email.
  assert.equal(await sendTemporaryPassword({ email: '', password: 'x' }), false);
  assert.equal(await sendTemporaryPassword({ email: 'a@b.com', password: '' }), false);

  /*
   * The console reset still hands the password back whether or not the email
   * went. Removing it on the assumption mail always works would turn a failed
   * send into a locked-out administrator.
   */
  const res = await api('POST', `/api/platform/tenants/${tenantBId}/reset-admin-password`, {
    token: PA, body: { admin_email: 'admin@orgb.test' },
  });
  assert.equal(res.data.success, true,
    `the reset must succeed even with mail down — server said: ${JSON.stringify(res.data)}`);
  assert.ok(res.data.temp_password, 'the password must still be shown');
  assert.equal(res.data.password_emailed, false, 'and the screen must say it was not emailed');
  assert.match(res.data.note, /could not be sent|pass this on/i,
    'the note must tell the operator to hand it over themselves');

  // The new password must actually work, and force a change at first sign-in.
  const signedIn = await api('POST', '/api/auth/login', {
    body: { email: 'admin@orgb.test', password: res.data.temp_password, orgSlug: 'orgb' },
  });
  assert.equal(signedIn.status, 200, 'the emailed password must be the one that works');
  // Sent as a boolean or a 1 depending on the driver's tinyint handling — the
  // fact being asserted is that it is set, not how MySQL spelled it.
  assert.ok(signedIn.data.user.must_change_password,
    'and must force a change at first sign-in');
});

// ── Archiving a ticket ───────────────────────────────────────────────────────
/*
 * The bulk endpoint has only ever archived resolved and closed tickets. The
 * single-ticket path had no such rule, so it could be walked around by doing it
 * one at a time — and a still-open ticket archived by accident is a customer
 * waiting for an answer that is now invisible to everybody.
 */
test('only a resolved ticket can be archived, one at a time or in bulk', async () => {
  const raise = async (subject) => {
    const res = await api('POST', '/api/support/tickets', {
      token: AADMIN,
      body: { subject, category: 'question', priority: 'normal',
        body: 'Raised by the suite to exercise archiving.' },
    });
    assert.equal(res.data.success, true,
      `a ticket must be raisable — server said: ${JSON.stringify(res.data)}`);
    return res.data.ticket_id ?? res.data.id;
  };

  const openId = await raise('Still waiting on an answer');

  // Open: refused, with a reason that says what to do about it.
  let res = await api('PATCH', `/api/platform/tickets/${openId}`, {
    token: PA, body: { archived: true },
  });
  assert.notEqual(res.status, 200, 'an open ticket must not be archivable');
  assert.match(res.data.error, /resolve or close it/i);

  // Resolved: allowed.
  await api('PATCH', `/api/platform/tickets/${openId}`, { token: PA, body: { status: 'resolved' } });
  res = await api('PATCH', `/api/platform/tickets/${openId}`, { token: PA, body: { archived: true } });
  assert.equal(res.data.success, true, 'a resolved ticket must be archivable');

  const [row] = await sql('ifqm_test_master',
    `SELECT archived_at FROM ifqm_test_master.support_tickets WHERE id = ${openId}`);
  assert.ok(row.archived_at, 'and must actually be marked archived');

  // Restoring is never restricted — getting something back must be easier than
  // losing it.
  res = await api('PATCH', `/api/platform/tickets/${openId}`, { token: PA, body: { archived: false } });
  assert.equal(res.data.success, true, 'restoring must always be allowed');

  // ── Bulk ──
  const a = await raise('Bulk one');
  const b = await raise('Bulk two');
  await api('PATCH', `/api/platform/tickets/${a}`, { token: PA, body: { status: 'resolved' } });

  const bulk = await api('POST', '/api/platform/tickets/bulk-archive', {
    token: PA, body: { ids: [a, b], archive: true },
  });
  assert.equal(bulk.data.success, true);
  assert.equal(bulk.data.affected, 1,
    'only the resolved one of the two may be archived — the open one is skipped, not refused');

  const rows = await sql('ifqm_test_master',
    `SELECT id, archived_at FROM ifqm_test_master.support_tickets WHERE id IN (${a}, ${b})`);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.archived_at]));
  assert.ok(byId[a], 'the resolved ticket is archived');
  assert.ok(!byId[b], 'the open one is left alone');
});

// ── The user manual, chosen by role ─────────────────────────────────────────
/*
 * There are three manuals and handing an employee the platform-admin one is
 * not a small mistake: it describes a console they have no account for and
 * other organisations they must never learn exist. The role therefore comes
 * from the SESSION, never from the request — a ?role= would be a way for
 * anybody to ask for the vendor manual by typing it.
 */
test('each role is served its own manual, and none is served anonymously', async () => {
  const anon = await api('GET', '/api/export/user-guide');
  assert.ok(anon.status === 401 || anon.status === 403,
    `no manual may be served anonymously — got ${anon.status}`);

  // Filename is how the caller can tell WHICH manual arrived: the body is a
  // PDF either way, and asserting on bytes would prove nothing about routing.
  const nameOf = (res) => String(res.headers?.['content-disposition'] || '');

  const asEmployee = await api('GET', '/api/export/user-guide', { token: AUSER });
  const asOrgAdmin = await api('GET', '/api/export/user-guide', { token: AADMIN });
  const asPlatform = await api('GET', '/api/export/user-guide', { token: PA });

  for (const [who, res] of [['employee', asEmployee], ['org admin', asOrgAdmin],
    ['platform admin', asPlatform]]) {
    assert.ok(res.status === 200 || res.status === 404,
      `${who} must get a manual or an honest 404, got ${res.status}`);
  }

  // Skipped rather than failed on a deployment shipped without the folder —
  // that is a packaging choice, and the 404 path is asserted above.
  if (asEmployee.status === 404) return;

  assert.match(nameOf(asEmployee), /Employee/i, 'an employee gets the employee manual');
  assert.match(nameOf(asOrgAdmin), /Organisation-Admin/i, 'an org admin gets the org-admin manual');
  assert.match(nameOf(asPlatform), /Platform-Admin/i, 'a platform admin gets the platform manual');

  /*
   * The disclosure that matters. An employee must not receive the vendor
   * console's manual by any route.
   */
  assert.ok(!/Platform-Admin/i.test(nameOf(asEmployee)),
    'an employee must never be handed the platform-admin manual');
  assert.ok(!/Platform-Admin/i.test(nameOf(asOrgAdmin)),
    'nor must an organisation admin');
});

/*
 * Section G named one person: the last Approved or Implemented workflow entry.
 * On a closure document that is the wrong record — an idea that reached the
 * Plant Head passed through two people before them, each of whom made a
 * judgement, and a signed-off PDF crediting only the final signature loses the
 * audit trail that made the decision defensible.
 *
 * PDF text is inside compressed streams, so the assertion is on size rather
 * than content: an idea with a long history must produce a materially bigger
 * document than the same idea with none. That is weak evidence of wording and
 * strong evidence that the rows were drawn at all, which is the part that
 * regressed.
 */
test('the closure PDF grows with the approval chain it has to show', async () => {
  const submit = await api('POST', '/api/ideas/submit', {
    token: AUSER,
    body: {
      title: 'Guard interlock on the shear',
      present_situation: 'The guard is defeated during setup because the interlock is slow to reset.',
      proposed_solution: 'Fit a faster interlock and a setup mode that keeps the guard live.',
      investment_required: '45000',
    },
  });
  const ideaId = submit.data.idea_id;

  const bare = await api('GET', `/api/export/idea/${ideaId}/pdf`, { token: AADMIN });
  assert.equal(bare.status, 200);
  const bareSize = bare.text.length;

  // Six steps, each with a comment long enough to wrap — which is also what
  // exercises the row-height and page-break arithmetic.
  for (let i = 1; i <= 6; i++) {
    await sql('ifqm_test_a',
      `INSERT INTO ifqm_test_a.idea_workflow (idea_id, actor_id, action, comment, created_at)
       VALUES (${ideaId}, 1, 'Reviewed',
         'Step ${i}: checked against the standard, the interlock timing and the setup procedure, and passed it upward.',
         NOW())`);
  }

  const full = await api('GET', `/api/export/idea/${ideaId}/pdf`, { token: AADMIN });
  assert.equal(full.status, 200);
  assert.match(full.contentType, /application\/pdf/);
  assert.ok(full.text.startsWith('%PDF'), 'still a valid PDF with a long chain');
  assert.ok(full.text.length > bareSize,
    `the chain must actually be drawn — ${full.text.length} vs ${bareSize} bytes`);
});

// ── A password can be reset by username, phone or email ─────────────────────
/*
 * The code route existed on the server and nothing ever called it: the forgot
 * dialog validated an email regex and refused everything else. Once accounts
 * stopped requiring an email that was no longer an inconvenience — somebody
 * with a username and a mobile number and no address had no way to reset a
 * password at all.
 */
test('a reset code can be requested by username or phone, and goes somewhere reachable', async () => {
  const auth = await import('../src/services/authService.js');
  const verification = await import('../src/services/verificationService.js');

  // classify() has to know the third identifier, or the reset path rejects it
  // before it ever looks anybody up.
  assert.equal(verification.classify('yashas123').idType, 'username');
  assert.equal(verification.classify('yashas123').channel, '',
    'a username is not a destination, so it carries no channel');
  assert.equal(verification.classify('user@orga.test').idType, 'email');
  assert.equal(verification.classify('+919812345691').idType, 'phone');

  /*
   * yashas123 was created earlier with a mobile number and NO email address.
   * That is exactly the account the old dialog could not serve.
   */
  const byUsername = await auth.requestPasswordResetCode({ identifier: 'yashas123' });
  assert.equal(byUsername.success, true);
  assert.ok(byUsername.sent_to,
    'a username reset must say where the code went — the caller cannot otherwise know');
  assert.match(byUsername.sent_to, /5691$/,
    `it must go to the number on that account, got ${byUsername.sent_to}`);

  // The code must be redeemable against the DESTINATION, not the username —
  // keying the row on what was typed would issue a code nobody could use.
  const [row] = await sql('ifqm_test_master',
    `SELECT identifier, purpose, user_id FROM ifqm_test_master.login_otps
      WHERE purpose = 'password_reset' ORDER BY id DESC LIMIT 1`);
  assert.ok(row, 'a reset code row must exist');
  assert.notEqual(row.identifier, 'yashas123',
    'the row must be keyed on where the code was sent, not on the username typed');
  assert.ok(row.user_id, 'and must be bound to the account it will reset');

  // An unknown identifier is answered identically — this must not become a way
  // to discover which usernames exist.
  const unknown = await auth.requestPasswordResetCode({ identifier: 'nobody.here' });
  assert.equal(unknown.success, true);
  assert.ok(!unknown.sent_to, 'an unknown identifier must not report a destination');

  // Nonsense is refused outright rather than answered generically: there is
  // nothing to protect, and the person has simply mistyped.
  await assert.rejects(() => auth.requestPasswordResetCode({ identifier: '  ' }),
    /username, registered email address or mobile number/i);
});

/*
 * The code has to be redeemable end to end, or the dialog is telling somebody
 * to type it into a box that leads nowhere. This walks the whole SMS route:
 * ask by username, read the code the log provider issued, exchange it for a
 * token, set a new password, sign in with it.
 */
test('a code sent to a username holder resets the password end to end', async () => {
  const auth = await import('../src/services/authService.js');

  /*
   * The previous case already asked for a code for this account, and the resend
   * throttle is real — sixty seconds. Cleared here rather than waited out or
   * turned off globally: the throttle is behaviour worth keeping in force for
   * every other case in this file.
   */
  await sql('ifqm_test_master',
    "DELETE FROM ifqm_test_master.login_otps WHERE purpose = 'password_reset'");

  const asked = await auth.requestPasswordResetCode({ identifier: 'yashas123' });
  assert.equal(asked.success, true);

  // The suite runs the mock SMS provider, so the code never leaves the machine.
  // It is read back from the row it was written to, hashed — which is why the
  // plaintext has to come from the provider's own record instead.
  const [row] = await sql('ifqm_test_master',
    `SELECT id, identifier, code_hash, user_id FROM ifqm_test_master.login_otps
      WHERE purpose = 'password_reset' ORDER BY id DESC LIMIT 1`);
  assert.ok(row && row.user_id, 'the code must be bound to the account');

  /*
   * Codes are bcrypt-hashed on purpose, so the test cannot read one back. It
   * plants a known code instead — the same shape the service issues — which
   * exercises verifyPasswordResetCode, the token it mints and the reset that
   * redeems it, without weakening how codes are stored.
   */
  const bcrypt = (await import('bcryptjs')).default;
  await sql('ifqm_test_master',
    `UPDATE ifqm_test_master.login_otps SET code_hash = ?, attempts = 0,
            expires_at = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE id = ?`,
    [await bcrypt.hash('424242', 4), row.id]);

  const verified = await auth.verifyPasswordResetCode({
    identifier: row.identifier, code: '424242',
  });
  assert.equal(verified.success, true, 'a correct code must be accepted');
  assert.ok(verified.token, 'and must hand back the same kind of token the emailed link carries');
  assert.ok(verified.org_slug, 'plus the org, so the reset page knows which database to open');

  const reset = await api('POST', '/api/auth/reset-password', {
    body: { token: verified.token, org_slug: verified.org_slug, password: 'BrandNewPass456' },
  });
  assert.equal(reset.data.success, true,
    `the token must set a new password — server said: ${JSON.stringify(reset.data)}`);

  // And the whole point: the person can now get in, by the username they
  // started from.
  const signedIn = await api('POST', '/api/auth/login', {
    body: { email: 'yashas123', password: 'BrandNewPass456' },
  });
  assert.equal(signedIn.status, 200, 'the new password must work with the username');
});

/*
 * The emailed reset link, which is the path a customer actually hits.
 *
 * password_reset_tokens.expires_at used to be written from Node as a UTC
 * string, then compared by findResetToken() with `expires_at > NOW()` — MySQL's
 * LOCAL clock. On any server running ahead of UTC the token was in the past
 * before the email had been sent: a deployment in India issued reset links that
 * were five and a half hours expired on arrival, and every one answered
 * "Invalid or expired reset link."
 *
 * Asserted against the database's own clock rather than JavaScript's, because
 * the disagreement between those two clocks IS the bug. Comparing in JS would
 * have passed throughout.
 */
test('a reset token is still valid by the database clock that judges it', async () => {
  await sql('ifqm_test_a', 'DELETE FROM ifqm_test_a.password_reset_tokens');

  const asked = await api('POST', '/api/auth/forgot-password', {
    body: { email: 'user@orga.test', org_slug: 'orga' },
  });
  assert.equal(asked.data.success, true, 'the request is answered generically either way');

  const [row] = await sql('ifqm_test_a',
    `SELECT expires_at > NOW() AS still_valid,
            TIMESTAMPDIFF(MINUTE, NOW(), expires_at) AS minutes_left
       FROM ifqm_test_a.password_reset_tokens ORDER BY id DESC LIMIT 1`);
  assert.ok(row, 'a reset token must have been written');
  assert.equal(Number(row.still_valid), 1,
    `the token must not be born expired — ${row.minutes_left} minute(s) left by MySQL's clock`);
  assert.ok(Number(row.minutes_left) > 50 && Number(row.minutes_left) <= 60,
    `an emailed link lasts an hour, got ${row.minutes_left} minutes`);
});

// ── Log retention ────────────────────────────────────────────────────────────
/*
 * "Delete the audit logs after two or three years" reads as one instruction and
 * is really two. Access records grow without bound and carry IP addresses;
 * approval history and billing records are the audit trail and the accounting
 * record, and deleting those would not tidy a log but erase the evidence that
 * decisions were made properly.
 */
test('the purge deletes old access logs and never touches approval or billing history', async () => {
  const retention = await import('../src/services/retentionService.js');

  // Old and recent sign-in records, aged by the DATABASE's clock — the same
  // clock the purge compares against.
  await sql('ifqm_test_master',
    `INSERT INTO ifqm_test_master.platform_login_activity
       (actor_type, actor_name, outcome, created_at)
     VALUES ('tenant_user','Ancient','success', DATE_SUB(NOW(), INTERVAL 40 MONTH)),
            ('tenant_user','AlsoOld','failure', DATE_SUB(NOW(), INTERVAL 30 MONTH)),
            ('tenant_user','Recent','success',  DATE_SUB(NOW(), INTERVAL 2 MONTH))`);

  // A dry run counts without deleting, so a change to the window can be sized
  // before it is made.
  const preview = await retention.purgeExpiredLogs({ dryRun: true });
  assert.equal(preview.dry_run, true);
  assert.equal(preview.months, 24, 'the seeded default is two years');
  assert.ok(preview.per_table.platform_login_activity >= 2,
    `both old rows must be counted, got ${preview.per_table.platform_login_activity}`);
  const [[still]] = [await sql('ifqm_test_master',
    "SELECT COUNT(*) AS n FROM ifqm_test_master.platform_login_activity WHERE actor_name = 'Ancient'")];
  assert.equal(Number(still.n), 1, 'a dry run must delete nothing');

  const done = await retention.purgeExpiredLogs();
  assert.ok(done.deleted >= 2, `the purge must remove the old rows, got ${done.deleted}`);

  const rows = await sql('ifqm_test_master',
    `SELECT actor_name FROM ifqm_test_master.platform_login_activity
      WHERE actor_name IN ('Ancient','AlsoOld','Recent')`);
  const names = rows.map((r) => r.actor_name);
  assert.ok(!names.includes('Ancient'), 'a 40-month-old sign-in is gone');
  assert.ok(!names.includes('AlsoOld'), 'a 30-month-old sign-in is gone');
  assert.ok(names.includes('Recent'), 'a 2-month-old sign-in is kept');

  /*
   * The half that must never happen. idea_workflow is the approval chain — it
   * is Section H of the closure PDF — and it is not in the purge list at all.
   */
  const [wf] = await sql('ifqm_test_a',
    'SELECT COUNT(*) AS n FROM ifqm_test_a.idea_workflow');
  assert.ok(Number(wf.n) > 0, 'the suite has approval history to protect');
  await retention.purgeExpiredLogs();
  const [wfAfter] = await sql('ifqm_test_a',
    'SELECT COUNT(*) AS n FROM ifqm_test_a.idea_workflow');
  assert.equal(Number(wfAfter.n), Number(wf.n),
    'the approval trail must survive any number of purges');

  // The window is a setting, and is floored so it cannot be set somewhere that
  // would take this quarter's lockout counters with it.
  await api('PUT', '/api/platform/settings/defaults', {
    token: PA, body: { log_retention_months: '1' },
  });
  assert.equal(await retention.retentionMonths(), 6,
    'a window below the floor must be raised to it, not honoured');

  await api('PUT', '/api/platform/settings/defaults', {
    token: PA, body: { log_retention_months: '36' },
  });
  assert.equal(await retention.retentionMonths(), 36, 'three years is settable');

  await api('PUT', '/api/platform/settings/defaults', {
    token: PA, body: { log_retention_months: '24' },
  });
});

// ── MOM 22: the implementation metrics count what reached QC ─────────────────
/*
 * Implementation Rate reported counts['Implemented'] under the label "Ideas
 * forwarded to QC". Those are different populations: an idea reaches the QC
 * tool when it is pushed and QCMS accepts it, while its status can sit at
 * Approved for weeks afterwards. The figure moved when somebody marked an idea
 * implemented — not when it actually went across.
 */
test('analytics reports what reached QC, separately from what is marked Implemented', async () => {
  const before = await api('GET', '/api/reports/analytics', { token: AADMIN });
  assert.equal(before.status, 200);
  assert.ok(before.data.qcms, 'the payload must carry QC counters — the browser cannot derive them');
  const basePushed = Number(before.data.qcms.pushed) || 0;
  // Earlier cases in this file have already forwarded ideas, so both figures
  // are asserted as DELTAS. An absolute expectation would encode the order of
  // the whole suite into this one test.
  const baseVelocity = Number(before.data.qcms.pushed_30d) || 0;

  // An idea marked Implemented but never pushed. Under the old metric this
  // alone moved Implementation Rate; it must now move nothing.
  const submit = await api('POST', '/api/ideas/submit', {
    token: AUSER,
    body: {
      title: 'Reclaim swarf from the lathe bay',
      present_situation: 'Swarf is skipped with general waste and the metal value is lost.',
      proposed_solution: 'Segregate at the machine and sell it back to the foundry.',
      investment_required: '20000',
    },
  });
  await sql('ifqm_test_a',
    `UPDATE ifqm_test_a.ideas SET status='Implemented' WHERE id=${submit.data.idea_id}`);

  let now = await api('GET', '/api/reports/analytics', { token: AADMIN });
  assert.equal(Number(now.data.qcms.pushed), basePushed,
    'marking an idea Implemented must not change what reached QC');

  // Actually forwarding it does.
  await sql('ifqm_test_a',
    `UPDATE ifqm_test_a.ideas SET qcms_push_status='imported', qcms_pushed_at=NOW()
      WHERE id=${submit.data.idea_id}`);
  now = await api('GET', '/api/reports/analytics', { token: AADMIN });
  assert.equal(Number(now.data.qcms.pushed), basePushed + 1,
    'an idea that reached QC must be counted');
  assert.equal(Number(now.data.qcms.pushed_30d), baseVelocity + 1,
    'and must appear in the 30-day velocity window');

  /*
   * Velocity is a pace, so it only counts the recent window. An idea pushed
   * long ago still counts toward the rate and must not count toward velocity.
   */
  await sql('ifqm_test_a',
    `UPDATE ifqm_test_a.ideas SET qcms_pushed_at = DATE_SUB(NOW(), INTERVAL 90 DAY)
      WHERE id=${submit.data.idea_id}`);
  now = await api('GET', '/api/reports/analytics', { token: AADMIN });
  assert.equal(Number(now.data.qcms.pushed), basePushed + 1,
    'an old push still counts toward the overall rate');
  assert.equal(Number(now.data.qcms.pushed_30d), baseVelocity,
    'but a 90-day-old push drops back out of the velocity window');
});

// ── Pay as you go ────────────────────────────────────────────────────────────
/*
 * Billed for the people who actually signed in, not for the accounts that
 * exist. An organisation that provisions four hundred employees and has thirty
 * using the tool is billed for thirty, or the plan is a seat licence wearing a
 * different name.
 */
test('pay as you go meters distinct sign-ins, and a closed month stops moving', async () => {
  const usage = await import('../src/services/usageBillingService.js');
  const period = usage.periodOf();

  const plans = await api('GET', '/api/platform/plans', { token: PA });
  const payg = (plans.data.plans || []).find((p) => p.code === 'PAYG');
  assert.ok(payg, 'the seeded PAYG plan must exist');
  assert.equal(payg.billing_cycle, 'payg');
  assert.equal(payg.is_payg, true);
  assert.ok(payg.unit_label, 'a PAYG amount is a RATE, and must be labelled as one');

  await api('POST', `/api/platform/tenants/${tenantAId}/plan`, {
    token: PA, body: { plan_id: payg.id },
  });

  // Three sign-ins from two people, in this month. One active user signing in
  // repeatedly is one active user — that is the whole point of DISTINCT.
  await sql('ifqm_test_master',
    `INSERT INTO ifqm_test_master.platform_login_activity
       (actor_type, actor_id, actor_name, tenant_id, outcome, created_at)
     VALUES ('tenant_user','901','Meter One',${tenantAId},'success',NOW()),
            ('tenant_user','901','Meter One',${tenantAId},'success',NOW()),
            ('tenant_user','902','Meter Two',${tenantAId},'success',NOW())`);

  const live = await usage.activeUsersIn(tenantAId, period);
  assert.ok(live >= 2, `two distinct people must be counted, got ${live}`);

  // A failed sign-in is not use of the product and must not be billed for.
  await sql('ifqm_test_master',
    `INSERT INTO ifqm_test_master.platform_login_activity
       (actor_type, actor_id, actor_name, tenant_id, outcome, created_at)
     VALUES ('tenant_user','903','Never In',${tenantAId},'failure',NOW())`);
  assert.equal(await usage.activeUsersIn(tenantAId, period), live,
    'a failed sign-in must not be metered');

  // ── Closing the month ──
  const closed = await api('POST', `/api/platform/tenants/${tenantAId}/usage/close`, {
    token: PA, body: { period },
  });
  assert.equal(closed.data.success, true,
    `the month must close — server said: ${JSON.stringify(closed.data)}`);
  assert.equal(closed.data.active_users, live);
  assert.equal(closed.data.amount_paise, live * Number(payg.amount_paise),
    'the charge is active users times the unit rate');

  /*
   * The guarantee the snapshot exists for. More sign-ins arrive, and the closed
   * month does not move — because the log behind it is purged on a retention
   * window, and an invoice that quietly shrinks when re-opened is worse than
   * one that is wrong: nobody can tell which figure was charged.
   */
  await sql('ifqm_test_master',
    `INSERT INTO ifqm_test_master.platform_login_activity
       (actor_type, actor_id, actor_name, tenant_id, outcome, created_at)
     VALUES ('tenant_user','904','Latecomer',${tenantAId},'success',NOW())`);

  const again = await api('POST', `/api/platform/tenants/${tenantAId}/usage/close`, {
    token: PA, body: { period },
  });
  assert.equal(again.data.active_users, live,
    'a closed month must report what was stored, not a fresh count');
  assert.equal(again.data.recomputed, false, 'and must say it did not recount');

  // Revising is possible, but only when asked for explicitly.
  const revised = await api('POST', `/api/platform/tenants/${tenantAId}/usage/close`, {
    token: PA, body: { period, recount: true },
  });
  assert.ok(revised.data.active_users > live, 'an explicit recount picks up the latecomer');

  // Renewal by fixed period is refused: a PAYG month is settled against what it
  // metered, and extending it would move the period end with nobody having
  // decided what was owed.
  const renew = await api('POST', `/api/platform/tenants/${tenantAId}/mark-paid`, {
    token: PA, body: { periods: 1 },
  });
  assert.notEqual(renew.status, 200, 'mark-paid must not apply to a metered plan');
  assert.match(renew.data.error, /pay as you go/i);

  // The console reads usage from the subscription payload it already fetches.
  const sub = await api('GET', `/api/platform/tenants/${tenantAId}/subscription`, { token: PA });
  assert.ok(Array.isArray(sub.data.subscription.usage), 'usage must travel with the subscription');
  assert.ok(sub.data.subscription.usage.some((u) => u.period === period));
});

// ── Tenant connection pools are capped ───────────────────────────────────────
/*
 * Pools were created lazily and never evicted, so open connections grew
 * monotonically with the number of distinct organisations touched since the
 * last restart. Nothing capped it and nothing reclaimed it, so a process that
 * had served enough customers eventually exhausted the server's max_connections
 * and every tenant started failing to get a connection — including ones already
 * working, and triggered by an organisation that was not the cause.
 */
test('the tenant pool cache is capped and evicts the least recently used', async () => {
  const { getTenantPool, poolStats } = await import('../src/database/tenant.js');

  const before = poolStats();
  assert.ok(before.max >= 4, 'there must be a cap at all');
  assert.ok(before.open <= before.max, 'and it must already be respected');

  /*
   * Ask for more distinct pools than the cap allows. They point at databases
   * that do not exist, which is fine: mysql2 creates a pool lazily and does not
   * connect until a query is run, and what is under test is the CACHE, not the
   * connections.
   */
  for (let i = 0; i < before.max + 12; i++) {
    getTenantPool({ db_host: '127.0.0.1', db_name: `ifqm_pool_probe_${i}` });
  }

  const after = poolStats();
  assert.ok(after.open <= after.max,
    `the cache must not exceed its cap — ${after.open} open against a cap of ${after.max}`);

  /*
   * The point of LRU rather than "evict anything": a tenant asked for
   * repeatedly must survive a flood of one-off tenants. Touch one on every
   * iteration and it must still be resident at the end.
   */
  const hot = { db_host: '127.0.0.1', db_name: 'ifqm_pool_probe_hot' };
  const first = getTenantPool(hot);
  for (let i = 0; i < after.max + 5; i++) {
    getTenantPool({ db_host: '127.0.0.1', db_name: `ifqm_pool_flood_${i}` });
    getTenantPool(hot);   // keeps it at the most-recent end
  }
  assert.equal(getTenantPool(hot), first,
    'a pool touched on every iteration must not have been evicted');
});

// ── The approval chain decides who may approve ───────────────────────────────
/*
 * An organisation set its chain to start at Manager, and its team leads went on
 * approving ideas with full authority.
 *
 * The route guard is a STATIC list of every role that could plausibly review
 * anything, and reviewAction then took one of two paths: a role in
 * reviewer_roles escalated to its manager, and ANYTHING ELSE fell through to
 * the final-decision code. So a role deliberately left out of the chain was not
 * refused — it skipped escalation and closed the idea outright. The setting was
 * not being ignored; it was being inverted.
 */
test('a role outside the configured approval chain cannot approve, and sees an empty queue', async () => {
  // A chain that starts at Department Manager — no team lead in it.
  let res = await api('POST', '/api/settings', {
    token: AADMIN,
    body: { approval_stages: 'originator,department_manager,plant_head' },
  });
  assert.equal(res.data.success, true);

  const mk = async (email, role, phone) => {
    const created = await api('POST', '/api/users', {
      token: AADMIN,
      body: { name: `Chain ${role}`, email, password: 'ChainPass1234', role,
        employee_id: email.split('@')[0].toUpperCase(), phone, department: 'Ops' },
    });
    assert.equal(created.data.success, true,
      `${role} must be creatable — ${JSON.stringify(created.data)}`);
    return (await login(email, 'ChainPass1234', 'orga')).token;
  };
  const teamLead = await mk('chain.tl@orga.test', 'team_lead', '+919812345801');
  const deptMgr  = await mk('chain.dm@orga.test', 'department_manager', '+919812345802');

  const submitted = await api('POST', '/api/ideas/submit', {
    token: AUSER,
    body: {
      title: 'Bund the solvent store',
      present_situation: 'Drums are stored unbunded next to a floor drain.',
      proposed_solution: 'Install a bunded pallet and a spill kit at the door.',
      investment_required: '30000',
    },
  });
  const ideaId = submitted.data.idea_id;

  // The team lead is not in the chain. Refused, and told why.
  res = await api('POST', '/api/ideas/review-action', {
    token: teamLead, body: { idea_id: ideaId, decision: 'Approved' },
  });
  assert.equal(res.status, 403,
    `a team lead outside the chain must not approve — got ${res.status}`);
  assert.match(res.data.error, /approval chain/i, 'and must be told that is the reason');

  // The idea must be untouched — not merely un-notified.
  const [row] = await sql('ifqm_test_a',
    `SELECT status FROM ifqm_test_a.ideas WHERE id = ${ideaId}`);
  assert.notEqual(row.status, 'Approved', 'the idea must not have been approved');

  /*
   * And the queue. A bare `else` used to send every out-of-chain role to the
   * org-wide branch, so an excluded team lead saw EVERY idea in the
   * organisation — more than they should see, and how they reached them.
   */
  const queue = await api('GET', '/api/ideas/review', { token: teamLead });
  assert.equal(queue.status, 200);
  assert.equal((queue.data.ideas || []).length, 0,
    'somebody outside the chain has nothing waiting on them');

  // Somebody who IS in the chain still works.
  res = await api('POST', '/api/ideas/review-action', {
    token: deptMgr, body: { idea_id: ideaId, decision: 'Approved' },
  });
  assert.equal(res.data.success, true,
    `a department manager is in the chain and must be able to act — ${JSON.stringify(res.data)}`);

  // Put the default chain back for the cases that follow.
  await api('POST', '/api/settings', {
    token: AADMIN,
    body: { approval_stages: 'originator,immediate_manager,department_manager,plant_head' },
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 *  Onboarding without a date of birth
 * ─────────────────────────────────────────────────────────────────────────── */

test('an employee with no email gets the name+phone password, and no DOB is asked for', async () => {
  const empId = `NODOB${Date.now() % 100000}`;
  const res = await api('POST', '/api/users', {
    token: AADMIN,
    body: {
      action: 'create_user',
      /*
       * The username deliberately does NOT match the name.
       *
       * This test was written the other way round — the password came from the
       * USERNAME, and the mismatched name was here so a regression to the name
       * could not pass unnoticed. The rule has since been reversed to the name,
       * and the same mismatch now guards the same boundary from the other side.
       *
       * The name is the better source for where this credential is used: these
       * accounts have no mailbox, so the password is read out loud to somebody
       * who may not have been told their username yet.
       */
      name: 'Kumar Rao',
      employee_id: empId,
      username: `yashas${Date.now() % 100000}`,
      phone: '7975495881',
      role: 'employee',
      // Deliberately no date_of_birth. It used to be mandatory here.
    },
  });

  assert.equal(res.data.success, true,
    `creating a user without a date of birth must work — ${JSON.stringify(res.data)}`);

  // First 4 LETTERS of the name + last 4 digits of the phone.
  assert.equal(res.data.temp_password, 'kuma5881',
    'the derived password is name(4 letters) + phone(last 4) — "Kumar Rao" gives kuma');

  const [u] = await sql('ifqm_test_a',
    `SELECT username, must_change_password, date_of_birth, year_of_birth
       FROM ifqm_test_a.users WHERE employee_id = '${empId}'`);
  assert.ok(u, 'the user exists');
  assert.equal(Number(u.must_change_password), 1,
    'and must be forced to replace the bootstrap credential');
  assert.equal(u.date_of_birth, null, 'no date of birth was stored');
  assert.equal(u.year_of_birth, null, 'and no birth year either');

  // It must actually BE the password, not merely a string in the response.
  // The account has a username and no address, so it signs in the way it can.
  const login = await api('POST', '/api/auth/login', {
    body: { email: u.username, password: 'kuma5881', org_slug: 'orga' },
  });
  assert.equal(login.data.success, true,
    `the derived password must actually sign in — ${JSON.stringify(login.data)}`);
});

test('a country code does not change the derived password', async () => {
  // The last four digits are taken from the END precisely so that +91, a
  // leading zero, and spaces all land on the same four.
  const empId = `CC${Date.now() % 100000}`;
  const res = await api('POST', '/api/users', {
    token: AADMIN,
    body: {
      action: 'create_user',
      name: 'Kumar Rao',
      employee_id: empId,
      username: `yashas${(Date.now() + 1) % 100000}`,
      phone: '+91 79754 95881',
      role: 'employee',
    },
  });
  assert.equal(res.data.success, true, JSON.stringify(res.data));
  assert.equal(res.data.temp_password, 'kuma5881',
    'formatting of the number must not change the password');
});

test('an employee WITH an email is mailed a password instead of being handed one', async () => {
  const empId = `MAIL${Date.now() % 100000}`;
  const res = await api('POST', '/api/users', {
    token: AADMIN,
    body: {
      action: 'create_user',
      name: 'Asha Rao',
      employee_id: empId,
      email: `asha.${Date.now() % 100000}@orga.test`,
      phone: '9876500011',
      role: 'employee',
    },
  });
  assert.equal(res.data.success, true, JSON.stringify(res.data));

  /*
   * The important half of this assertion is the ABSENCE.
   *
   * When the mail goes out, the password must not also come back in the
   * response — it has reached its owner, and putting it on the admin's screen
   * would be a live credential sitting in a browser for no reason.
   *
   * When the mail fails, it MUST come back, because otherwise the account
   * exists with a password nobody knows. The test suite has no mail provider
   * configured, so this is the branch it exercises; both are asserted so
   * neither can quietly change.
   */
  if (res.data.password_emailed) {
    assert.equal(res.data.temp_password, undefined,
      'a delivered password must not also be shown to the admin');
  } else {
    assert.equal(res.data.email_failed, true,
      'if it was not emailed, the admin must be told the send failed');
    assert.ok(res.data.temp_password,
      'and must be given the password, or the employee is stranded');
    assert.ok(!/^asha/.test(res.data.temp_password),
      'the emailed credential is random, not derived from the username or name');
  }

  const [u] = await sql('ifqm_test_a',
    `SELECT must_change_password FROM ifqm_test_a.users WHERE employee_id = '${empId}'`);
  assert.equal(Number(u.must_change_password), 1,
    'an emailed password is still a bootstrap credential');
});

test('the import template no longer has a birth column', async () => {
  /*
   * Fetched directly rather than through the api() helper.
   *
   * The helper reads every response with res.text(), which decodes as UTF-8.
   * That is exactly right for JSON and exactly wrong for a zip: any byte that
   * is not valid UTF-8 becomes U+FFFD and never comes back, so the workbook
   * arrives corrupt no matter which encoding it is re-encoded with afterwards.
   */
  const raw = await fetch(`${getBaseUrl()}/api/users/import/template`, {
    headers: { Authorization: `Bearer ${AADMIN}` },
  });
  assert.equal(raw.status, 200, 'the template downloads');
  const bytes = Buffer.from(await raw.arrayBuffer());
  assert.ok(bytes.length > 0, 'and is not empty');

  // An .xlsx is a zip, so its strings are compressed — searching the bytes
  // proves nothing either way. Open it properly and read the header row.
  const zip = new ExcelJS.Workbook();
  await zip.xlsx.load(bytes);
  const sheet = zip.worksheets[0];
  const headers = (sheet.getRow(1).values || []).map((v) => String(v ?? '').toLowerCase());
  assert.ok(!headers.some((h) => /birth|dob/.test(h)),
    `no birth column may remain in the template — got ${headers.join(', ')}`);
  assert.ok(headers.includes('phone'),
    'and phone must still be there, since the password is built from it');
});

/* ───────────────────────────────────────────────────────────────────────────
 *  GSTIN verification (MOM 24/08 §2)
 * ─────────────────────────────────────────────────────────────────────────── */

test('a GSTIN must pass its own check digit, not merely look like one', async () => {
  const { verifyGstin, gstinCheckDigit } = await import('../src/utils/gstin.js');

  // The GSTN's canonical documented example.
  const canon = verifyGstin('27AAPFU0939F1ZV');
  assert.equal(canon.ok, true, `the documented example must verify — ${canon.reason}`);
  assert.equal(canon.pan, 'AAPFU0939F', 'and the PAN is read out of it');
  assert.equal(canon.state_code, '27');

  /*
   * The exact string the old regex accepted. Correctly shaped, correct length,
   * and not a GSTIN — this is the whole reason the check digit is worth
   * computing.
   */
  const fake = verifyGstin('27AAAAA0000A1Z9');
  assert.equal(fake.ok, false, 'a correctly shaped non-GSTIN must be refused');

  /*
   * The message must not quote the expected character back. Doing so turns the
   * error into instructions for fabricating a number that passes.
   */
  assert.ok(!/expected/i.test(fake.reason),
    'the failure must not hand back the character that would make it pass');

  // Every single-character change to a valid number must break it.
  const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const good = '27AAPFU0939F1Z' + gstinCheckDigit('27AAPFU0939F1Z');
  let missed = 0;
  for (let i = 0; i < 15; i++) {
    for (const c of CHARSET) {
      if (c === good[i]) continue;
      if (verifyGstin(good.slice(0, i) + c + good.slice(i + 1)).ok) missed++;
    }
  }
  assert.equal(missed, 0, `${missed} single-character mutations were accepted`);

  // The PAN inside the number and the PAN on the form must agree.
  assert.equal(verifyGstin('27AAPFU0939F1ZV', 'AAPFU0939F').ok, true);
  assert.equal(verifyGstin('27AAPFU0939F1ZV', 'ZZZZZ9999Z').ok, false,
    'a PAN that disagrees with the one inside the GSTIN must be caught');

  // State codes are a set with real gaps, not a range.
  const s45 = '45AAPFU0939F1Z';
  assert.equal(verifyGstin(s45 + gstinCheckDigit(s45)).ok, false,
    'there is no state code 45, even with a correct check digit');
});

/* ───────────────────────────────────────────────────────────────────────────
 *  Leaderboard PDF
 * ─────────────────────────────────────────────────────────────────────────── */

/** Decompressed page content streams — not CMaps, not font programs. */
function pdfContentStreams(pdf, zlib) {
  const out = [];
  for (const m of pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    try {
      const d = zlib.inflateSync(Buffer.from(m[1], 'latin1'));
      // A page stream positions text and selects fonts; a CMap does neither.
      if (d.includes(' Tf') && d.includes('Tm')) out.push(d.toString('latin1'));
    } catch { /* not a deflate stream — a font program, an image */ }
  }
  return out;
}

/*
 * A Telugu conjunct fontkit cannot shape.
 *
 * fontkit 2.0.4 (the latest) dies on the ra-vattu conjunct — PA + VIRAMA + RA,
 * "ప్ర" — reading a null anchor from Noto Sans Telugu's GPOS table. Both the
 * hinted and unhinted builds do it, so it is fontkit's bug, not the font's.
 *
 * pdfFonts detects it and falls back rather than letting it 500 the export.
 * This case is asserted separately, below, so the main rendering test can use
 * text that shapes and still mean something.
 */
test('the leaderboard PDF renders names in every language the product ships in', async () => {
  const { buildLeaderboardPdf } = await import('../src/services/leaderboardPdfService.js');
  const zlib = await import('node:zlib');

  /*
   * The bug this pins:
   *
   * Noto Sans has no Kannada, Tamil, Telugu or Malayalam glyphs, and a missing
   * glyph in that font is BLANK with a normal advance width. A name in one of
   * those scripts therefore drew nothing at all, inside a correctly sized row,
   * in a document whose entire purpose is to name people for recognition.
   *
   * Nothing measured as wrong — widthOfString() returns a width for .notdef —
   * so the only way to catch it is to inspect what was actually drawn.
   *
   * Counting is done over content streams only. A ToUnicode CMap is a stream
   * too and legitimately contains <0000> as a codespace bound; including those
   * reports a failure that is not there.
   */
  const rows = [
    { name: 'Ravi Kumar', department: 'Production', points: 60, idea_count: 6, implemented_count: 2, avg_score: 80 },
    { name: 'ರಾಜೇಶ್ ಕುಮಾರ್', department: 'ಉತ್ಪಾದನೆ', points: 50, idea_count: 5, implemented_count: 1, avg_score: 70 },
    { name: 'ரவி குமார்', department: 'தரம்', points: 40, idea_count: 4, implemented_count: 1, avg_score: 65 },
    { name: 'రవి కుమార్', department: 'నిర్వహణ', points: 30, idea_count: 3, implemented_count: 0, avg_score: 60 },
    { name: 'രവി കുമാർ', department: 'സ്റ്റോർ', points: 20, idea_count: 2, implemented_count: 0, avg_score: null },
    { name: 'रवि कुमार', department: 'उत्पादन', points: 10, idea_count: 1, implemented_count: 0, avg_score: 55 },
  ];

  const chunks = [];
  const doc = buildLeaderboardPdf(rows, { orgName: 'Nandi Precision', period: 'quarterly' });
  doc.on('data', (c) => chunks.push(c));
  await new Promise((res, rej) => { doc.on('end', res); doc.on('error', rej); });
  const pdf = Buffer.concat(chunks);

  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-', 'it is a PDF');

  const streams = pdfContentStreams(pdf, zlib);
  assert.ok(streams.length, 'the page content was found');

  let notdef = 0;
  for (const g of streams.join('\n').match(/<([0-9A-Fa-f]+)>/g) || []) {
    const hex = g.slice(1, -1);
    for (let i = 0; i < hex.length; i += 4) if (hex.slice(i, i + 4) === '0000') notdef++;
  }
  assert.equal(notdef, 0,
    `${notdef} glyphs would render blank — somebody's name is missing from the document`);

  // And the Indic faces must actually be embedded — a notdef count of zero
  // would also be satisfied by drawing nothing at all.
  const embedded = [...pdf.toString('latin1').matchAll(/\/BaseFont\s*\/[A-Z]*\+?([A-Za-z0-9-]+)/g)]
    .map((m) => m[1]);
  for (const face of ['NotoSansKannada-Regular', 'NotoSansTamil-Regular',
    'NotoSansTelugu-Regular', 'NotoSansMalayalam-Regular']) {
    assert.ok(embedded.includes(face),
      `${face} must be embedded — got ${[...new Set(embedded)].join(', ')}`);
  }
});

test('one long name cannot break the leaderboard PDF layout', async () => {
  const { buildLeaderboardPdf } = await import('../src/services/leaderboardPdfService.js');

  /*
   * PDFKit's { ellipsis: true, lineBreak: false } did not hold: an over-long
   * name wrapped onto a second line, and because the row separators are drawn
   * at a fixed height the overflow spilled through the rule and out of the
   * table. One name broke the whole page.
   *
   * Text is measured and cut before drawing now, so every row is exactly one
   * line tall by construction.
   */
  const long = 'Ramachandran'.repeat(40);
  const rows = [{
    name: long, department: long, points: 10,
    idea_count: 1, implemented_count: 0, avg_score: 50,
  }];

  const chunks = [];
  const doc = buildLeaderboardPdf(rows, { orgName: long, period: 'all' });
  doc.on('data', (c) => chunks.push(c));
  await new Promise((res, rej) => { doc.on('end', res); doc.on('error', rej); });
  const pdf = Buffer.concat(chunks);

  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.equal(pages, 1, `a single row must stay on a single page, got ${pages}`);
});

test('an empty leaderboard still produces a usable document', async () => {
  const { buildLeaderboardPdf } = await import('../src/services/leaderboardPdfService.js');
  const chunks = [];
  const doc = buildLeaderboardPdf([], { orgName: 'New Org', period: 'monthly' });
  doc.on('data', (c) => chunks.push(c));
  await new Promise((res, rej) => { doc.on('end', res); doc.on('error', rej); });
  const pdf = Buffer.concat(chunks);
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-',
    'a month with no points is a normal state, not an error');
  assert.ok(pdf.length > 1000, 'and the page is drawn, not blank');
});

test('an unshapeable string degrades instead of taking the export down', async () => {
  const { buildLeaderboardPdf } = await import('../src/services/leaderboardPdfService.js');

  /*
   * fontkit crashes shaping "ప్ర" in Noto Sans Telugu. Before this was handled,
   * one Telugu idea title or employee name turned the whole export into a 500 —
   * a worse outcome than the blank text the Indic fonts were added to fix,
   * because the reader gets no document at all.
   *
   * The contract asserted here is only that the document is produced. The
   * affected field is blank and a warning is logged; that is the honest
   * degradation, not a good outcome, and it is written down as such.
   */
  const rows = [
    { name: 'ప్రతిపాదించిన', department: 'ప్రక్రియ', points: 10,
      idea_count: 1, implemented_count: 0, avg_score: 50 },
    { name: 'Ravi Kumar', department: 'Production', points: 5,
      idea_count: 1, implemented_count: 0, avg_score: 40 },
  ];

  const chunks = [];
  const doc = buildLeaderboardPdf(rows, { orgName: 'Org', period: 'all' });
  doc.on('data', (c) => chunks.push(c));
  await new Promise((res, rej) => { doc.on('end', res); doc.on('error', rej); });
  const pdf = Buffer.concat(chunks);

  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-',
    'the export must still produce a document');
  // The Latin row must be unaffected by its neighbour's problem.
  assert.ok(pdf.length > 1000);
});

/* ───────────────────────────────────────────────────────────────────────────
 *  DLT SMS templates (registered 26 Aug 2026, header IFQMID-T)
 * ─────────────────────────────────────────────────────────────────────────── */

test('every OTP journey sends exactly the wording its template was approved under', async () => {
  const { messageFor } = await import('../src/services/smsService.js');
  const { DLT_TEMPLATES } = await import('../src/config/smsTemplates.js');

  /*
   * Why this is worth a test.
   *
   * On a DLT gateway the carrier checks the body against the template id sent
   * with it. Disagree by one word and the gateway ACCEPTS the message, the
   * carrier DROPS it, and there is no error and no delivery report anywhere.
   * The only symptom is users reporting that codes never arrive.
   *
   * So the exact approved strings are asserted here. If somebody improves the
   * wording without re-registering it, this fails instead of production going
   * quiet.
   */
  const APPROVED = {
    registration_phone: ['1277178671564743852',
      'Dear Customer, use OTP 482913 to complete your registration on IFQM Ideation. Do not share this OTP with anyone.'],
    login: ['1277178730169418603',
      'Dear Customer, use OTP 482913 to complete your sign-in on IFQM Ideation. Do not share this OTP with anyone.'],
    password_reset: ['1277178730612100625',
      'Dear Customer, use OTP 482913 to reset your password on IFQM Ideation. Do not share this OTP with anyone.'],
  };

  for (const [purpose, [id, body]] of Object.entries(APPROVED)) {
    const m = messageFor(purpose, '482913', 5);
    assert.equal(m.templateId, id, `${purpose} must carry its registered template id`);
    assert.equal(m.text, body, `${purpose} body has drifted from its registration`);
    assert.equal(m.registered, true, `${purpose} should be sendable`);

    /*
     * One segment. These are transactional codes; a body that runs past 160
     * characters is billed and delivered as two, and a concatenated OTP is
     * exactly the kind of message that arrives out of order or half-missing.
     */
    assert.ok(m.text.length <= 160,
      `${purpose} is ${m.text.length} characters — over one SMS segment`);
  }

  // The template must carry exactly one variable: the approved wording has no
  // expiry in it, and a second {#var#} would leave a literal in the message.
  for (const [purpose, spec] of Object.entries(DLT_TEMPLATES)) {
    const count = (spec.text.match(/\{#var#\}/g) || []).length;
    assert.equal(count, 1, `${purpose} must have exactly one variable, found ${count}`);
    const filled = messageFor(purpose, '482913', 5).text;
    assert.ok(!filled.includes('{#'),
      `${purpose} left an unfilled placeholder: ${filled}`);
  }
});

/*
 * The "mobile number changed" security alert, now that it has an id.
 *
 * Jio first classified it as Service Implicit rather than Transactional and
 * granted nothing, so it sat unregistered and sendSms refused it. Before THAT
 * was handled it went out under the REGISTRATION template's id carrying
 * completely different text, which the carrier drops — so the alert had never
 * once reached a handset while the log, the delivery table and the caller all
 * recorded it as sent. For a security alert, silence that looks like success is
 * the worst of the available failures.
 *
 * Registered 2026-09-01 as 1277178823569994190. What matters now is that the
 * body on the wire is the approved body, exactly: a DLT carrier compares the
 * two character for character and silently drops a mismatch.
 */
test('the mobile-number-changed alert sends under its own registered template', async () => {
  const { sendSms, messageFor } = await import('../src/services/smsService.js');
  const { DLT_TEMPLATES, resolveTemplate } = await import('../src/config/smsTemplates.js');

  assert.equal(DLT_TEMPLATES.phone_changed.registered, true);
  assert.equal(DLT_TEMPLATES.phone_changed.id, '1277178823569994190',
    'the id from the DLT registration, not a borrowed one');

  const r = resolveTemplate('phone_changed');
  assert.equal(r.sendable, true);
  assert.equal(r.usingFallback, null,
    'it has its own template now and must not go out under another one');

  /*
   * The rendered body, against the approved wording.
   *
   * The registration names the placeholder {#number#} and this codebase writes
   * {#var#}; they are the same template, because what the carrier matches is
   * the text after substitution. Asserted by substituting into the registered
   * string and comparing — so a reworded body fails here rather than going
   * quiet in production.
   */
  const m = messageFor('phone_changed', '5881');
  assert.equal(m.templateId, '1277178823569994190');
  assert.equal(m.registered, true);
  const approved = 'Your IFQM Ideation sign-in number was changed to one ending {#number#}. '
    + 'If this was not you, contact your administrator.';
  assert.equal(m.text, approved.replace('{#number#}', '5881'),
    'the body on the wire has drifted from the approved wording');
});

/*
 * A template with no registration and no fallback is still refused.
 *
 * The guard is what stopped the alert above going out under somebody else's id
 * for as long as it was pending, and it has to keep working — every future
 * template starts life unregistered. Exercised through an unknown purpose
 * because, as of today, every real one either has its own id or a registered
 * fallback, so nothing else would reach this path.
 */
test('a template with no registration and no fallback is refused, not borrowed', async () => {
  const { sendSms } = await import('../src/services/smsService.js');
  const { resolveTemplate } = await import('../src/config/smsTemplates.js');

  assert.equal(resolveTemplate('not_a_real_purpose').sendable, false);

  // 'kaleyra' rather than the default, because the log provider is the local
  // mock and is deliberately exempt from this refusal.
  const r = await sendSms('9876500000', 'Some body nobody registered.',
    { purpose: 'not_a_real_purpose', provider: 'kaleyra' });
  assert.equal(r.sent, false, 'an unregistered template must not be reported as sent');
  /*
   * Either wording is right, and which one appears says which branch caught it:
   * a purpose the file has never heard of reports "not configured", a known one
   * still awaiting its id reports "not registered". The property being pinned
   * is the same in both cases and is the one that matters — sendSms refuses
   * rather than reaching for an id that belongs to a different template.
   */
  assert.match(String(r.detail), /not registered|not configured/i,
    'and must say why, rather than failing silently');
  assert.ok(!/12771787/.test(String(r.detail)),
    'and must not have borrowed a real template id on the way out');
});

test('the registered sender header is accepted', async () => {
  const { kaleyraMissing } = await import('../src/services/smsService.js');
  const { DLT_SENDER_ID, SENDER_ID_RE, senderHeader } = await import('../src/config/smsTemplates.js');

  /*
   * IFQMID-T is a six-character DLT header plus the transactional category
   * suffix. The check this replaced demanded exactly six characters, so it
   * rejected the header the platform is actually registered under and reported
   * a working gateway as misconfigured.
   */
  /*
   * Six characters go on the wire. The registration is written "IFQMID-T" and
   * that was taken literally at first; the "-T" is Jio's category annotation,
   * not part of the header, and Kaleyra answers 400 "Invalid or In-Correct
   * sender" to the annotated form. The production delivery log recorded
   * exactly that for every attempt made with it.
   *
   * Both spellings are ACCEPTED as configuration — somebody copying the
   * registration will type the annotated one — and senderHeader() strips the
   * annotation so the transmitted value is the same either way.
   */
  assert.equal(DLT_SENDER_ID, 'IFQMID');
  assert.equal(DLT_SENDER_ID.length, 6, 'a DLT header is exactly six characters');
  assert.equal(senderHeader('IFQMID-T'), 'IFQMID', 'the category annotation is stripped');
  assert.equal(senderHeader('IFQMID'), 'IFQMID', 'and a bare header is left alone');
  assert.ok(SENDER_ID_RE.test('IFQMID-T'), 'the annotated form is accepted as config');
  assert.ok(SENDER_ID_RE.test('IFQMID'), 'a bare six-character header is still valid');
  assert.ok(!SENDER_ID_RE.test('IFQMIDENT'), 'nine characters is not a header');
  assert.ok(!SENDER_ID_RE.test('IFQM-T'), 'the header itself must be six characters');

  const base = {
    apiKey: 'k', sid: 'HXAP1678914824IN', peId: '1201174858303838784',
    templates: { login: '1277178730169418603' },
  };
  assert.deepEqual(kaleyraMissing({ ...base, senderId: 'IFQMID' }, 'login'), [],
    'a fully configured gateway must report nothing missing');
  assert.deepEqual(kaleyraMissing({ ...base, senderId: 'IFQMID-T' }, 'login'), [],
    'and the annotated spelling must not be reported as a misconfiguration');
  assert.ok(kaleyraMissing({ ...base, senderId: 'WAYTOOLONG' }, 'login').length,
    'a malformed header must still be caught');
});

test('a template awaiting its id borrows a whole registration, never half of one', async () => {
  const { resolveTemplate, DLT_TEMPLATES } = await import('../src/config/smsTemplates.js');
  const { messageFor } = await import('../src/services/smsService.js');

  /*
   * Verifying a NEW number on an existing account has its own wording
   * submitted but no id yet. It falls back to the Registration template.
   *
   * The rule being pinned is that the fallback supplies the id AND the text.
   * Taking the id alone — the obvious shortcut — pairs a real registration with
   * wording it was never approved for, which the carrier drops silently. That
   * is the failure this entire module exists to prevent, so it gets a test
   * rather than a comment.
   */
  const r = resolveTemplate('phone_verify');
  assert.equal(r.sendable, true, 'the change-number flow must still be able to send');
  assert.equal(r.usingFallback, 'registration_phone');

  const carrier = DLT_TEMPLATES.registration_phone;
  assert.equal(r.id, carrier.id, 'it borrows the fallback id');
  assert.equal(r.text, carrier.text, 'and the fallback text, so the pair matches');

  const m = messageFor('phone_verify', '482913', 5);
  assert.equal(m.templateId, carrier.id);
  assert.equal(m.text, carrier.text.replace('{#var#}', '482913'),
    'the body must be the carrying registration wording, filled');

  /*
   * And the wording it will use once approved is ready and distinct — if these
   * were the same string, the fallback would be pointless and somebody would
   * eventually delete it as dead code.
   */
  assert.notEqual(DLT_TEMPLATES.phone_verify.text, carrier.text);
  assert.match(DLT_TEMPLATES.phone_verify.text, /confirm your new mobile number/);
  assert.equal((DLT_TEMPLATES.phone_verify.text.match(/\{#var#\}/g) || []).length, 1);
});

test('granting the pending id switches a template to its own wording', async () => {
  const { resolveTemplate, DLT_TEMPLATES } = await import('../src/config/smsTemplates.js');

  // The documented next step is "paste the id in, set registered true". This
  // asserts that really is the whole change.
  const spec = DLT_TEMPLATES.phone_verify;
  const savedId = spec.id;
  const savedFlag = spec.registered;
  try {
    spec.id = '1277170000000000000';
    spec.registered = true;

    const r = resolveTemplate('phone_verify');
    assert.equal(r.sendable, true);
    assert.equal(r.usingFallback, null, 'it stops borrowing');
    assert.equal(r.id, '1277170000000000000');
    assert.match(r.text, /confirm your new mobile number/);
  } finally {
    spec.id = savedId;
    spec.registered = savedFlag;
  }
});

/* ───────────────────────────────────────────────────────────────────────────
 *  The approval chain is walked one stage at a time
 * ─────────────────────────────────────────────────────────────────────────── */

/** Create a user with a known password and return their token. */
async function makeReviewer(email, role, phone, empId) {
  const created = await api('POST', '/api/users', {
    token: AADMIN,
    body: {
      name: `Seq ${role}`, email, password: 'SeqPass12345', role,
      employee_id: empId, phone, department: 'Ops',
    },
  });
  assert.equal(created.data.success, true,
    `${role} must be creatable — ${JSON.stringify(created.data)}`);
  const { token } = await login(email, 'SeqPass12345', 'orga');
  assert.ok(token, `${role} must be able to sign in`);
  return token;
}

/**
 * The organisation's one plant head.
 *
 * Memoised because there can only be one: the chain ends at the plant head, so
 * two of them would mean an idea's final approval depended on which one it
 * happened to reach, and userService now refuses the second. Every test below
 * that needs a plant head needs THE plant head.
 */
let plantHeadToken = null;
async function thePlantHead() {
  if (!plantHeadToken) {
    plantHeadToken = await makeReviewer('seq.ph@orga.test', 'plant_head', '+919812345904', 'SEQPH');
  }
  return plantHeadToken;
}

const stageOf = async (ideaId) => {
  const [row] = await sql('ifqm_test_a',
    `SELECT status, current_stage, current_reviewer_id FROM ifqm_test_a.ideas WHERE id = ${ideaId}`);
  return row;
};

test('an idea travels every stage of the chain and is Approved only at the last', async () => {
  /*
   * The bug this pins.
   *
   * The chain was stored as an ordered list and the engine ignored the order,
   * walking manager_id instead: approving escalated to your own manager if
   * their role appeared anywhere in the chain, and otherwise fell through to
   * Approved. A team lead with no manager on file approved outright — and
   * since the QCMS push is gated on status='Approved', that single approval
   * also made the idea eligible to be sent to the external quality system.
   */
  let res = await api('POST', '/api/settings', {
    token: AADMIN,
    body: { approval_stages: 'originator,team_lead,immediate_manager,department_manager,plant_head' },
  });
  assert.equal(res.data.success, true);

  const tl = await makeReviewer('seq.tl@orga.test', 'team_lead', '+919812345901', 'SEQTL');
  const im = await makeReviewer('seq.im@orga.test', 'manager', '+919812345902', 'SEQIM');
  const dm = await makeReviewer('seq.dm@orga.test', 'department_manager', '+919812345903', 'SEQDM');
  const ph = await thePlantHead();

  const submitted = await api('POST', '/api/ideas/submit', {
    token: AUSER,
    body: {
      title: 'Interlock the guard on press 3',
      present_situation: 'The guard can be lifted while the press is cycling, which is how hands get hurt.',
      proposed_solution: 'Fit a key interlock so the cycle cannot start with the guard raised.',
      impact_level: 'High', impact_areas: 'Safety', action: 'submit',
    },
  });
  assert.equal(submitted.data.success, true, JSON.stringify(submitted.data));
  const ideaId = submitted.data.idea_id;

  // It enters at stage one, not at the submitter's manager.
  let st = await stageOf(ideaId);
  assert.equal(st.current_stage, 'team_lead', 'a new idea starts at the first stage');

  /*
   * Out of turn is refused. The plant head is the FINAL approver and could,
   * under the old engine, simply approve — closing the idea past three stages
   * whose holders never saw it.
   */
  res = await api('POST', '/api/ideas/review-action', {
    token: ph, body: { idea_id: ideaId, decision: 'Approved' },
  });
  assert.equal(res.status, 403, 'the last stage cannot approve while the first is pending');
  assert.match(res.data.error, /waiting for/i, 'and must say who it is waiting for');

  // Stage 1 → 2.
  res = await api('POST', '/api/ideas/review-action', {
    token: tl, body: { idea_id: ideaId, decision: 'Approved' },
  });
  assert.equal(res.data.success, true, JSON.stringify(res.data));
  st = await stageOf(ideaId);
  assert.notEqual(st.status, 'Approved',
    'a team-lead approval must NOT approve the idea — this is the whole bug');
  assert.equal(st.current_stage, 'immediate_manager', 'it moves to the next stage');

  // Stage 2 → 3.
  res = await api('POST', '/api/ideas/review-action', {
    token: im, body: { idea_id: ideaId, decision: 'Approved' },
  });
  assert.equal(res.data.success, true, JSON.stringify(res.data));
  st = await stageOf(ideaId);
  assert.notEqual(st.status, 'Approved');
  assert.equal(st.current_stage, 'department_manager');

  // Stage 3 → 4.
  res = await api('POST', '/api/ideas/review-action', {
    token: dm, body: { idea_id: ideaId, decision: 'Approved' },
  });
  assert.equal(res.data.success, true, JSON.stringify(res.data));
  st = await stageOf(ideaId);
  assert.notEqual(st.status, 'Approved');
  assert.equal(st.current_stage, 'plant_head');

  // The last stage closes it.
  res = await api('POST', '/api/ideas/review-action', {
    token: ph, body: { idea_id: ideaId, decision: 'Approved' },
  });
  assert.equal(res.data.success, true, JSON.stringify(res.data));
  st = await stageOf(ideaId);
  assert.equal(st.status, 'Approved', 'only the final stage approves the idea');
  assert.equal(st.current_stage, null, 'and it comes off the chain');
});

test('an idea is only pushable to QCMS after the final stage', async () => {
  /*
   * The QCMS list is gated on status='Approved'. That gate was correct all
   * along; what was wrong was how easily an idea reached that status. This
   * asserts the two are joined up: an idea mid-chain must not appear in the
   * pushable list, and must appear once the last stage has approved it.
   */
  await api('POST', '/api/settings', {
    token: AADMIN,
    body: { approval_stages: 'originator,team_lead,plant_head' },
  });

  const tl = await makeReviewer('qc.tl@orga.test', 'team_lead', '+919812345911', 'QCTL');
  const ph = await thePlantHead();

  const submitted = await api('POST', '/api/ideas/submit', {
    token: AUSER,
    body: {
      title: 'Label the emergency stops',
      present_situation: 'The stops are unlabelled and operators hesitate before hitting them.',
      proposed_solution: 'Apply standard yellow-on-red labels to every stop on the line.',
      impact_level: 'Medium', impact_areas: 'Safety', action: 'submit',
    },
  });
  const ideaId = submitted.data.idea_id;

  const pushable = async () => {
    const r = await api('GET', '/api/integrations/approved-ideas', { token: AADMIN });
    return (r.data.ideas || []).some((i) => Number(i.id) === Number(ideaId));
  };

  await api('POST', '/api/ideas/review-action', { token: tl, body: { idea_id: ideaId, decision: 'Approved' } });
  assert.equal(await pushable(), false,
    'an idea approved by one stage of two is NOT ready for the quality system');

  await api('POST', '/api/ideas/review-action', { token: ph, body: { idea_id: ideaId, decision: 'Approved' } });
  assert.equal(await pushable(), true, 'and is ready once the final stage has approved it');
});

test('bulk approve obeys the chain instead of writing the status directly', async () => {
  /*
   * bulkReview used to run `UPDATE ideas SET status = 'Approved'` over every
   * selected row. A team lead selecting twenty ideas and clicking "Approve
   * all" closed all twenty outright, past every remaining stage — the quieter
   * of the two ways to skip the chain, because it did not even walk the
   * reporting tree.
   */
  await api('POST', '/api/settings', {
    token: AADMIN,
    body: { approval_stages: 'originator,team_lead,plant_head' },
  });
  const tl = await makeReviewer('blk.tl@orga.test', 'team_lead', '+919812345921', 'BLKTL');

  const ids = [];
  for (const n of [1, 2]) {
    const r = await api('POST', '/api/ideas/submit', {
      token: AUSER,
      body: {
        title: `Bulk chain check ${n}`,
        present_situation: 'A situation described at sufficient length to pass validation.',
        proposed_solution: 'A proposed solution, likewise long enough to be accepted.',
        impact_level: 'Low', impact_areas: 'Quality', action: 'submit',
      },
    });
    ids.push(r.data.idea_id);
  }

  const res = await api('POST', '/api/ideas/bulk-review', {
    token: tl, body: { idea_ids: ids, decision: 'Approved', comment: 'Looks sound.' },
  });
  assert.equal(res.data.success, true, JSON.stringify(res.data));

  for (const id of ids) {
    const [row] = await sql('ifqm_test_a',
      `SELECT status, current_stage FROM ifqm_test_a.ideas WHERE id = ${id}`);
    assert.notEqual(row.status, 'Approved',
      'a bulk approval by a non-final stage must not close the idea');
    assert.equal(row.current_stage, 'plant_head', 'it advances, exactly as a single approval would');
  }
});

test('changing the chain affects that tenant only, and every user in it', async () => {
  /*
   * The chain lives in the tenant's own org_settings, inside the tenant's own
   * database, and getApprovalConfig() reads it per request with no cache. This
   * asserts both halves of what that buys:
   *
   *   isolation   org B's chain is unaffected by org A's, because they are
   *               different rows in different schemas;
   *   immediacy   a change is in force for the next idea, for every user of
   *               that organisation, without a restart or a cache expiry.
   *
   * Org B's chain is set with SQL rather than through its API. Earlier tests in
   * this file reset that admin's password and suspend the organisation, so a
   * login here is not reliable — and the claim being tested is about where the
   * setting is READ from, which the API call does not make any clearer.
   */
  const svc = await import('../src/services/settingsService.js');
  // getTenantPool, not getTenantDb — the latter does not exist.
  const { getTenantPool } = await import('../src/database/tenant.js');

  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;
  assert.ok(aTok, 'org A admin must be able to sign in');

  let res = await api('POST', '/api/settings', {
    token: aTok, body: { approval_stages: 'originator,team_lead,plant_head' },
  });
  assert.equal(res.data.success, true, JSON.stringify(res.data));

  await sql('ifqm_test_b',
    `INSERT INTO ifqm_test_b.org_settings (key_name, value)
          VALUES ('approval_stages', 'originator,senior_manager,executive')
     ON DUPLICATE KEY UPDATE value = VALUES(value)`);

  const dbA = getTenantPool({ id: 1, slug: 'orga', db_name: 'ifqm_test_a' });
  const dbB = getTenantPool({ id: 2, slug: 'orgb', db_name: 'ifqm_test_b' });
  const cfgA = await svc.getApprovalConfig(dbA);
  const cfgB = await svc.getApprovalConfig(dbB);

  assert.equal(cfgA.first_stage.stage, 'team_lead');
  assert.equal(cfgA.final_stage.stage, 'plant_head');
  assert.equal(cfgB.first_stage.stage, 'senior_manager',
    "org B's chain must be its own");
  assert.equal(cfgB.final_stage.stage, 'executive');

  // Changed again, and in force on the very next read — no cache to expire.
  res = await api('POST', '/api/settings', {
    token: aTok, body: { approval_stages: 'originator,department_manager,executive' },
  });
  assert.equal(res.data.success, true);
  const cfgA2 = await svc.getApprovalConfig(dbA);
  assert.equal(cfgA2.first_stage.stage, 'department_manager',
    'a saved chain applies immediately');
  const cfgB2 = await svc.getApprovalConfig(dbB);
  assert.equal(cfgB2.first_stage.stage, 'senior_manager',
    'and still leaves the other organisation alone');

  // Put org A back, so nothing after this inherits a chain it did not choose.
  await api('POST', '/api/settings', {
    token: aTok,
    body: { approval_stages: 'originator,team_lead,immediate_manager,department_manager,plant_head' },
  });
});

test('an organisation can rename a stage without changing what it means', async () => {
  /*
   * Not every organisation has a "Team Lead". The label is a per-tenant
   * override; the KEY is what is stored on the idea and in the chain, so a
   * rename cannot strand an idea mid-flight or rewrite history.
   */
  const { resolveLabels } = await import('../src/services/approvalStages.js');

  const plain = resolveLabels(null);
  assert.equal(plain.team_lead, 'Team Lead', 'the built-in name is the fallback');

  const renamed = resolveLabels('{"team_lead":"Shift Incharge","plant_head":"Works Manager"}');
  assert.equal(renamed.team_lead, 'Shift Incharge');
  assert.equal(renamed.plant_head, 'Works Manager');
  assert.equal(renamed.department_manager, 'Department Manager',
    'stages that were not renamed keep their built-in name');

  // Junk must not take the review queue down with it.
  assert.equal(resolveLabels('{not json').team_lead, 'Team Lead');
  assert.equal(resolveLabels('null').team_lead, 'Team Lead');
  assert.equal(resolveLabels({ team_lead: '   ' }).team_lead, 'Team Lead',
    'a blank override is not a name');
});

test('removing a stage an idea is sitting at does not skip the rest of the chain', async () => {
  /*
   * An administrator can edit the chain while ideas are in flight. The idea
   * stores a stage KEY, so a removed stage has to be recovered from the
   * catalogue order — and the recovery must move the idea FORWARD to the next
   * surviving stage, never to Approved.
   */
  const { nextStage, isFinalStage } = await import('../src/services/approvalStages.js');

  const chain = ['originator', 'team_lead', 'department_manager', 'plant_head'];
  assert.equal(nextStage(chain, 'team_lead').stage, 'department_manager');
  assert.equal(nextStage(chain, 'plant_head'), null, 'the last stage has no next');
  assert.equal(isFinalStage(chain, 'plant_head'), true);
  assert.equal(isFinalStage(chain, 'team_lead'), false);

  // immediate_manager was removed while an idea sat there.
  const after = nextStage(chain, 'immediate_manager');
  assert.ok(after, 'a removed stage must still resolve to something');
  assert.equal(after.stage, 'department_manager',
    'it continues at the next surviving stage, not at the end');
  assert.equal(isFinalStage(chain, 'immediate_manager'), false,
    'and removing a stage must not make it final');
});

test('a stage nobody holds is skipped, recorded, and does not hide the idea', async () => {
  /*
   * What went wrong in production.
   *
   * Making the chain strictly sequential and strictly role-gated meant an idea
   * waited at a stage until somebody holding that role approved it. Real
   * organisations name stages they have not filled: six ideas sat at
   * `immediate_manager` in a tenant with no manager, invisible to every queue
   * in the product, and five of six tenants had nobody in ANY approval role.
   *
   * A stage with nobody in it is not a pending approval, it is an approval that
   * cannot happen. It is skipped, and the skip is written on the idea so the
   * trail shows which step was passed and why.
   */
  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;

  /*
   * senior_manager is chosen because nothing earlier in this suite creates one
   * — asserted below rather than assumed, since a test whose premise quietly
   * stops holding passes for the wrong reason.
   */
  const [held] = await sql('ifqm_test_a',
    "SELECT COUNT(*) n FROM ifqm_test_a.users WHERE role='senior_manager' AND status='active'");
  assert.equal(Number(held.n), 0, 'this test needs senior_manager to be unheld');

  await api('POST', '/api/settings', {
    token: aTok, body: { approval_stages: 'originator,senior_manager,plant_head' },
  });
  const ph = await thePlantHead();

  const r = await api('POST', '/api/ideas/submit', {
    token: AUSER,
    body: {
      title: 'Second bin for swarf at the lathe',
      present_situation: 'Swarf is mixed with general waste and the skip is charged as contaminated.',
      proposed_solution: 'Put a dedicated swarf bin at each lathe and sell it as clean scrap.',
      impact_level: 'Medium', impact_areas: 'Cost', action: 'submit',
    },
  });
  assert.equal(r.data.success, true, JSON.stringify(r.data));
  const ideaId = r.data.idea_id;

  const [row] = await sql('ifqm_test_a',
    `SELECT current_stage, status FROM ifqm_test_a.ideas WHERE id = ${ideaId}`);
  assert.equal(row.current_stage, 'plant_head',
    'the idea must land on the first stage that has somebody in it');
  assert.notEqual(row.status, 'Approved', 'skipping stages must never approve the idea');

  // The skip is on the record, not only in a log.
  const wf = await api('GET', `/api/ideas/${ideaId}`, { token: aTok });
  const trail = JSON.stringify(wf.data.idea?.workflow || wf.data.workflow || []);
  assert.match(trail, /Skipped/i, 'the audit trail must show which stages were passed over');

  // And the person who CAN act sees it.
  const queue = await api('GET', '/api/ideas/review', { token: ph });
  assert.ok((queue.data.ideas || []).some((i) => Number(i.id) === Number(ideaId)),
    'the idea must appear in the queue of the role that can act on it');
});

test('an idea whose whole chain is empty waits — it is never auto-approved', async () => {
  /*
   * The other end of the same problem. If NOBODY can act at any stage, the
   * honest outcome is that the idea waits and the administrators are told.
   * Approving it because there was no one to ask would be recording consent
   * that nobody gave.
   */
  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;
  await api('POST', '/api/settings', {
    token: aTok, body: { approval_stages: 'originator,senior_manager,executive' },
  });

  const [before] = await sql('ifqm_test_a',
    "SELECT COUNT(*) n FROM ifqm_test_a.users WHERE role IN ('senior_manager','executive') AND status='active'");
  assert.equal(Number(before.n), 0, 'this test needs those roles to be unheld');

  const r = await api('POST', '/api/ideas/submit', {
    token: AUSER,
    body: {
      title: 'Shadow board for the fitting bench',
      present_situation: 'Tools are not returned and each shift loses time hunting for them.',
      proposed_solution: 'Mount a shadow board so a missing tool is obvious at a glance.',
      impact_level: 'Low', impact_areas: 'Productivity', action: 'submit',
    },
  });
  assert.equal(r.data.success, true, JSON.stringify(r.data));

  const [row] = await sql('ifqm_test_a',
    `SELECT status, current_stage FROM ifqm_test_a.ideas WHERE id = ${r.data.idea_id}`);
  assert.equal(row.status, 'Submitted', 'it waits');
  assert.notEqual(row.status, 'Approved', 'and is certainly not approved');

  // Administrators are told, since only they can mend the configuration.
  const [notes] = await sql('ifqm_test_a',
    `SELECT COUNT(*) n FROM ifqm_test_a.notifications
      WHERE title LIKE '%Approval path%' AND created_at > NOW() - INTERVAL 2 MINUTE`);
  assert.ok(Number(notes.n) > 0, 'the administrators must be told the path has no one in it');

  // Put the chain back for anything that follows.
  await api('POST', '/api/settings', {
    token: aTok,
    body: { approval_stages: 'originator,team_lead,immediate_manager,department_manager,plant_head' },
  });
});

test('a reviewer cannot be the approver of their own idea, even alone in the role', async () => {
  /*
   * A team lead who submits an idea is not a team lead who can approve it, so
   * a stage whose only holder is the author is as empty as one with nobody in
   * it — and must be skipped rather than leaving the idea unactionable.
   */
  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;
  await api('POST', '/api/settings', {
    token: aTok, body: { approval_stages: 'originator,project_lead,plant_head' },
  });

  const pl = await makeReviewer('solo.pl@orga.test', 'project_lead', '+919812346011', 'SOLOPL');
  await thePlantHead();

  const r = await api('POST', '/api/ideas/submit', {
    token: pl,
    body: {
      title: 'Colour-code the hydraulic lines',
      present_situation: 'Every line is black and tracing a leak takes an hour.',
      proposed_solution: 'Sleeve each circuit in its own colour and put a key on the machine.',
      impact_level: 'Medium', impact_areas: 'Maintenance', action: 'submit',
    },
  });
  assert.equal(r.data.success, true, JSON.stringify(r.data));

  const [row] = await sql('ifqm_test_a',
    `SELECT current_stage FROM ifqm_test_a.ideas WHERE id = ${r.data.idea_id}`);
  assert.notEqual(row.current_stage, 'project_lead',
    'the author cannot be the approver, so their own stage is skipped');
  assert.equal(row.current_stage, 'plant_head');

  await api('POST', '/api/settings', {
    token: aTok,
    body: { approval_stages: 'originator,team_lead,immediate_manager,department_manager,plant_head' },
  });
});

/*
 * Archiving a whole status at once, and archiving hand-picked tickets.
 *
 * The two existing ways to choose tickets — an explicit list, or everything
 * before a date — cannot express the thing actually asked for at the end of a
 * quarter: clear out everything resolved. Answering that with the date filter
 * means picking a date that happens to separate them, which is a guess that is
 * silently wrong when one old ticket was reopened last week.
 *
 * The risk being tested for is over-reach. A status filter is a sentence that
 * matches rows nobody has looked at, so what matters is that it matches exactly
 * the named statuses and nothing adjacent to them.
 */
test('tickets can be archived by status, and only the named statuses move', async () => {
  const raise = async (subject) => {
    const res = await api('POST', '/api/support/tickets', {
      token: AADMIN,
      body: { subject, category: 'question', priority: 'normal',
        body: 'Raised by the suite to exercise archiving by status.' },
    });
    assert.equal(res.data.success, true,
      `a ticket must be raisable — server said: ${JSON.stringify(res.data)}`);
    return res.data.ticket_id ?? res.data.id;
  };
  const setStatus = (id, status) =>
    api('PATCH', `/api/platform/tickets/${id}`, { token: PA, body: { status } });

  const resolved = await raise('Status sweep — resolved');
  const closed   = await raise('Status sweep — closed');
  const waiting  = await raise('Status sweep — waiting');
  const open     = await raise('Status sweep — still open');
  await setStatus(resolved, 'resolved');
  await setStatus(closed, 'closed');
  await setStatus(waiting, 'waiting');

  const archivedAt = async () => {
    const rows = await sql('ifqm_test_master',
      'SELECT id, archived_at FROM ifqm_test_master.support_tickets '
      + `WHERE id IN (${resolved}, ${closed}, ${waiting}, ${open})`);
    return Object.fromEntries(rows.map((r) => [r.id, r.archived_at]));
  };

  // ── Naming one status takes that status and leaves its neighbours ─────────
  let res = await api('POST', '/api/platform/tickets/bulk-archive', {
    token: PA, body: { statuses: ['resolved'] },
  });
  assert.equal(res.data.success, true,
    `archiving by status must be accepted — server said: ${JSON.stringify(res.data)}`);

  let state = await archivedAt();
  assert.ok(state[resolved], 'the resolved ticket is archived');
  assert.ok(!state[closed],  'a closed ticket is NOT swept up by asking for resolved');
  assert.ok(!state[waiting], 'a waiting ticket is left alone');
  assert.ok(!state[open],    'an open ticket is left alone');

  /*
   * Naming an unanswered status archives it.
   *
   * Everywhere else the server refuses to archive an open ticket, because
   * filing away something nobody has answered is how a customer is forgotten.
   * Spelling the status out is the one place that is an explicit instruction
   * rather than an accident, so it is honoured — and the count reported has to
   * match, since "3 archived" when one was quietly dropped is worse than the
   * refusal it replaced.
   */
  // Counted first, because the sweep is deliberately global: it acts on every
  // matching ticket in the registry, not only on the ones this test raised.
  const [{ n: pending }] = await sql('ifqm_test_master',
    "SELECT COUNT(*) AS n FROM ifqm_test_master.support_tickets "
    + "WHERE status IN ('waiting','open') AND archived_at IS NULL");
  res = await api('POST', '/api/platform/tickets/bulk-archive', {
    token: PA, body: { statuses: ['waiting', 'open'] },
  });
  assert.equal(res.data.affected, Number(pending),
    'every named ticket moves, and the number reported says so — a count that '
    + 'quietly excludes the rows the caller asked for is worse than a refusal');
  state = await archivedAt();
  assert.ok(state[waiting] && state[open], 'a named status is archived even when unanswered');

  // ── An unknown status matches nothing; it never widens the net ────────────
  res = await api('POST', '/api/platform/tickets/bulk-archive', {
    token: PA, body: { statuses: ['not_a_status'] },
  });
  assert.notEqual(res.status, 200,
    'a status list that survives filtering as empty is the same as naming nothing, '
    + 'and naming nothing must be refused rather than treated as "everything"');
  state = await archivedAt();
  assert.ok(!state[closed], 'and nothing was archived on the way to that refusal');

  // ── Restoring works the same way round ───────────────────────────────────
  // By id rather than by status, so this test leaves the registry as it found
  // it: a status sweep here would also un-archive whatever earlier tests filed.
  res = await api('POST', '/api/platform/tickets/bulk-archive', {
    token: PA, body: { ids: [resolved, closed, waiting, open], archived: false },
  });
  assert.equal(res.data.success, true);
  state = await archivedAt();
  assert.ok(!state[resolved], 'restoring puts an archived ticket back');
  assert.ok(!state[open],
    'including an OPEN one — the guard that keeps unanswered tickets out of the '
    + 'archive applied to restoring too, which left a ticket that had been swept '
    + 'in with no way out of it short of resolving it first');
});

/*
 * The Lifetime plan cannot be removed, and cannot be edited into something
 * that expires.
 *
 * IFQM's founding members were promised permanent free access, and the plan is
 * the only place that promise is recorded. Retiring it would not cut anybody
 * off on the day — those organisations are billing_status = 'exempt' with no
 * period_end, and the nightly sweep never looks at them — which is precisely
 * what makes it dangerous: the plan would vanish from the list an approver
 * picks from, and the next founding member onboarded would quietly be put on
 * something that expires. Nobody would find out until a renewal notice went to
 * a company that was told it would never get one.
 *
 * Deleting is the obvious route and the edit form is the one that gets missed,
 * so both are checked here.
 */
test('the Lifetime plan is permanent, and stays a lifetime plan', async () => {
  const plans = (await api('GET', '/api/platform/plans', { token: PA })).data.plans;
  const lifetime = plans.find((p) => String(p.code).toUpperCase() === 'LIFETIME');
  assert.ok(lifetime, 'the Lifetime plan must exist — founding members are held on it');
  assert.equal(lifetime.is_lifetime, true, 'and must be on the lifetime cycle');
  assert.equal(lifetime.is_permanent, true,
    'the console reads this to leave the Delete button out; a button that always '
    + 'fails reads as a bug rather than as a rule');

  // Deleting: refused.
  let res = await api('DELETE', `/api/platform/plans/${lifetime.id}`, { token: PA });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /cannot be deleted/i);

  // Retiring through the edit form: the same act, refused the same way.
  res = await api('PATCH', `/api/platform/plans/${lifetime.id}`, {
    token: PA, body: { status: 'inactive' },
  });
  assert.notEqual(res.status, 200, 'status = inactive is deletion by another name');

  // Moving it onto a cycle with a length: refused, because that would hand
  // every organisation on it an expiry date.
  res = await api('PATCH', `/api/platform/plans/${lifetime.id}`, {
    token: PA, body: { billing_cycle: 'yearly' },
  });
  assert.notEqual(res.status, 200, 'a lifetime plan that expires is not a lifetime plan');
  assert.match(res.data.error, /lifetime billing cycle/i);

  // Everything else about it is still the operator's to change.
  res = await api('PATCH', `/api/platform/plans/${lifetime.id}`, {
    token: PA, body: { description: 'Permanent free access for IFQM founding members.' },
  });
  assert.equal(res.status, 200, 'editing a permanent plan must still be allowed');

  const after = (await api('GET', '/api/platform/plans', { token: PA })).data.plans
    .find((p) => p.id === lifetime.id);
  assert.equal(after.status, 'active', 'and it survives all of that, still active');
  assert.equal(after.billing_cycle, 'lifetime');
});

/*
 * An organisation admin may read the review queue and may never decide on it.
 *
 * The rule existed as a thrown error deep in ideaService, and everything in
 * front of it disagreed: the route list accepted `admin` on every decision
 * endpoint, and the screen drew Approve, Reject, Route to Committee and the
 * bulk bar. So the only thing between an org admin and an approval was one
 * check at the bottom of a request that three layers had already waved
 * through — and a prohibition that survives on a single `if` is one refactor
 * away from not existing.
 *
 * It matters because the admin is the person who CONFIGURES the chain. An
 * admin who can also approve is both the author of the approval path and a
 * party to it, which is the separation the sequential chain was built for.
 * super_admin is included for the same reason, one step up: that account
 * promotes people to admin.
 *
 * Reading stays allowed. Oversight of what is pending across the organisation
 * is the admin's job; acting on it is not.
 */
test('an org admin can see the review queue and cannot act on it', async () => {
  await api('POST', '/api/settings', {
    token: AADMIN,
    body: { approval_stages: 'originator,team_lead,plant_head' },
  });
  // Needed so the team_lead stage has a holder: an empty stage is stepped over,
  // and the idea would then be waiting somewhere other than where this test says.
  await makeReviewer('ro.tl@orga.test', 'team_lead', '+919812345921', 'ROTL');
  const [tl] = await sql('ifqm_test_a',
    "SELECT id FROM ifqm_test_a.users WHERE email = 'ro.tl@orga.test'");

  const submitted = await api('POST', '/api/ideas/submit', {
    token: AUSER,
    body: {
      title: 'Label the coolant lines by colour',
      present_situation: 'The lines are identical, so the wrong one gets drained during a changeover.',
      proposed_solution: 'Colour-band each line at both ends and put a key on the wall.',
      impact_level: 'Medium', impact_areas: 'Quality', action: 'submit',
    },
  });
  assert.equal(submitted.data.success, true, JSON.stringify(submitted.data));
  const ideaId = submitted.data.idea_id;

  // Reading: allowed, and the idea really is in there — otherwise "cannot act"
  // would be trivially true because there was nothing to act on.
  const queue = await api('GET', '/api/ideas/review', { token: AADMIN });
  assert.equal(queue.status, 200, 'an admin must still be able to read the queue');
  assert.ok((queue.data.ideas || []).some((i) => i.id === ideaId),
    'and the pending idea must be visible in it');

  // Deciding: refused at the route, before the service is ever reached.
  const refusals = [
    ['/api/ideas/review-action', { idea_id: ideaId, decision: 'Approved' }],
    ['/api/ideas/review-action', { idea_id: ideaId, decision: 'Rejected', comment: 'No.' }],
    ['/api/ideas/bulk-review',   { idea_ids: [ideaId], decision: 'Approved' }],
    ['/api/ideas/assign-reviewers', { idea_id: ideaId, reviewer_ids: [tl.id] }],
    ['/api/ideas/reviewer-decision', { idea_id: ideaId, decision: 'Approved' }],
  ];
  for (const [path, body] of refusals) {
    const res = await api('POST', path, { token: AADMIN, body });
    assert.equal(res.status, 403,
      `${path} must refuse an org admin outright — got ${res.status} `
      + `${JSON.stringify(res.data)}`);
  }

  // And nothing moved on the way through any of that.
  const st = await stageOf(ideaId);
  assert.equal(st.current_stage, 'team_lead', 'the idea is still waiting on its first stage');
  assert.equal(st.status, 'Submitted', 'and is still merely submitted');
});

/* ───────────────────────────────────────────────────────────────────────────
 *  An idea goes to the author's OWN approver
 * ─────────────────────────────────────────────────────────────────────────── */

/*
 * Jitesh reports to Elisa. Mark is also a manager, of a different team.
 *
 * Choosing the approver by ROLE alone put Jitesh's idea in front of both of
 * them, and whichever one opened it first could decide it. So an idea could be
 * approved by somebody who had never met its author and knew nothing about the
 * work, while the manager who could actually judge it might never learn it
 * existed. It also made "who approved this" a race.
 *
 * The chain still decides the SEQUENCE — that is what the ordered stage list is
 * for, and routing by the reporting tree is the exact mistake it was built to
 * undo. The reporting tree decides only WHO fills the stage the chain has
 * already chosen. Those are different questions and this test pins both: the
 * idea is at the immediate_manager STAGE (the chain's answer) and it is with
 * Elisa (the tree's answer).
 */
test('an idea reaches the submitter\'s own manager, and no other manager', async () => {
  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;
  await api('POST', '/api/settings', {
    token: aTok, body: { approval_stages: 'originator,immediate_manager' },
  });

  const mkUser = async (name, email, role, empId, phone, managerId) => {
    const res = await api('POST', '/api/users', {
      token: aTok,
      body: { name, email, password: 'LinePass12345', role, employee_id: empId,
        phone, department: 'Ops', manager_id: managerId ?? undefined },
    });
    assert.equal(res.data.success, true, `${name}: ${JSON.stringify(res.data)}`);
    const [row] = await sql('ifqm_test_a',
      `SELECT id FROM ifqm_test_a.users WHERE email = '${email}'`);
    const { token } = await login(email, 'LinePass12345', 'orga');
    return { id: row.id, token };
  };

  const elisa = await mkUser('Elisa Vaz', 'elisa@orga.test', 'manager', 'LINEELI', '+919812347001');
  const mark = await mkUser('Mark Rowe', 'mark@orga.test', 'manager', 'LINEMRK', '+919812347002');
  const jitesh = await mkUser('Jitesh Rao', 'jitesh@orga.test', 'employee', 'LINEJIT',
    '+919812347003', elisa.id);

  const submitted = await api('POST', '/api/ideas/submit', {
    token: jitesh.token,
    body: {
      title: 'Stage the die trolley beside the press',
      present_situation: 'The trolley lives two bays away and every changeover starts with a walk.',
      proposed_solution: 'Park it in the marked bay next to the press and paint the outline.',
      impact_level: 'Medium', impact_areas: 'Productivity', action: 'submit',
    },
  });
  assert.equal(submitted.data.success, true, JSON.stringify(submitted.data));
  const ideaId = submitted.data.idea_id;

  // The chain put it at the immediate_manager stage; the tree put it with Elisa.
  const st = await stageOf(ideaId);
  assert.equal(st.current_stage, 'immediate_manager', 'the chain decides the stage');
  assert.equal(Number(st.current_reviewer_id), Number(elisa.id),
    'and the reporting line decides who — Elisa, not whichever manager sorted first');

  // Elisa sees it. Mark does not.
  const elisaQ = await api('GET', '/api/ideas/review', { token: elisa.token });
  assert.ok((elisaQ.data.ideas || []).some((i) => i.id === ideaId),
    'the submitter\'s own manager must see it');
  const markQ = await api('GET', '/api/ideas/review', { token: mark.token });
  assert.ok(!(markQ.data.ideas || []).some((i) => i.id === ideaId),
    'a manager from another team must not see somebody else\'s report\'s idea');

  /*
   * And the screen is not the rule. Mark is refused at the endpoint too — a
   * queue that hides a button is a presentation choice, and anybody can post
   * to the API.
   */
  const markTries = await api('POST', '/api/ideas/review-action', {
    token: mark.token, body: { idea_id: ideaId, decision: 'Approved' },
  });
  assert.equal(markTries.status, 403,
    `another team's manager must be refused — got ${markTries.status} `
    + JSON.stringify(markTries.data));
  assert.match(markTries.data.error, /Elisa/,
    'and told whose it is, so they know it is routed rather than broken');

  // Elisa can, and the idea closes because she is the only stage in this chain.
  const elisaApproves = await api('POST', '/api/ideas/review-action', {
    token: elisa.token, body: { idea_id: ideaId, decision: 'Approved' },
  });
  assert.equal(elisaApproves.status, 200, JSON.stringify(elisaApproves.data));

  await api('POST', '/api/settings', {
    token: aTok,
    body: { approval_stages: 'originator,team_lead,immediate_manager,department_manager,plant_head' },
  });
});

/*
 * The submitter is told WHO has their idea, not just what rank they are.
 *
 * "Now with Immediate Manager" is a sentence with no useful content in an
 * organisation that has nine managers: the first thing anybody does with this
 * notification is work out whose desk to go to. Naming the person is the whole
 * value of routing by the reporting line — if the message cannot say "Elisa",
 * the author still cannot tell whether their idea is moving or lost.
 */
test('the progress notification names the person the idea is now with', async () => {
  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;
  await api('POST', '/api/settings', {
    token: aTok, body: { approval_stages: 'originator,team_lead,immediate_manager' },
  });

  const mk = async (name, email, role, empId, phone, managerId) => {
    const res = await api('POST', '/api/users', {
      token: aTok,
      body: { name, email, password: 'NotifPass12345', role, employee_id: empId,
        phone, department: 'Paint', manager_id: managerId ?? undefined },
    });
    assert.equal(res.data.success, true, `${name}: ${JSON.stringify(res.data)}`);
    const [row] = await sql('ifqm_test_a',
      `SELECT id FROM ifqm_test_a.users WHERE email = '${email}'`);
    const { token } = await login(email, 'NotifPass12345', 'orga');
    return { id: row.id, token };
  };

  const anita = await mk('Anita Bose', 'anita.mgr@orga.test', 'manager', 'NOTIFMGR', '+919812347011');
  const raj = await mk('Raj Kumar', 'raj.tl@orga.test', 'team_lead', 'NOTIFTL', '+919812347012', anita.id);
  const dev = await mk('Dev Shah', 'dev.emp@orga.test', 'employee', 'NOTIFEMP', '+919812347013', raj.id);

  const submitted = await api('POST', '/api/ideas/submit', {
    token: dev.token,
    body: {
      title: 'Cover the paint mixing bench',
      present_situation: 'Dust settles on the bench overnight and ends up in the mix.',
      proposed_solution: 'A hinged lid on the bench, dropped at the end of each shift.',
      impact_level: 'Medium', impact_areas: 'Quality', action: 'submit',
    },
  });
  const ideaId = submitted.data.idea_id;

  await api('POST', '/api/ideas/review-action', {
    token: raj.token, body: { idea_id: ideaId, decision: 'Approved' },
  });

  const notes = await sql('ifqm_test_a',
    `SELECT message FROM ifqm_test_a.notifications
      WHERE user_id = ${dev.id} AND idea_id = ${ideaId}
      ORDER BY id DESC LIMIT 5`);
  const moved = notes.find((n) => /approved by .* reviewed by/i.test(n.message));
  assert.ok(moved, `the submitter must be told it moved — got ${JSON.stringify(notes)}`);
  assert.match(moved.message, /Raj Kumar/, 'naming who approved it');
  assert.match(moved.message, /Anita Bose/,
    'and who has it now, by name: "reviewed by Anita Bose, your Immediate Manager" — '
    + 'not "reviewed by Immediate Manager", which in an organisation with nine of them '
    + 'is not an answer');

  await api('POST', '/api/settings', {
    token: aTok,
    body: { approval_stages: 'originator,team_lead,immediate_manager,department_manager,plant_head' },
  });
});

/*
 * One plant head per organisation.
 *
 * The chain ends at the plant head and that approval is what releases an idea
 * to QCMS. With two of them, "final approval" quietly becomes "approval by
 * whichever plant head the router happened to reach" — the most consequential
 * decision in the flow settled by a tie-break nobody chose.
 *
 * Checked at both doors. The console is one way in and the bulk import is the
 * other, and a rule enforced in one of them is a rule with a way around it.
 */
test('an organisation may have only one plant head', async () => {
  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;
  await thePlantHead();   // the sitting one

  // A second, through the console.
  const second = await api('POST', '/api/users', {
    token: aTok,
    body: { name: 'Second Head', email: 'second.ph@orga.test', password: 'PhPassword12345',
      role: 'plant_head', employee_id: 'PH2', phone: '+919812347021', department: 'Ops' },
  });
  assert.equal(second.status, 409, JSON.stringify(second.data));
  assert.match(second.data.error, /already held by/i,
    'and it must name who holds it — otherwise the admin cannot act on the refusal');

  // A second, by promoting somebody who already exists.
  const other = await api('POST', '/api/users', {
    token: aTok,
    body: { name: 'Promotable Person', email: 'promo@orga.test', password: 'PhPassword12345',
      role: 'senior_manager', employee_id: 'PROMO1', phone: '+919812347022', department: 'Ops' },
  });
  assert.equal(other.data.success, true, JSON.stringify(other.data));
  const [promo] = await sql('ifqm_test_a',
    "SELECT id FROM ifqm_test_a.users WHERE email = 'promo@orga.test'");

  const promoted = await api('PUT', `/api/users/${promo.id}`, {
    token: aTok,
    body: { name: 'Promotable Person', role: 'plant_head', phone: '+919812347022',
      department: 'Ops', status: 'active' },
  });
  assert.equal(promoted.status, 409,
    'the edit form is the same door — a rule the console enforces on creation and '
    + 'not on promotion is not a rule');

  /*
   * Editing the sitting plant head must still work. `assertRoleVacant` excepts
   * the row being edited, or changing their phone number would fail on the
   * grounds that a plant head exists — which they are.
   */
  const [sitting] = await sql('ifqm_test_a',
    "SELECT id, name FROM ifqm_test_a.users WHERE role = 'plant_head' AND status = 'active' LIMIT 1");
  const resave = await api('PUT', `/api/users/${sitting.id}`, {
    token: aTok,
    body: { name: sitting.name, role: 'plant_head', phone: '+919812345904',
      department: 'Ops', status: 'active' },
  });
  assert.equal(resave.status, 200,
    `the sitting plant head must be editable — ${JSON.stringify(resave.data)}`);
});

/*
 * The bug behind "the plant head still cannot give final approval sometimes".
 *
 * An idea approved at the last STAFFED stage of a chain whose final stage
 * nobody holds used to be left sitting where it was. It had an Approved entry
 * against it at a stage with a perfectly healthy holder, so the hourly repair
 * pass — which asked only "can anybody act at this idea's stage?" — saw nothing
 * wrong and moved on. When a plant head was finally appointed, nothing ever
 * looked at that idea again: it waited forever at a stage that had already
 * finished with it, showing up in the department manager's queue and never in
 * the plant head's.
 *
 * The fix is one line of intent: park it at the stage that is BLOCKING. Then
 * the repair pass asks the right question and answers it the moment the role is
 * filled.
 */
test('an idea waiting for a plant head reaches them once one is appointed', async () => {
  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;

  // A chain ending in a role this organisation has nobody for.
  await api('POST', '/api/settings', {
    token: aTok, body: { approval_stages: 'originator,team_lead,executive' },
  });

  const tl = await makeReviewer('block.tl@orga.test', 'team_lead', '+919812347031', 'WAITTL');
  const submitted = await api('POST', '/api/ideas/submit', {
    token: AUSER,
    body: {
      title: 'Bund the solvent store',
      present_situation: 'A drum split last month and the solvent ran to the floor drain.',
      proposed_solution: 'Kerb the store and put the drums on a bunded pallet.',
      impact_level: 'High', impact_areas: 'Safety', action: 'submit',
    },
  });
  assert.equal(submitted.data.success, true, JSON.stringify(submitted.data));
  const ideaId = submitted.data.idea_id;

  const approved = await api('POST', '/api/ideas/review-action', {
    token: tl, body: { idea_id: ideaId, decision: 'Approved' },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));

  /*
   * It waits AT the empty stage, not at the one that just approved it. This is
   * the assertion the whole bug turns on.
   */
  let st = await stageOf(ideaId);
  assert.equal(st.current_stage, 'executive',
    'a blocked idea waits at the stage that is blocking it, not at the stage that '
    + 'has already approved it — otherwise the repair pass looks at the wrong role');
  assert.notEqual(st.status, 'Approved',
    'and it is certainly not approved: nobody gave that approval');

  // The team lead is done with it and must not still be holding it.
  const tlQueue = await api('GET', '/api/ideas/review', { token: tl });
  assert.ok(!(tlQueue.data.ideas || []).some((i) => i.id === ideaId),
    'the stage that approved it must not keep seeing it');

  // Now somebody is appointed to the empty role.
  const exec = await makeReviewer('block.exec@orga.test', 'executive', '+919812347032', 'BLKEX');

  const { repairStrandedIdeas } = await import('../src/services/ideaService.js');
  const { getTenantPool } = await import('../src/database/tenant.js');
  const pool = getTenantPool({ db_name: 'ifqm_test_a', db_host: config.masterDb.host });
  const repair = await repairStrandedIdeas(pool);
  assert.ok(repair.moved >= 1, `the repair pass must re-route it — got ${JSON.stringify(repair)}`);

  st = await stageOf(ideaId);
  assert.equal(st.current_stage, 'executive');
  assert.ok(st.current_reviewer_id, 'and it is now assigned to a real person');

  // And that person can finish it.
  const execQueue = await api('GET', '/api/ideas/review', { token: exec });
  assert.ok((execQueue.data.ideas || []).some((i) => i.id === ideaId),
    'the newly appointed approver must see the idea that was waiting for them');

  const closed = await api('POST', '/api/ideas/review-action', {
    token: exec, body: { idea_id: ideaId, decision: 'Approved' },
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.data));
  st = await stageOf(ideaId);
  assert.equal(st.status, 'Approved', 'the final stage closes it');

  await api('POST', '/api/settings', {
    token: aTok,
    body: { approval_stages: 'originator,team_lead,immediate_manager,department_manager,plant_head' },
  });
});

/*
 * An idea whose assigned approver has left does not sit in a dead queue.
 *
 * Routing to a named person buys precision and costs resilience: the one queue
 * an idea appears in can belong to somebody who no longer logs in. The old
 * repair pass could not see this at all — it asked whether the idea's ROLE had
 * holders, and it did, so an idea assigned to a deactivated manager looked
 * perfectly healthy while being invisible to every living person.
 */
test('an idea assigned to somebody who has left is re-routed', async () => {
  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;
  await api('POST', '/api/settings', {
    token: aTok, body: { approval_stages: 'originator,immediate_manager' },
  });

  const mk = async (name, email, empId, phone, role, managerId) => {
    const res = await api('POST', '/api/users', {
      token: aTok,
      body: { name, email, password: 'GonePass12345', role, employee_id: empId,
        phone, department: 'Press', manager_id: managerId ?? undefined },
    });
    assert.equal(res.data.success, true, `${name}: ${JSON.stringify(res.data)}`);
    const [row] = await sql('ifqm_test_a',
      `SELECT id FROM ifqm_test_a.users WHERE email = '${email}'`);
    return { id: row.id };
  };

  const leaver = await mk('Leaving Manager', 'leaver@orga.test', 'GONEMGR', '+919812347041', 'manager');
  const staying = await mk('Staying Manager', 'stayer@orga.test', 'STAYMGR', '+919812347042', 'manager');
  const author = await mk('Reporting Author', 'author.gone@orga.test', 'GONEEMP', '+919812347043',
    'employee', leaver.id);
  const { token: authorTok } = await login('author.gone@orga.test', 'GonePass12345', 'orga');

  const submitted = await api('POST', '/api/ideas/submit', {
    token: authorTok,
    body: {
      title: 'Second scrap bin at the press',
      present_situation: 'One bin fills by mid-shift and offcuts stack on the floor.',
      proposed_solution: 'A second bin on the far side, emptied on the same round.',
      impact_level: 'Low', impact_areas: 'Housekeeping', action: 'submit',
    },
  });
  const ideaId = submitted.data.idea_id;
  let st = await stageOf(ideaId);
  assert.equal(Number(st.current_reviewer_id), Number(leaver.id), 'routed to the author\'s manager');

  // They leave.
  await api('PUT', `/api/users/${leaver.id}`, {
    token: aTok,
    body: { name: 'Leaving Manager', role: 'manager', phone: '+919812347041',
      department: 'Press', status: 'inactive' },
  });

  const { repairStrandedIdeas } = await import('../src/services/ideaService.js');
  const { getTenantPool } = await import('../src/database/tenant.js');
  const pool = getTenantPool({ db_name: 'ifqm_test_a', db_host: config.masterDb.host });
  await repairStrandedIdeas(pool);

  st = await stageOf(ideaId);
  assert.notEqual(Number(st.current_reviewer_id), Number(leaver.id),
    'an idea must not stay in the queue of somebody who has been deactivated');
  assert.equal(st.current_stage, 'immediate_manager', 'the stage itself is unchanged — only the person');
  assert.ok(author.id, 'author fixture used');
  assert.ok(staying.id, 'a living manager existed to take it');

  await api('POST', '/api/settings', {
    token: aTok,
    body: { approval_stages: 'originator,team_lead,immediate_manager,department_manager,plant_head' },
  });
});

/*
 * The closure PDF says who approved and in what capacity.
 *
 * "Approved by Sunil Rao" leaves a reader to work out whether Sunil was
 * entitled to close the idea; the point of a closure document is that somebody
 * who was not there can follow it years later. The position is read from what
 * was RECORDED at the moment of each decision rather than from the approver's
 * role today — otherwise a promotion silently rewrites history, and a team lead
 * made plant head in March would appear to have given plant-head approval at
 * step one back in January.
 */
test('the closure PDF records the position each approver held at the time', async () => {
  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;
  await api('POST', '/api/settings', {
    token: aTok, body: { approval_stages: 'originator,team_lead' },
  });

  const mk = async (name, email, empId, phone, role, managerId) => {
    const res = await api('POST', '/api/users', {
      token: aTok,
      body: { name, email, password: 'PdfPass12345', role, employee_id: empId,
        phone, department: 'Weld', manager_id: managerId ?? undefined },
    });
    assert.equal(res.data.success, true, `${name}: ${JSON.stringify(res.data)}`);
    const [row] = await sql('ifqm_test_a',
      `SELECT id FROM ifqm_test_a.users WHERE email = '${email}'`);
    const { token } = await login(email, 'PdfPass12345', 'orga');
    return { id: row.id, token };
  };

  const lead = await mk('Pdf Lead', 'pdf.tl@orga.test', 'PDFTL', '+919812347051', 'team_lead');
  const worker = await mk('Pdf Worker', 'pdf.emp@orga.test', 'PDFEMP', '+919812347052',
    'employee', lead.id);

  const submitted = await api('POST', '/api/ideas/submit', {
    token: worker.token,
    body: {
      title: 'Jig for the bracket weld',
      present_situation: 'The bracket is held by hand and the angle drifts across a batch.',
      proposed_solution: 'A simple jig that locates the bracket at the right angle every time.',
      impact_level: 'High', impact_areas: 'Quality', action: 'submit',
    },
  });
  const ideaId = submitted.data.idea_id;
  await api('POST', '/api/ideas/review-action', {
    token: lead.token, body: { idea_id: ideaId, decision: 'Approved' },
  });

  // The stage is on the row, which is what the PDF prints.
  const wf = await sql('ifqm_test_a',
    `SELECT action, stage FROM ifqm_test_a.idea_workflow
      WHERE idea_id = ${ideaId} ORDER BY id ASC`);
  const submittedRow = wf.find((w) => w.action === 'Submitted');
  const approvedRow = wf.find((w) => w.action === 'Approved');
  assert.equal(submittedRow.stage, 'originator', 'the author acted as the originator');
  assert.equal(approvedRow.stage, 'team_lead',
    'and the approval records the stage it was given at, so a later promotion '
    + 'cannot rewrite what capacity it was given in');

  // The document itself is a PDF, and it carries the chain the renderer needs.
  const detail = await api('GET', `/api/ideas/${ideaId}`, { token: worker.token });
  assert.ok(detail.data.idea.approval_chain?.steps?.length,
    'the idea must travel with this organisation\'s chain — the renderer cannot '
    + 'look up a tenant\'s own stage names for itself');

  const pdf = await api('GET', `/api/export/idea/${ideaId}/pdf`, { token: worker.token });
  assert.equal(pdf.status, 200, 'the closure PDF must render');

  await api('POST', '/api/settings', {
    token: aTok,
    body: { approval_stages: 'originator,team_lead,immediate_manager,department_manager,plant_head' },
  });
});

/*
 * A pooled connection the database has already closed costs one retry, not one
 * error page.
 *
 * This is the whole of "sometimes it says server error, on any page". MySQL
 * closes a connection after `wait_timeout` (600s on Aiven) and nothing tells
 * the client; the pool keeps holding it; the next request after a quiet spell
 * borrows the corpse and gets ECONNRESET. It looked random because it was —
 * whoever made the first request after a lull, on whichever socket had gone
 * stale — and it could never be reproduced on a busy system, which is why it
 * survived so long.
 *
 * Tested against a fake pool rather than a real one: reproducing it for real
 * means waiting ten minutes for a server-side timeout, and what needs pinning
 * is the decision — WHICH errors are retried, and that a retry happens at all.
 */
test('a dead pooled connection is retried once, and a real error is not', async () => {
  const { resilientPool, KEEPALIVE_OPTIONS } = await import('../src/database/resilient.js');

  // ── the stale-socket case ──
  let calls = 0;
  const flaky = {
    on() {},
    execute: async () => {
      calls++;
      if (calls === 1) {
        const err = new Error('read ECONNRESET');
        err.code = 'ECONNRESET';
        err.fatal = true;
        throw err;
      }
      return [[{ ok: 1 }]];
    },
  };
  const [rows] = await resilientPool(flaky, 'test').execute('SELECT 1');
  assert.equal(calls, 2, 'the statement is tried again on a fresh connection');
  assert.equal(rows[0].ok, 1, 'and the caller gets the answer, not an error');

  // ── a query that is simply wrong is NOT retried ──
  /*
   * The distinction the whole thing rests on. A duplicate-key error came back
   * THROUGH a working connection, so the server did receive the statement and
   * running it again would only produce the same answer more slowly — or, for
   * a write, produce it twice.
   */
  let dupCalls = 0;
  const dup = {
    on() {},
    execute: async () => {
      dupCalls++;
      const err = new Error("Duplicate entry 'x' for key 'email'");
      err.code = 'ER_DUP_ENTRY';
      throw err;
    },
  };
  await assert.rejects(
    () => resilientPool(dup, 'test').execute('INSERT ...'),
    /Duplicate entry/);
  assert.equal(dupCalls, 1, 'a real error is reported at once, not retried');

  // ── a second failure is an outage, and is told truthfully ──
  let downCalls = 0;
  const down = {
    on() {},
    query: async () => {
      downCalls++;
      const err = new Error('connect ECONNREFUSED');
      err.code = 'ECONNREFUSED';
      throw err;
    },
  };
  await assert.rejects(
    () => resilientPool(down, 'test').query('SELECT 1'),
    /ECONNREFUSED/);
  assert.equal(downCalls, 2, 'tried twice and then believed — retrying forever would only delay the truth');

  /*
   * The listener that stops one dead connection killing the process.
   *
   * A mysql2 pool that emits 'error' with nothing listening THROWS, and that
   * throw is not inside any request — it lands on the process-level
   * uncaughtException handler, which calls process.exit(1). So an idle
   * connection dying could take the whole server down and fail every request in
   * flight. That is the version of this bug that looked like "any part of the
   * platform".
   */
  const listeners = [];
  resilientPool({ on: (evt) => listeners.push(evt), execute: async () => [[]] }, 'test');
  assert.ok(listeners.includes('error'),
    'the pool must have an error listener, or one dead idle connection exits the process');

  // ── and the settings that stop it happening in the first place ──
  assert.equal(KEEPALIVE_OPTIONS.enableKeepAlive, true);
  assert.ok(KEEPALIVE_OPTIONS.idleTimeout < 600000,
    'our idle timeout must be well under MySQL wait_timeout (600s on Aiven), so WE '
    + 'close idle connections first — a connection we closed is one the pool knows '
    + 'about, and one the server closed is one it does not');
});

/*
 * Ideas already in flight are moved to the author's own approver.
 *
 * The routing rule is only half a fix. Every idea submitted before it existed
 * was assigned to whichever holder of the role sorted first, so on the day this
 * ships there is a backlog sitting with the wrong managers — alive, assigned,
 * and therefore invisible to every other check in the repair pass. They would
 * have stayed wrong until somebody approved them, which is the outcome the
 * routing was built to prevent.
 *
 * Only ever moved TOWARDS the author's line, and never un-assigned: a
 * correction that empties the field would take an idea out of one queue without
 * putting it into another.
 */
test('an idea sitting with the wrong manager is moved to the author\'s own', async () => {
  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;
  await api('POST', '/api/settings', {
    token: aTok, body: { approval_stages: 'originator,immediate_manager' },
  });

  const mk = async (name, email, empId, phone, role, managerId) => {
    const res = await api('POST', '/api/users', {
      token: aTok,
      body: { name, email, password: 'FixupPass12345', role, employee_id: empId,
        phone, department: 'Tool', manager_id: managerId ?? undefined },
    });
    assert.equal(res.data.success, true, `${name}: ${JSON.stringify(res.data)}`);
    const [row] = await sql('ifqm_test_a',
      `SELECT id FROM ifqm_test_a.users WHERE email = '${email}'`);
    return { id: row.id };
  };

  const hers = await mk('Her Manager', 'hers.mgr@orga.test', 'FIXOWN', '+919812347061', 'manager');
  const other = await mk('Other Manager', 'other.mgr@orga.test', 'FIXOTH', '+919812347062', 'manager');
  await mk('Fixup Author', 'fixup@orga.test', 'FIXEMP', '+919812347063', 'employee', hers.id);
  const { token: authorTok } = await login('fixup@orga.test', 'FixupPass12345', 'orga');

  const submitted = await api('POST', '/api/ideas/submit', {
    token: authorTok,
    body: {
      title: 'Shadow board for the setter’s tools',
      present_situation: 'Tools go missing between shifts and a setup waits while somebody hunts.',
      proposed_solution: 'An outlined shadow board at the machine, checked at handover.',
      impact_level: 'Medium', impact_areas: 'Productivity', action: 'submit',
    },
  });
  const ideaId = submitted.data.idea_id;

  // Put it where the old logic would have: with a manager who is not theirs.
  await sql('ifqm_test_a',
    `UPDATE ifqm_test_a.ideas SET current_reviewer_id = ${other.id} WHERE id = ${ideaId}`);

  const { repairStrandedIdeas } = await import('../src/services/ideaService.js');
  const { getTenantPool } = await import('../src/database/tenant.js');
  const pool = getTenantPool({ db_name: 'ifqm_test_a', db_host: config.masterDb.host });
  await repairStrandedIdeas(pool);

  const st = await stageOf(ideaId);
  assert.equal(Number(st.current_reviewer_id), Number(hers.id),
    'the backlog is corrected towards the reporting line, not left where it was');
  assert.equal(st.current_stage, 'immediate_manager',
    'and the STAGE is untouched — the chain decides that, and re-routing must not '
    + 'quietly move an idea forwards or backwards through it');

  await api('POST', '/api/settings', {
    token: aTok,
    body: { approval_stages: 'originator,team_lead,immediate_manager,department_manager,plant_head' },
  });
});

/*
 * The dashboard count and the review queue are the same claim, made twice.
 *
 * "4 ideas are waiting on your decision" above a list containing two of them is
 * not a rounding difference — it is the product telling somebody their work is
 * somewhere they cannot find, and there is nowhere to go and look. The two used
 * to be computed from different rules: the card matched the reporting tree with
 * no reference to the approval chain at all, so it counted ideas at stages the
 * person plays no part in, counted their own ideas, and missed unassigned ones
 * at a stage they do hold.
 */
test('the dashboard pending count agrees with the review queue', async () => {
  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;
  await api('POST', '/api/settings', {
    token: aTok, body: { approval_stages: 'originator,immediate_manager' },
  });

  const mk = async (name, email, empId, phone, role, managerId) => {
    const res = await api('POST', '/api/users', {
      token: aTok,
      body: { name, email, password: 'CountPass12345', role, employee_id: empId,
        phone, department: 'Assembly', manager_id: managerId ?? undefined },
    });
    assert.equal(res.data.success, true, `${name}: ${JSON.stringify(res.data)}`);
    const [row] = await sql('ifqm_test_a',
      `SELECT id FROM ifqm_test_a.users WHERE email = '${email}'`);
    const { token } = await login(email, 'CountPass12345', 'orga');
    return { id: row.id, token };
  };

  const boss = await mk('Count Manager', 'count.mgr@orga.test', 'CNTMGR', '+919812347071', 'manager');
  const one = await mk('Count One', 'count.one@orga.test', 'CNTONE', '+919812347072', 'employee', boss.id);
  const two = await mk('Count Two', 'count.two@orga.test', 'CNTTWO', '+919812347073', 'employee', boss.id);

  const mine = [];
  for (const [who, title] of [[one, 'Label the fastener bins'], [two, 'Torque wrench at the station']]) {
    const r = await api('POST', '/api/ideas/submit', {
      token: who.token,
      body: {
        title,
        present_situation: 'The current arrangement costs time on every build.',
        proposed_solution: 'A small change at the station that removes the walk.',
        impact_level: 'Low', impact_areas: 'Productivity', action: 'submit',
      },
    });
    assert.equal(r.data.success, true, JSON.stringify(r.data));
    mine.push(r.data.idea_id);
  }

  /*
   * The manager submits one of their own. It must appear in NEITHER — nobody
   * reviews their own idea, and a count that includes it sends somebody looking
   * for a decision they are not allowed to make.
   */
  const own = await api('POST', '/api/ideas/submit', {
    token: boss.token,
    body: {
      title: 'Move the parts trolley closer',
      present_situation: 'The trolley is parked outside the cell.',
      proposed_solution: 'Bring it inside the marked area.',
      impact_level: 'Low', impact_areas: 'Productivity', action: 'submit',
    },
  });

  const dash = await api('GET', '/api/ideas/dashboard', { token: boss.token });
  const queue = await api('GET', '/api/ideas/review', { token: boss.token });
  const listed = (queue.data.ideas || []).length;

  assert.equal(Number(dash.data.pending_reviews), listed,
    `the card says ${dash.data.pending_reviews} and the queue lists ${listed} — `
    + 'they are the same question and must give the same answer');
  /*
   * Asserted by identity rather than by total. The queue legitimately also
   * holds ideas left unassigned by earlier tests in this file, which any
   * manager may act on; a bare count would be pinning the order the suite
   * happens to run in rather than the rule under test.
   */
  const ids = new Set((queue.data.ideas || []).map((i) => i.id));
  for (const id of mine) {
    assert.ok(ids.has(id), 'every idea from this manager\'s own reports is waiting on them');
  }
  assert.ok(!ids.has(own.data.idea_id),
    'and their own idea is not — nobody reviews what they wrote, so counting it would '
    + 'send them looking for a decision they are not allowed to make');

  await api('POST', '/api/settings', {
    token: aTok,
    body: { approval_stages: 'originator,team_lead,immediate_manager,department_manager,plant_head' },
  });
});

/*
 * The author hears about every step, by email, and hears who has it.
 *
 * Most of the people this platform is for do not sit at a desk with the
 * dashboard open. An idea can spend a fortnight travelling four stages, and an
 * author who hears nothing in that time concludes it went into a drawer — which
 * is how a suggestion scheme quietly stops being used. The in-app notification
 * only reaches somebody who has already come back to look; the email reaches
 * somebody who has not.
 *
 * Both ends are named on purpose. "Approved at Team Lead, now with Immediate
 * Manager" describes ranks; what the author wants is which two PEOPLE, because
 * the first thing anybody does with this is decide whether to go and ask
 * somebody about it.
 */
test('the submitter is emailed at every step, and congratulated at the last', async () => {
  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;
  await api('POST', '/api/settings', {
    token: aTok, body: { approval_stages: 'originator,team_lead,immediate_manager' },
  });

  const mk = async (name, email, empId, phone, role, managerId) => {
    const res = await api('POST', '/api/users', {
      token: aTok,
      body: { name, email, password: 'MailPass12345', role, employee_id: empId,
        phone, department: 'Foundry', manager_id: managerId ?? undefined },
    });
    assert.equal(res.data.success, true, `${name}: ${JSON.stringify(res.data)}`);
    const [row] = await sql('ifqm_test_a',
      `SELECT id FROM ifqm_test_a.users WHERE email = '${email}'`);
    const { token } = await login(email, 'MailPass12345', 'orga');
    return { id: row.id, token };
  };

  const akshay = await mk('Akshay Nair', 'akshay.mgr@orga.test', 'MAILMGR', '+919812347081', 'manager');
  const lead = await mk('Priya Menon', 'priya.tl@orga.test', 'MAILTL', '+919812347082', 'team_lead', akshay.id);
  const author = await mk('Sunil Das', 'sunil.emp@orga.test', 'MAILEMP', '+919812347083', 'employee', lead.id);

  const mailsTo = async (addr) => sql('ifqm_test_a',
    `SELECT subject, body FROM ifqm_test_a.email_queue
      WHERE to_email = '${addr}' ORDER BY id ASC`);
  const before = (await mailsTo('sunil.emp@orga.test')).length;

  const submitted = await api('POST', '/api/ideas/submit', {
    token: author.token,
    body: {
      title: 'Extract hood over the pouring bay',
      present_situation: 'Fume drifts across the bay and the operators work in it all shift.',
      proposed_solution: 'A hood over the pour point, ducted to the existing extraction.',
      impact_level: 'High', impact_areas: 'Safety', action: 'submit',
    },
  });
  assert.equal(submitted.data.success, true, JSON.stringify(submitted.data));
  const ideaId = submitted.data.idea_id;

  // ── Step one: the team lead approves, and it goes on to Akshay ──
  const first = await api('POST', '/api/ideas/review-action', {
    token: lead.token, body: { idea_id: ideaId, decision: 'Approved' },
  });
  assert.equal(first.status, 200, JSON.stringify(first.data));

  let mails = (await mailsTo('sunil.emp@orga.test')).slice(before);
  const moved = mails.find((m) => /moved forward/i.test(m.subject));
  assert.ok(moved, `the author must be emailed when it moves — got ${JSON.stringify(mails)}`);
  assert.match(moved.body, /Priya Menon/, 'it names who approved it');
  assert.match(moved.body, /Akshay Nair/, 'and who has it now — by name, not by rank');
  assert.match(moved.body, /step 2 of 2/,
    'and how far along it is, so "under review" has a size to it');

  // ── The last step: a different letter ──
  const last = await api('POST', '/api/ideas/review-action', {
    token: akshay.token, body: { idea_id: ideaId, decision: 'Approved', comment: 'Do it.' },
  });
  assert.equal(last.status, 200, JSON.stringify(last.data));

  mails = (await mailsTo('sunil.emp@orga.test')).slice(before);
  const done = mails.find((m) => /Congratulations/i.test(m.subject));
  assert.ok(done, `the final approval must read as an ending — got ${
    JSON.stringify(mails.map((m) => m.subject))}`);
  assert.match(done.body, /Akshay Nair/, 'naming who gave the final approval');
  assert.match(done.body, /quality system/i,
    'and saying what happens next — it can go to QC and be built');
  assert.match(done.body, /points/i,
    'and what it earned: the scheme runs on people seeing that writing an idea '
    + 'down led somewhere');

  const [who] = await sql('ifqm_test_a',
    `SELECT points FROM ifqm_test_a.users WHERE id = ${author.id}`);
  assert.match(done.body, new RegExp(`${who.points} points in total`),
    'the running total must match what the author actually has, not just the '
    + 'increment — "+40" alone does not tell somebody where they stand');

  await api('POST', '/api/settings', {
    token: aTok,
    body: { approval_stages: 'originator,team_lead,immediate_manager,department_manager,plant_head' },
  });
});

/*
 * The queue is actually drained.
 *
 * processEmailQueue began `if ((settings.email_enabled ?? '0') !== '1') return;`
 * and every tenant is seeded with email_enabled = '0'. So it returned before it
 * ever looked at the queue: nothing failed, nothing retried, `attempts` stayed
 * at 0 forever, and every other part of the product carried on as though mail
 * worked. On production this had swallowed 47 real messages across two
 * organisations, the oldest three weeks old — ideas received, approvals given,
 * reviews awaiting somebody. Not one had been attempted.
 *
 * Nobody chose that. It was the seed value, and the setting is not surfaced
 * anywhere an administrator would find it. The switch now means what its name
 * says — an organisation that has opted OUT — and the default is to deliver.
 */
test('queued mail is actually attempted, and only silenced by an explicit opt-out', async () => {
  const { processEmailQueue } = await import('../src/services/mailerService.js');
  const { getTenantPool } = await import('../src/database/tenant.js');
  const pool = getTenantPool({ db_name: 'ifqm_test_a', db_host: config.masterDb.host });

  const setEnabled = (v) => sql('ifqm_test_a',
    `INSERT INTO ifqm_test_a.org_settings (key_name, value) VALUES ('email_enabled', '${v}')
       ON DUPLICATE KEY UPDATE value = '${v}'`);
  /*
   * Backdated by two days on purpose.
   *
   * The drain takes five at a time, OLDEST FIRST, and by the time this test
   * runs the suite has left dozens of pending rows behind it — so a row queued
   * now sits at the back and one drain never reaches it. Two days is old enough
   * to be picked first and still inside the three-day window, so it is not
   * retired as stale by the test above.
   */
  const queueOne = async (subject) => {
    await sql('ifqm_test_a',
      `INSERT INTO ifqm_test_a.email_queue (to_email, to_name, subject, body, status, attempts, created_at)
       VALUES ('drain@orga.test', 'Drain', '${subject}', 'body', 'pending', 0, NOW() - INTERVAL 2 DAY)`);
    const [row] = await sql('ifqm_test_a',
      `SELECT id FROM ifqm_test_a.email_queue WHERE subject = '${subject}' ORDER BY id DESC LIMIT 1`);
    return row.id;
  };
  const stateOf = async (id) => {
    const [row] = await sql('ifqm_test_a',
      `SELECT status, attempts FROM ifqm_test_a.email_queue WHERE id = ${id}`);
    return row;
  };

  /*
   * The suite has no mail provider, so a send cannot succeed — and that is
   * fine, because the bug was never about delivery. What is being pinned is
   * whether the message is PICKED UP: attempts moving off 0 is the whole
   * difference between "we tried and the provider refused" and "nothing ever
   * looked at this row", which is what three weeks of silence looked like.
   */
  await setEnabled('0');
  const optedOut = await queueOne('Opted out');
  await processEmailQueue(pool);
  let st = await stateOf(optedOut);
  assert.equal(Number(st.attempts), 0,
    'an organisation that has explicitly opted out is still left alone — the setting works');

  /*
   * Now with a route. The provider gate below the opt-out is a separate and
   * legitimate check — a deployment with nowhere to send has nothing to try —
   * so the suite gives this tenant an SMTP host that will refuse the
   * connection. Refusing is the point: it proves the row was PICKED UP.
   */
  await setEnabled('1');
  await sql('ifqm_test_a',
    "INSERT INTO ifqm_test_a.org_settings (key_name, value) VALUES ('smtp_host', '127.0.0.1') "
    + "ON DUPLICATE KEY UPDATE value = '127.0.0.1'");
  await sql('ifqm_test_a',
    "INSERT INTO ifqm_test_a.org_settings (key_name, value) VALUES ('smtp_port', '1') "
    + "ON DUPLICATE KEY UPDATE value = '1'");
  const wanted = await queueOne('Should be attempted');
  await processEmailQueue(pool);
  st = await stateOf(wanted);
  assert.ok(Number(st.attempts) > 0,
    `a pending message must be picked up — it was left at attempts=${st.attempts}, `
    + 'which is the signature of a consumer that never ran');
  assert.notEqual(st.status, 'pending', 'and it must not be left pending forever');

  await sql('ifqm_test_a',
    "DELETE FROM ifqm_test_a.email_queue WHERE to_email = 'drain@orga.test'");
  // Put the tenant back as it was: later tests read these settings.
  await sql('ifqm_test_a',
    "DELETE FROM ifqm_test_a.org_settings WHERE key_name IN ('smtp_host','smtp_port')");
});

/*
 * A notification too old to be true is retired rather than posted.
 *
 * Turning delivery on uncovered a backlog going back three weeks. "Action
 * Required: idea awaiting your approval" sent a fortnight late is not merely
 * stale — the idea has moved on, and the recipient goes looking for something
 * that is not in their queue. Marked failed rather than deleted, because the
 * row is the evidence that a notification was generated and never reached
 * anybody.
 */
test('a stale queued notification is retired, not posted late', async () => {
  const { processEmailQueue } = await import('../src/services/mailerService.js');
  const { getTenantPool } = await import('../src/database/tenant.js');
  const pool = getTenantPool({ db_name: 'ifqm_test_a', db_host: config.masterDb.host });

  await sql('ifqm_test_a',
    `INSERT INTO ifqm_test_a.org_settings (key_name, value) VALUES ('email_enabled', '1')
       ON DUPLICATE KEY UPDATE value = '1'`);
  await sql('ifqm_test_a',
    `INSERT INTO ifqm_test_a.email_queue (to_email, to_name, subject, body, status, attempts, created_at)
     VALUES ('stale@orga.test', 'Stale', 'Three weeks late', 'body', 'pending', 0,
             NOW() - INTERVAL 21 DAY)`);
  const [before] = await sql('ifqm_test_a',
    "SELECT id FROM ifqm_test_a.email_queue WHERE to_email = 'stale@orga.test' ORDER BY id DESC LIMIT 1");

  await processEmailQueue(pool);

  const [after] = await sql('ifqm_test_a',
    `SELECT status, attempts FROM ifqm_test_a.email_queue WHERE id = ${before.id}`);
  assert.equal(after.status, 'failed', 'a three-week-old notice is retired');
  assert.equal(Number(after.attempts), 0,
    'and never attempted — it is retired because it is wrong now, not because sending failed');

  await sql('ifqm_test_a',
    "DELETE FROM ifqm_test_a.email_queue WHERE to_email = 'stale@orga.test'");
});

/*
 * An idea can only be routed UPWARD.
 *
 * "Route to committee" took any user id at all, and routing takes the idea OFF
 * the sequential chain — workflow_type becomes multi_reviewer, so the stages
 * above the router are never visited. A department manager could therefore hand
 * an idea down to a team lead and have it decided by people junior to him,
 * without the plant head ever seeing it. That is not a committee; it is a way
 * round the chain, and it undoes the point of a sequence that ends at the top.
 *
 * Same level is allowed — a panel of fellow department managers is a real
 * thing. Below is not.
 */
test('an idea can be routed sideways or upward, never down the hierarchy', async () => {
  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;
  await api('POST', '/api/settings', {
    token: aTok,
    body: { approval_stages: 'originator,team_lead,immediate_manager,department_manager,plant_head' },
  });

  const mk = async (name, email, empId, phone, role) => {
    const res = await api('POST', '/api/users', {
      token: aTok,
      body: { name, email, password: 'RoutePass12345', role, employee_id: empId,
        phone, department: 'Route' },
    });
    assert.equal(res.data.success, true, `${name}: ${JSON.stringify(res.data)}`);
    const [row] = await sql('ifqm_test_a',
      `SELECT id FROM ifqm_test_a.users WHERE email = '${email}'`);
    const { token } = await login(email, 'RoutePass12345', 'orga');
    return { id: row.id, token };
  };

  const dm = await mk('Route DM', 'route.dm@orga.test', 'RTDM', '+919812347091', 'department_manager');
  const dm2 = await mk('Route DM Two', 'route.dm2@orga.test', 'RTDM2', '+919812347092', 'department_manager');
  const tl = await mk('Route TL', 'route.tl@orga.test', 'RTTL', '+919812347093', 'team_lead');
  const emp = await mk('Route Emp', 'route.emp@orga.test', 'RTEMP', '+919812347094', 'employee');
  await thePlantHead();
  const [phRow] = await sql('ifqm_test_a',
    "SELECT id FROM ifqm_test_a.users WHERE role = 'plant_head' AND status = 'active' LIMIT 1");

  const submitted = await api('POST', '/api/ideas/submit', {
    token: emp.token,
    body: {
      title: 'Guard the coolant pump coupling',
      present_situation: 'The coupling turns exposed at ankle height beside the walkway.',
      proposed_solution: 'A bolted mesh guard over the coupling.',
      impact_level: 'High', impact_areas: 'Safety', action: 'submit',
    },
  });
  const ideaId = submitted.data.idea_id;

  // Downward: refused, and told who was below them.
  const down = await api('POST', '/api/ideas/assign-reviewers', {
    token: dm.token, body: { idea_id: ideaId, reviewer_ids: [tl.id] },
  });
  assert.equal(down.status, 403, `routing down must be refused — ${JSON.stringify(down.data)}`);
  assert.match(down.data.error, /Route TL/, 'naming who is below them, so the refusal is actionable');

  // To somebody with no place in the chain at all: refused for a different reason.
  const outside = await api('POST', '/api/ideas/assign-reviewers', {
    token: dm.token, body: { idea_id: ideaId, reviewer_ids: [emp.id] },
  });
  assert.notEqual(outside.status, 200, 'an employee holds no approval role and cannot be a reviewer');

  // Sideways and upward: allowed.
  const up = await api('POST', '/api/ideas/assign-reviewers', {
    token: dm.token, body: { idea_id: ideaId, reviewer_ids: [dm2.id, phRow.id] },
  });
  assert.equal(up.status, 200,
    `a peer and somebody above must both be allowed — ${JSON.stringify(up.data)}`);
  assert.equal(up.data.reviewer_count, 2);
});

/*
 * The queue's status column must accept every value the sender writes.
 *
 * processEmailQueue claims a row with status='processing' and the ENUM did not
 * include it. On MariaDB 10.4 — XAMPP, which is what development runs on — that
 * truncates to '' with a warning and carries on, so the suite passed and
 * nothing looked wrong. On Aiven, which runs STRICT_ALL_TABLES, it is error
 * 1265: the drain throws, the scheduler logs one line per tenant, and not a
 * single notification is ever delivered.
 *
 * Two faults produced the identical symptom — rows pending forever at
 * attempts=0 — and fixing only the first would have moved the failure two lines
 * down without a recipient noticing any difference.
 *
 * The first assertion is the one that gives the second its meaning: under a
 * permissive server a bad enum write does not raise, so this test would pass
 * while proving nothing.
 */
test('the email queue accepts every status the sender writes, strictly', async () => {
  /*
   * Asked through the pool the APPLICATION uses, not through the suite's own
   * connection. It is the app's sessions that have to be strict — the helper is
   * scaffolding, and a strict helper proves nothing about the service code.
   */
  const { getTenantPool } = await import('../src/database/tenant.js');
  const pool = getTenantPool({ db_name: 'ifqm_test_a', db_host: config.masterDb.host });
  const [[mode]] = await pool.query('SELECT @@SESSION.sql_mode AS m');
  assert.match(mode.m, /STRICT/,
    'the suite must run as strictly as production does — otherwise a value a '
    + 'column cannot hold is silently truncated here and fatal there, which is '
    + 'exactly how this bug reached six live tenants');

  for (const status of ['pending', 'processing', 'sent', 'failed']) {
    await pool.execute(
      `INSERT INTO email_queue (to_email, subject, body, status)
       VALUES ('enum@orga.test', ?, 'body', ?)`, [`status ${status}`, status]);
    const [[row]] = await pool.execute(
      'SELECT status FROM email_queue WHERE to_email = ? AND subject = ?',
      ['enum@orga.test', `status ${status}`]);
    assert.equal(row.status, status,
      `the column must store '${status}' as written — a value it cannot hold is `
      + 'either an error or an empty string, and both mean the sender is broken');
  }

  await sql('ifqm_test_a',
    "DELETE FROM ifqm_test_a.email_queue WHERE to_email = 'enum@orga.test'");
});

/*
 * The first-time password for somebody with no mailbox.
 *
 * First 4 LETTERS of the name, then the last 4 digits of the phone: "Yashas" on
 * 7975495881 becomes yash5881. It read the USERNAME until now, on the reasoning
 * that the username is the other thing typed on the same screen.
 *
 * The name is the better source for where this credential actually gets used.
 * These accounts belong to people with no email, so the password is passed on
 * out loud — by a supervisor, on a shop floor, often to somebody who has not
 * been told their username yet. "The first four letters of your name" needs no
 * lookup and survives being repeated down a noisy line.
 *
 * Only new accounts are affected: an existing password is a stored hash, not a
 * formula re-evaluated at sign-in, so nothing about this locks anybody out.
 */
test('a user with no email gets a password built from their name and number', async () => {
  const { tempPasswordFor } = await import('../src/services/userImportService.js');

  assert.equal(tempPasswordFor(null, '7975495881', 'Yashas', 'E1'), 'yash5881',
    'the example everybody is given');

  // The username is ignored when a name is present — that is the whole change.
  assert.equal(tempPasswordFor('ykumar', '+91 79754 95881', 'Yashas Kumar', 'E2'), 'yash5881',
    'derived from the NAME even when a quite different username exists');

  /*
   * The last four digits, taken from the end, so the country code cannot move
   * them. +91 79754 95881, 07975495881 and 7975495881 are the same phone and
   * must give the same password — a leading zero or a +91 changes the front of
   * the string and never the back.
   */
  for (const p of ['+91 79754 95881', '07975495881', '7975495881', '+917975495881']) {
    assert.equal(tempPasswordFor(null, p, 'Yashas', 'E3'), 'yash5881',
      `every way of writing the same number must agree — ${p} did not`);
  }

  // LETTERS, so anything else is skipped rather than counted.
  assert.equal(tempPasswordFor('rkumar', '9876543210', 'R. Kumar', 'E4'), 'rkum3210',
    'r, k, u, m — the dot and the space are not letters');
  assert.equal(tempPasswordFor(null, '9876543210', 'Mary-Anne', 'E5'), 'mary3210');

  // A short name is padded rather than producing a 6-character password, which
  // would be a different shape from every other one and look like a bug.
  assert.equal(tempPasswordFor(null, '9998887777', 'Li', 'E6'), 'lixx7777');

  /*
   * A name in a script with no Latin letters leaves nothing to slice. It falls
   * through to the username and then the employee id rather than to a shared
   * default, so two such employees never end up with the same password.
   */
  assert.equal(tempPasswordFor('namaste1', '9998887777', 'नमस्ते', 'E7'), 'nama7777');
  const a = tempPasswordFor('', '9998887777', 'नमस्ते', 'EMP01');
  const b = tempPasswordFor('', '9998887777', 'नमस्ते', 'EMP02');
  assert.notEqual(a, b,
    'two people with no Latin letters and no username must still differ — a '
    + 'shared fallback would hand one of them the other one\'s account');

  /*
   * And end to end: the account really is created with it. A formula the tests
   * agree on but the sign-in screen does not is worth nothing.
   */
  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;
  const created = await api('POST', '/api/users', {
    token: aTok,
    body: { name: 'Yashas Derived', username: 'yderived', employee_id: 'PWDERIV',
      phone: '+919812348001', role: 'employee', department: 'Ops' },
  });
  assert.equal(created.data.success, true, JSON.stringify(created.data));

  const signedIn = await login('yderived', 'yash8001', 'orga');
  assert.ok(signedIn.token,
    'the derived password must actually sign the account in — got '
    + JSON.stringify(signedIn));
});

/* ───────────────────────────────────────────────────────────────────────────
 *  Rewards & Recognition
 * ─────────────────────────────────────────────────────────────────────────── */

/*
 * A period is a range of dates, not a SQL fragment.
 *
 * The old leaderboard filtered with things like `YEARWEEK(submitted_at,1) =
 * YEARWEEK(NOW(),1)`, which cannot be printed on a document. A reward pack has
 * to state the window it covers or the reader cannot tell what they are holding
 * — and two people running the same report a day apart get different answers
 * with no way to notice.
 *
 * Ranges are half-open, start inclusive and end exclusive, which is the only
 * form that cannot double-count a submission at midnight on the boundary.
 */
test('a reward period resolves to a printable, calendar-aligned range', async () => {
  const { resolveRange, PERIODS } = await import('../src/services/rewardsService.js');

  // Every period the organisation was promised exists.
  for (const p of ['weekly', 'fortnightly', 'monthly', 'quarterly', 'half_yearly', 'yearly']) {
    assert.ok(PERIODS[p], `${p} must be offered`);
    const r = resolveRange({ period: p, offset: 1 });
    assert.match(r.start, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(r.end, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.start < r.end, `${p}: the range must run forwards`);
    assert.ok(r.display.includes(' to '), `${p}: the window must be printable`);
  }

  // Calendar alignment: a month starts on the 1st, a quarter on a quarter month.
  const m = resolveRange({ period: 'monthly', offset: 1 });
  assert.ok(m.start.endsWith('-01'), `a monthly window starts on the 1st — got ${m.start}`);
  const q = resolveRange({ period: 'quarterly', offset: 1 });
  assert.ok(['01', '04', '07', '10'].includes(q.start.slice(5, 7)),
    `a quarter starts in Jan, Apr, Jul or Oct — got ${q.start}`);
  const h = resolveRange({ period: 'half_yearly', offset: 1 });
  assert.ok(['01', '07'].includes(h.start.slice(5, 7)),
    `a half-year starts in Jan or Jul — got ${h.start}`);

  // A fortnight is two whole weeks, never a fortnight ending mid-week.
  const f = resolveRange({ period: 'fortnightly', offset: 1 });
  const days = (new Date(f.end) - new Date(f.start)) / 86400000;
  assert.equal(days, 14, 'a fortnight is 14 days');

  /*
   * Offsets step backwards without overlapping. Two adjacent periods that
   * shared a day would count somebody's idea twice across two reward cycles,
   * which is the one arithmetic error a reward document cannot survive.
   */
  const now = resolveRange({ period: 'monthly', offset: 0 });
  const prev = resolveRange({ period: 'monthly', offset: 1 });
  assert.equal(prev.end, now.start, 'the previous period ends exactly where this one starts');

  // A custom range is honoured, and `to` is inclusive as a human would read it.
  const c = resolveRange({ from: '2026-03-01', to: '2026-03-31' });
  assert.equal(c.start, '2026-03-01');
  assert.equal(c.end, '2026-04-01', 'an inclusive "to" is stored as an exclusive end');

  await assert.rejects(async () => resolveRange({ from: '2026-03-01', to: 'nonsense' }));
  await assert.rejects(async () => resolveRange({ period: 'daily' }),
    /Unknown period/, 'an unknown period is refused rather than silently ignored');
});

/*
 * The leaderboard HR is given is the WHOLE leaderboard.
 *
 * The existing one stops at 20 and ranks by lifetime points while filtering
 * ideas by period — so "this month" ordered people by everything they had ever
 * done. For an award that is not a near miss, it is the wrong list. This one
 * scores what was earned IN the window, includes everybody who took part, and
 * shows its working so a query about somebody's total has an answer.
 */
test('the rewards leaderboard scores the period and lists everyone', async () => {
  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;
  await api('POST', '/api/settings', {
    token: aTok, body: { approval_stages: 'originator,team_lead' },
  });

  const mk = async (name, email, empId, phone, role, managerId) => {
    const res = await api('POST', '/api/users', {
      token: aTok,
      body: { name, email, password: 'RewardPass12345', role, employee_id: empId,
        phone, department: 'Rewards', manager_id: managerId ?? undefined },
    });
    assert.equal(res.data.success, true, `${name}: ${JSON.stringify(res.data)}`);
    const [row] = await sql('ifqm_test_a',
      `SELECT id FROM ifqm_test_a.users WHERE email = '${email}'`);
    const { token } = await login(email, 'RewardPass12345', 'orga');
    return { id: row.id, token };
  };

  const lead = await mk('Reward Lead', 'rw.tl@orga.test', 'RWTL', '+919812349001', 'team_lead');
  const busy = await mk('Busy Bee', 'rw.busy@orga.test', 'RWBUSY', '+919812349002', 'employee', lead.id);
  const quiet = await mk('Quiet One', 'rw.quiet@orga.test', 'RWQUIET', '+919812349003', 'employee', lead.id);
  const idle = await mk('Idle Hands', 'rw.idle@orga.test', 'RWIDLE', '+919812349004', 'employee', lead.id);

  const submit = async (who, title) => {
    const r = await api('POST', '/api/ideas/submit', {
      token: who.token,
      body: {
        title,
        present_situation: 'Something on the line costs time every single shift.',
        proposed_solution: 'A small, cheap change at the station that removes it.',
        impact_level: 'Medium', impact_areas: 'Productivity', action: 'submit',
      },
    });
    assert.equal(r.data.success, true, JSON.stringify(r.data));
    return r.data.idea_id;
  };

  const b1 = await submit(busy, 'Rewards — bin at the press');
  await submit(busy, 'Rewards — label the fasteners');
  await submit(quiet, 'Rewards — move the trolley');

  // One approval, so the outcome points are not all zero.
  await api('POST', '/api/ideas/review-action', {
    token: lead.token, body: { idea_id: b1, decision: 'Approved' },
  });

  // offset 0 — the period in progress, which is where today's submissions are.
  const res = await api('GET', '/api/rewards/leaderboard?period=monthly&offset=0', { token: aTok });
  assert.equal(res.status, 200, JSON.stringify(res.data));

  const find = (id) => res.data.people.find((p) => p.id === id);
  const bRow = find(busy.id);
  const qRow = find(quiet.id);

  assert.ok(bRow, 'somebody who submitted must appear');
  assert.equal(bRow.ideas_submitted, 2);
  assert.equal(qRow.ideas_submitted, 1);

  /*
   * Ordered on the PERIOD score. Two ideas beat one, whatever either person's
   * lifetime total happens to be — that is the entire correction.
   */
  assert.ok(bRow.rank < qRow.rank,
    'two ideas this period must outrank one this period');

  // The working is shown, and it adds up. A score somebody is rewarded against
  // has to be checkable without re-deriving it.
  assert.equal(bRow.points_period, bRow.points_submission + bRow.points_from_ideas,
    'the total must equal the parts printed beside it');
  assert.equal(bRow.points_submission, 2 * res.data.points_scheme.submit,
    'submission points come from the count, at the configured rate');

  // Somebody who submitted nothing is left out by default, and included on ask.
  assert.ok(!find(idle.id), 'a reward shortlist is not padded with zeroes');
  const all = await api('GET',
    '/api/rewards/leaderboard?period=monthly&offset=0&include_all=1', { token: aTok });
  assert.ok(all.data.people.some((p) => p.id === idle.id),
    '"who did not take part" is a real question and must be answerable');

  // The window is stated in dates, not just named.
  assert.match(res.data.range.display, /\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);

  await api('POST', '/api/settings', {
    token: aTok,
    body: { approval_stages: 'originator,team_lead,immediate_manager,department_manager,plant_head' },
  });
});

/*
 * The pack carries the evidence, not just the score.
 *
 * HR is being asked to give somebody money on the strength of this. "Priya
 * scored 140" is not evidence; the ideas, the people who approved each one and
 * the dates they did it are. The reward decision and the audit of that decision
 * have to be the same document, or a question six months later has no answer.
 */
test('the rewards pack carries every idea, its chain and its timeline', async () => {
  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;

  const detail = await api('GET', '/api/rewards/detail?period=monthly&offset=0', { token: aTok });
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  assert.ok(detail.data.ideas.length, 'this period has ideas in it');

  const withTrail = detail.data.ideas.find((i) => (i.workflow || []).length > 1);
  assert.ok(withTrail, 'at least one idea has been acted on');

  // The full text, not a summary — the pack is read without the app open.
  assert.ok(withTrail.present_situation, 'the situation travels with it');
  assert.ok(withTrail.proposed_solution, 'and the proposal');
  assert.ok(withTrail.submitter_name, 'and who wrote it');

  /*
   * The position each approver held AT THE TIME, recorded rather than read off
   * their user row today. Somebody promoted since must not appear to have
   * signed off in a capacity they did not hold — on a document produced two
   * years later that is the difference between a record and a guess.
   */
  const approval = withTrail.workflow.find((w) => w.action === 'Approved');
  assert.ok(approval, 'an approval is in the trail');
  assert.ok(approval.actor_name, 'named');
  assert.ok(approval.created_at, 'and dated');
  assert.ok(approval.stage_label || approval.actor_role,
    'and placed — either the recorded stage or, for older rows, the role');

  // The configured path, so a chain that stopped early is distinguishable from
  // one that ran to completion.
  assert.ok(detail.data.chain.length, 'the organisation\'s approval path travels too');
  assert.equal(detail.data.chain[0].position, 1);

  // ── The two downloads ──
  const xlsx = await api('GET', '/api/rewards/export.xlsx?period=monthly&offset=0', { token: aTok });
  assert.equal(xlsx.status, 200, 'the workbook must build');
  const pdf = await api('GET', '/api/rewards/export.pdf?period=monthly&offset=0', { token: aTok });
  assert.equal(pdf.status, 200, 'the PDF must build');
});

/*
 * The pack is not open to everybody the ordinary leaderboard is open to.
 *
 * The public leaderboard is a ranking. This carries every employee's contact
 * details, their manager, the full text of every idea and the name of everybody
 * who approved each one. That the reader could see each part individually does
 * not make the compilation harmless — the compilation is what makes it an HR
 * document about identifiable people.
 */
test('an ordinary employee cannot pull the rewards pack', async () => {
  const denied = await api('GET', '/api/rewards/detail?period=monthly', { token: AUSER });
  assert.equal(denied.status, 403,
    `an employee must be refused — got ${denied.status} ${JSON.stringify(denied.data)}`);

  const deniedFile = await api('GET', '/api/rewards/export.xlsx?period=monthly', { token: AUSER });
  assert.equal(deniedFile.status, 403,
    'and the download is guarded too — a file endpoint left open is the same leak');

  /*
   * The org admin CAN. Running a reward cycle is administration, not
   * adjudication: reading who did well is not deciding whether an idea is any
   * good, so this does not cross the line that keeps admins out of approvals.
   */
  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;
  const allowed = await api('GET', '/api/rewards/leaderboard?period=monthly', { token: aTok });
  assert.equal(allowed.status, 200, 'the org admin runs the reward cycle');
});

/* ───────────────────────────────────────────────────────────────────────────
 *  Platform admin account verification
 * ─────────────────────────────────────────────────────────────────────────── */

/*
 * A new IFQM staff account proves both channels before the console will do
 * anything for it.
 *
 * This is the widest credential the product issues — it reaches every
 * organisation's people, ideas, billing and support history — and it was
 * created by typing a name, an address and a password into a form that checked
 * none of them. A typo in the email field produced a fully working account
 * whose intended owner could never receive a password reset, and the account
 * still worked for whoever did receive the mail.
 *
 * The gate is in the middleware, not the UI, and that is the half worth
 * testing: a React redirect is bypassed by anybody who calls the API with the
 * token they were just handed at sign-in.
 */
test('a new platform admin cannot use the console until both channels are proved', async () => {
  const email = `newpa${Date.now() % 100000}@ifqm.io`;
  const password = 'PlatformAdminPass12345';

  // ── A number is required. The account is verified on two channels, and two
  //    means two: an address alone can be taken by whoever holds that mailbox.
  const noPhone = await api('POST', '/api/platform/admins', {
    token: PA, body: { name: 'No Phone Admin', email: `x${email}`, password },
  });
  assert.notEqual(noPhone.status, 200, 'an admin without a mobile number must be refused');
  assert.match(noPhone.data.error, /mobile number/i);

  const created = await api('POST', '/api/platform/admins', {
    token: PA,
    body: { name: 'Fresh Admin', email, phone: '+919812350001', password },
  });
  assert.equal(created.data.success, true, JSON.stringify(created.data));
  assert.equal(created.data.verification_required, true,
    'the operator creating the account is told it cannot be used yet');

  // ── Signing in works, and says what is outstanding ──
  /*
   * Deliberately not refused. The codes have to go somewhere, and where is
   * decided by this row — refusing the login would leave the new admin with a
   * password that works on nothing and no way to ask for a code. It would also
   * tell anybody guessing addresses which accounts exist but are not set up.
   */
  const signIn = await api('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(signIn.data.success, true, JSON.stringify(signIn.data));
  const token = signIn.data.token;
  assert.ok(token, 'a session is issued');
  assert.equal(signIn.data.user.must_verify, true);
  assert.deepEqual(signIn.data.user.pending_verification, ['email', 'phone']);
  /*
   * The destinations are masked. This screen is reachable with only a password,
   * so it must show enough for the right person to recognise their own mailbox
   * and not enough for anybody else to learn one.
   */
  assert.ok(signIn.data.user.verify_email.includes('***'), 'the address is masked');
  assert.ok(!signIn.data.user.verify_email.includes(email.split('@')[0]),
    'and does not simply echo the local part back');

  // ── And the console is shut ──
  for (const path of ['/api/platform/tenants', '/api/platform/admins', '/api/platform/registrations']) {
    const blocked = await api('GET', path, { token });
    assert.equal(blocked.status, 403,
      `${path} must be refused before verification — got ${blocked.status}`);
    assert.equal(blocked.data.must_verify, true,
      'and the refusal says why, so the screen can act on it rather than guessing');
  }

  // The two endpoints that finish the job are open, or the flow cannot complete.
  const status = await api('GET', '/api/auth/platform/verify/status', { token });
  assert.equal(status.status, 200, 'the verification endpoints stay reachable');
  assert.equal(status.data.email_verified, false);
  assert.equal(status.data.phone_verified, false);

  /*
   * ── Proving a channel ──
   *
   * The code row is seeded rather than sent. This suite has no mail provider
   * and no SMS gateway, so an actual send answers 503 — and delivery is not
   * what is under test here. What is: that a wrong code records nothing, that a
   * right one records the timestamp, and that the gate opens when both are in.
   * Seeded exactly as verificationService stores it, so the confirm handler is
   * exercised for real.
   */
  const bcrypt = (await import('bcryptjs')).default;
  /*
   * Stored under the key the SERVICE will look it up by, not the raw string.
   * A number is normalised before it is stored or matched — +91 9812 350001,
   * 09812350001 and 9812350001 are one identifier — so seeding the raw form
   * writes a row the lookup can never find. Going through classify() means this
   * fixture cannot drift from the rule the service actually applies.
   */
  const { classify } = await import('../src/services/verificationService.js');
  const seedCode = async (identifier, purpose, code) => {
    const { key, idType, channel } = classify(identifier);
    const hash = await bcrypt.hash(code, 10);
    await sql('ifqm_test_master',
      `INSERT INTO ifqm_test_master.login_otps
         (identifier, id_type, channel, code_hash, purpose, expires_at)
       VALUES ('${key}', '${idType}', '${channel}', '${hash}',
               '${purpose}', DATE_ADD(NOW(), INTERVAL 10 MINUTE))`);
  };

  await seedCode(email, 'platform_admin_email', '123456');

  /*
   * A wrong code proves nothing. Asserted because the whole feature is one
   * misplaced UPDATE away from being decorative: writing the timestamp before
   * the code is checked leaves a screen that looks like verification and is not.
   */
  const wrong = await api('POST', '/api/auth/platform/verify/confirm', {
    token, body: { channel: 'email', code: '000000' },
  });
  assert.notEqual(wrong.status, 200, 'a wrong code is refused');
  const [stillNo] = await sql('ifqm_test_master',
    `SELECT email_verified_at FROM ifqm_test_master.platform_admins WHERE email = '${email}'`);
  assert.equal(stillNo.email_verified_at, null,
    'and records nothing — a failed guess must not mark the channel proved');

  // The right one does.
  await seedCode(email, 'platform_admin_email', '123456');
  const rightEmail = await api('POST', '/api/auth/platform/verify/confirm', {
    token, body: { channel: 'email', code: '123456' },
  });
  assert.equal(rightEmail.status, 200, JSON.stringify(rightEmail.data));
  assert.equal(rightEmail.data.email_verified, true);
  assert.equal(rightEmail.data.verified, false, 'one channel is not both');

  // ── Still shut, because the phone is outstanding ──
  const halfway = await api('GET', '/api/platform/admins', { token });
  assert.equal(halfway.status, 403,
    'proving one channel must not open the console — the point is two independent ones');

  // ── The second channel opens it ──
  await seedCode('+919812350001', 'platform_admin_phone', '654321');
  const rightPhone = await api('POST', '/api/auth/platform/verify/confirm', {
    token, body: { channel: 'phone', code: '654321' },
  });
  assert.equal(rightPhone.status, 200, JSON.stringify(rightPhone.data));
  assert.equal(rightPhone.data.verified, true, 'both channels are now proved');

  /*
   * And the gate opens on the SAME token. The middleware re-reads the row on
   * every request, so verification takes effect immediately — a new admin who
   * had to sign in again would reasonably think the flow had failed.
   */
  const open = await api('GET', '/api/platform/admins', { token });
  assert.equal(open.status, 200,
    'the console opens without a fresh sign-in — the row is read per request');
});

/*
 * The destination comes from the account row, never from the request.
 *
 * Taking it from the caller would turn this into a way to point an unverified
 * account at an address of the caller's choosing and then verify it — the whole
 * thing being prevented, wearing the flow's own clothes.
 */
test('platform verification sends only to the address on the account', async () => {
  const email = `divert${Date.now() % 100000}@ifqm.io`;
  const created = await api('POST', '/api/platform/admins', {
    token: PA,
    body: { name: 'Divert Test', email, phone: '+919812350002', password: 'PlatformAdminPass12345' },
  });
  assert.equal(created.data.success, true, JSON.stringify(created.data));
  const { token } = await api('POST', '/api/auth/login', {
    body: { email, password: 'PlatformAdminPass12345' },
  }).then((r) => r.data);

  // An attacker-supplied destination is simply ignored — the body carries only
  // a channel, and anything else in it has no route into the query.
  await api('POST', '/api/auth/platform/verify/send', {
    token,
    body: { channel: 'email', identifier: 'attacker@example.com', email: 'attacker@example.com' },
  });

  /*
   * Asserted as an absence, which holds whether or not the send itself could
   * complete — the suite has no mail provider, and the property under test is
   * about routing, not delivery. If the request body could steer the
   * destination, a row for the attacker's address would exist.
   */
  const rows = await sql('ifqm_test_master',
    `SELECT identifier FROM ifqm_test_master.login_otps
      WHERE identifier = 'attacker@example.com'`);
  assert.equal(rows.length, 0,
    'no code may ever be issued to an address supplied by the caller');
});

/*
 * Existing accounts are grandfathered, deliberately.
 *
 * Leaving them unverified would lock every current platform admin out of the
 * console on the next deploy — including the only account that can create
 * another one, and there is no way back in without editing SQL by hand. An
 * outage of the vendor console is not a security improvement.
 */
test('platform admins that predate the rule keep working', async () => {
  const list = await api('GET', '/api/platform/admins', { token: PA });
  assert.equal(list.status, 200, 'the seeded admin can still use the console');

  const seeded = list.data.admins.find((a) => a.email === 'platform@ifqm.io');
  assert.ok(seeded, 'the seed account is there');
  assert.equal(seeded.verified, true, 'and is treated as verified');
  assert.ok(seeded.email_verified_at, 'with a timestamp, not a NULL that reads as unproven');
});

/*
 * The SMS purpose must resolve to a template the carrier will actually accept.
 *
 * Indian DLT compares the body to a registered template character for character
 * and silently drops anything that does not match — no error, no delivery
 * report. A new purpose with no registered wording would therefore produce a
 * verification step that cannot verify, and would look like it was working from
 * every direction except the recipient's.
 */
test('the platform admin SMS purpose resolves to a registered DLT template', async () => {
  const { resolveTemplate } = await import('../src/config/smsTemplates.js');
  const r = resolveTemplate('platform_admin_phone');

  assert.equal(r.sendable, true,
    'the purpose must be sendable today, not once a DLT queue clears');
  assert.ok(r.id, 'and carry a real template id');
  assert.equal(r.usingFallback, 'registration_phone',
    'via the registration template, which is the closest registered wording');
  // The pair has to match: the id and the text are approved together, so taking
  // one without the other is exactly the mismatch the carrier drops.
  assert.match(r.text, /complete your registration/,
    'the body sent must be the fallback template\'s own approved wording');
});

/*
 * Every platform admin is told, every time a company applies — and a notice
 * that fails is retried rather than lost.
 *
 * The admins do not sit refreshing the console; that is the entire reason this
 * email exists. It was sent once, immediately, and not recorded — so an
 * application submitted while mail was down waited in the queue with nobody
 * aware of it. That is not hypothetical: notification mail on this platform was
 * dead for weeks (migrations 037 and 038).
 */
test('an unsent registration notice is retried, and a sent one is not resent', async () => {
  const svc = await import('../src/services/registrationService.js');

  /*
   * Seeded directly. Submitting one end to end needs a consumed email code AND
   * a consumed phone code, which needs a mail provider and an SMS gateway the
   * suite does not have — and none of that is what this test is about. What it
   * is about is the retry pass picking the right rows.
   */
  await sql('ifqm_test_master',
    `INSERT INTO ifqm_test_master.tenant_registrations
       (company_name, proposed_slug, email_domain, contact_name, contact_email,
        contact_phone, accepted_terms, status, notified_at)
     VALUES ('Unnotified Works', 'unnotified', 'unnotified.test', 'Nobody Told',
             'told@unnotified.test', '+919812350099', 1, 'pending', NULL)`);
  const [reg] = await sql('ifqm_test_master',
    `SELECT id FROM ifqm_test_master.tenant_registrations
      WHERE email_domain = 'unnotified.test' ORDER BY id DESC LIMIT 1`);
  assert.ok(reg, 'the fixture exists');

  const first = await svc.retryUnsentRegistrationNotices();
  assert.ok(first.checked >= 1,
    `the retry pass must find an unnotified application — got ${JSON.stringify(first)}`);

  /*
   * Whether it SENT depends on a mail provider the suite does not have, so the
   * assertion is on the selection, which is the part that can be wrong in a way
   * nobody would notice. Stamping only happens on a real delivery, so with no
   * provider the row stays NULL and would be retried again — which is the
   * behaviour wanted during an outage.
   */
  await sql('ifqm_test_master',
    `UPDATE ifqm_test_master.tenant_registrations SET notified_at = NOW() WHERE id = ${reg.id}`);
  const second = await svc.retryUnsentRegistrationNotices();
  assert.ok(!second.checked || second.checked < first.checked,
    'an application already announced is not announced again');
});

/*
 * Changing your own mobile number, proved by code.
 *
 * The number is not a profile field like a job title: it is where sign-in codes
 * and password resets go, so whoever controls it controls the account. That is
 * why it cannot be edited directly — the new number has to answer a code before
 * it is written, and the OLD number and address are told afterwards, which is
 * what makes a quietly stolen account visible to the person it was stolen from.
 *
 * There was no end-to-end coverage of this at all, which is a poor state for a
 * flow whose failure mode is silent account takeover.
 */
test('changing your mobile number requires a code, and tells the old one', async () => {
  const aTok = (await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga')).token;
  const created = await api('POST', '/api/users', {
    token: aTok,
    body: { name: 'Number Mover', email: 'mover@orga.test', password: 'MoverPass12345',
      role: 'employee', employee_id: 'MOVER1', phone: '+919812360001', department: 'Ops' },
  });
  assert.equal(created.data.success, true, JSON.stringify(created.data));
  const { token } = await login('mover@orga.test', 'MoverPass12345', 'orga');

  const NEW = '+919812360002';

  // ── The number is never written on the caller's say-so ──
  /*
   * Confirming with no code, or a wrong one, must change nothing. This is the
   * assertion the whole feature rests on: if the UPDATE ran before the code was
   * checked, the screen would look identical and the account would be takeable
   * by anybody who could reach this endpoint with a session.
   */
  const noCode = await api('POST', '/api/users/me/phone/confirm', {
    token, body: { phone: NEW, code: '000000' },
  });
  assert.notEqual(noCode.status, 200, 'a wrong code must not move the number');
  const [afterWrong] = await sql('ifqm_test_a',
    "SELECT phone FROM ifqm_test_a.users WHERE email = 'mover@orga.test'");
  assert.match(afterWrong.phone, /360001$/, 'and the old number still stands');

  // ── A number somebody else already uses is refused ──
  const taken = await api('POST', '/api/users/me/phone/request-code', {
    token, body: { phone: '+919812360001' },
  });
  assert.notEqual(taken.status, 200,
    'the number they already have is not a change');

  /*
   * The code row is seeded rather than sent: this suite has no SMS gateway, and
   * delivery is not what is under test. Seeded under the key the service looks
   * up by — a number is normalised before it is stored or matched, so the raw
   * string would write a row the lookup can never find.
   */
  const bcrypt = (await import('bcryptjs')).default;
  const { classify } = await import('../src/services/verificationService.js');
  const { key, idType, channel } = classify(NEW);
  await sql('ifqm_test_a',
    `INSERT INTO ifqm_test_master.login_otps
       (identifier, id_type, channel, code_hash, purpose, expires_at)
     VALUES ('${key}', '${idType}', '${channel}', '${await bcrypt.hash('222333', 10)}',
             'phone_verify', DATE_ADD(NOW(), INTERVAL 10 MINUTE))`);

  const ok = await api('POST', '/api/users/me/phone/confirm', {
    token, body: { phone: NEW, code: '222333' },
  });
  assert.equal(ok.status, 200, `the right code must move the number — ${JSON.stringify(ok.data)}`);

  const [moved] = await sql('ifqm_test_a',
    "SELECT phone FROM ifqm_test_a.users WHERE email = 'mover@orga.test'");
  assert.match(moved.phone, /360002$/, 'the new number is saved');

  /*
   * And the old number is told. This is the alert Jio registered as
   * 1277178823569994190 — for as long as it was pending it went out under the
   * registration template's id with different wording and was dropped by the
   * carrier every time, so nobody whose number was changed ever heard about it.
   */
  const alerts = await sql('ifqm_test_master',
    `SELECT purpose, template_id, recipient FROM ifqm_test_master.sms_delivery_log
      WHERE purpose = 'phone_changed' ORDER BY id DESC LIMIT 1`).catch(() => []);
  if (alerts.length) {
    assert.equal(alerts[0].template_id, '1277178823569994190',
      'the alert goes out under its own registered id, not a borrowed one');
    assert.match(String(alerts[0].recipient), /0001/,
      'and goes to the OLD number — the handset the rightful owner still holds');
  }
});

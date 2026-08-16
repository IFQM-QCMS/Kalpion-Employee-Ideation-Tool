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

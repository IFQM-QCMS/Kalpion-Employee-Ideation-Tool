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
    gstin: '29ABCDE1234F1Z5', pan: 'ABCDE1234F',
    entity_type: 'private_limited', enterprise_category: 'small',
    sector: 'Manufacturing', employee_count: '85', year_established: '2015',
    accepted_terms: true,
  };

  // The mandatory set, and nothing else at all.
  const row = validateApplication({ ...base });
  assert.ok(row, 'the §13 mandatory set alone must be enough to apply');
  assert.equal(row.gstin, '29ABCDE1234F1Z5');
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
   * Adding a corporate domain would be a no-op that reads as an action:
   * somebody adds it, sees it listed, and believes they granted something that
   * was never blocked. Refused with an explanation instead.
   */
  const pointless = await api('POST', '/api/platform/registrations/whitelist', {
    token: PA, body: { entry: 'nandiprecision.com' },
  });
  assert.notEqual(pointless.status, 201, 'a domain that was never blocked must be refused');
  assert.match(pointless.data.error, /already accepted/i);

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

// ── The user guide, and the approval chain on the closure PDF ────────────────
test('the user guide downloads for any signed-in role, and not anonymously', async () => {
  const anon = await api('GET', '/api/export/user-guide');
  assert.ok(anon.status === 401 || anon.status === 403,
    `the guide must not be served anonymously — got ${anon.status}`);

  /*
   * Any authenticated role, including an ordinary employee. It documents the
   * software rather than anybody's data, so scoping it to admins would only
   * keep it from the people most likely to need it.
   */
  const res = await api('GET', '/api/export/user-guide', { token: AUSER });
  assert.ok(res.status === 200 || res.status === 404,
    `an employee must get the guide or an honest 404, got ${res.status}`);
  if (res.status === 404) {
    // A deployment shipped without docs/ is a packaging choice, not a crash —
    // but it must say so rather than serving a broken file.
    assert.equal(res.data.success, false);
    assert.match(res.data.error, /not available/i);
  }
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

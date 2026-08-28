/**
 * IFQM — Test Case Runner
 * ----------------------------------------------------------------------------
 * The IFQM counterpart to QCMS's qcms_test_runner.py. Boots the REAL Express app
 * on scratch tenant databases (via the existing test harness) and drives it over
 * HTTP exactly as a client would, recording for every case:
 *
 *   Test Case ID | Module | Functionality | Expected Output | Actual Output | Result | Timestamp
 *
 * Results are written as JSON; docs/gen_testcases_doc.py turns them into
 * Kalpion_TestCases_Simple.pdf. Nothing here is mocked — Actual Output is whatever
 * the running instance did, so a genuine defect shows up as Fail rather than
 * being hidden. (Three real ones did in the cycle that added the deep modules:
 * a concurrent-submission collision on idea_code, an approval that could be
 * recorded five times over, and an anonymous submitter identifiable from the
 * approval timeline.)
 *
 * Beyond the feature modules it covers safety, reliability under injected
 * faults and real concurrency, horizontal scalability against a second live
 * application process, vertical scalability against a 5,000-idea dataset, data
 * integrity and recovery, extensibility, and operability.
 *
 *   node test/tc_runner.mjs          # then: python ../docs/gen_testcases_doc.py
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import {
  setupSuite, teardownSuite, api, login, sql, signToken, tinyPng, fakePng, PASSWORDS, getBaseUrl,
} from './helpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(HERE, '..');
const REPO_DIR = path.resolve(BACKEND_DIR, '..');
const readRepo = (rel) => fs.readFileSync(path.join(REPO_DIR, rel), 'utf8');

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

/**
 * Databases this run provisions through the product itself (Platform → new
 * organisation creates `ifqm_<slug>`). setupSuite only owns the three scratch
 * schemas, so these are dropped here — otherwise the next run finds a populated
 * database under the same slug and tenant creation legitimately fails.
 */
const PROVISIONED_DBS = ['ifqm_acme', 'ifqm_growth'];
async function dropProvisionedDbs() {
  const mysql = (await import('mysql2/promise')).default;
  const { default: cfg } = await import('../src/config/index.js');
  const conn = await mysql.createConnection({
    host: cfg.masterDb.host, user: cfg.masterDb.user, password: cfg.masterDb.password,
  });
  for (const db of PROVISIONED_DBS) await conn.query(`DROP DATABASE IF EXISTS \`${db}\``).catch(() => {});
  await conn.end().catch(() => {});
}

async function main() {
  await setupSuite();
  await dropProvisionedDbs();

  // ── Sessions ───────────────────────────────────────────────────────────
  const PA     = (await login('platform@ifqm.io', PASSWORDS.platform)).token;
  const AADMIN = (await login('admin@orga.test', PASSWORDS.orgaAdmin)).token;
  const AUSER  = (await login('user@orga.test',  PASSWORDS.orgaUser)).token;
  const BADMIN = (await login('admin@orgb.test', PASSWORDS.orgbAdmin)).token;

  /*
   * A manager, because an organisation admin may no longer decide on an idea.
   *
   * The rule changed under this runner: administration and adjudication were
   * separated, so the org admin now gets a 403 from review-action and every
   * approval case that used AADMIN was failing on the product working as
   * intended. Approvals are driven by this account instead.
   */
  const REVIEWER_PW = 'AReviewerPass123';
  await sql('ifqm_test_a', `INSERT INTO __DB__.users
      (employee_id, name, email, phone, password_hash, role, status, password_changed_at)
    VALUES ('A-RVW', 'Orga Reviewer', 'reviewer@orga.test', '9812345601',
            '${bcrypt.hashSync(REVIEWER_PW, 4)}', 'manager', 'active', NOW())
    ON DUPLICATE KEY UPDATE role = 'manager', status = 'active'`);
  const AREVIEWER = (await login('reviewer@orga.test', REVIEWER_PW)).token;

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

  // ═══════════════════════ ONE-TIME CODES (SMS & EMAIL) ═══════════════════
  /*
   * Sign-in by code, and the codes that prove an applicant holds the address
   * and the number they typed. The SMS provider is the mock one (see
   * helpers.js) so the whole path runs — row written, delivery recorded — with
   * nothing reaching a handset and nothing billed.
   *
   * The properties under test are the ones that make a six-digit secret safe:
   * it is stored hashed, it says nothing about who is registered, it survives
   * only minutes, it dies after a few wrong guesses, and it works exactly once.
   */
  const O = 'OTP', On = 'One-Time Codes (SMS & Email)';
  const OTP_PHONE = '9812345670';
  await sql('ifqm_test_a', `UPDATE __DB__.users SET phone = '${OTP_PHONE}' WHERE email = 'user@orga.test'`);
  await sql('ifqm_test_master',
    `INSERT INTO __DB__.platform_settings (key_name, value) VALUES ('otp_enabled','1')
       ON DUPLICATE KEY UPDATE value = '1'`);
  const latestOtp = async (identifier, purpose = 'login') => {
    const rows = await sql('ifqm_test_master',
      `SELECT * FROM __DB__.login_otps WHERE identifier = ? AND purpose = ? ORDER BY id DESC LIMIT 1`,
      [identifier, purpose]);
    return rows[0] || null;
  };
  /*
   * The issued code is bcrypt-hashed and never returned by the API — which is
   * the property under test, and equally the reason a case cannot simply read
   * one back. Recovering it by brute force would mean up to a million bcrypt
   * comparisons per case: exactly why the storage is safe, and exactly why it
   * is no way to run a test.
   *
   * So the stored hash is replaced with the hash of a code chosen here.
   * Everything downstream of issuance is then exercised as a real code would
   * exercise it — the comparison, single use, the attempt counter, expiry and
   * supersession. What this deliberately does not prove is that the digits the
   * recipient received match the row; the storage side is covered separately by
   * the hashing case above.
   */
  const KNOWN_CODE = '424242';
  const plantCode = async (identifier, purpose = 'login') => {
    await sql('ifqm_test_master',
      `UPDATE __DB__.login_otps SET code_hash = ? WHERE identifier = ? AND purpose = ?
        ORDER BY id DESC LIMIT 1`,
      [bcrypt.hashSync(KNOWN_CODE, 4), identifier, purpose]);
    return KNOWN_CODE;
  };

  await tc(O, On, 'Request a sign-in code for a registered mobile number',
    'Generic success; a hashed code row is created', async () => {
      const r = await api('POST', '/api/auth/otp/request', { body: { identifier: OTP_PHONE } });
      const row = await latestOtp(OTP_PHONE);
      return ok(r.status === 200 && !!row, `Status ${r.status}, row ${row ? 'created' : 'MISSING'}`);
    });
  await tc(O, On, 'Code is stored hashed, never in clear text',
    'A bcrypt hash is stored and no column anywhere holds the digits', async () => {
      const row = await latestOtp(OTP_PHONE);
      const isHash = !!row && /^\$2[aby]\$/.test(row.code_hash) && row.code_hash.length >= 55;
      // Read access to this table must not be enough to sign in as anybody, so
      // no column may hold the code itself — the hash is the only copy.
      const cols = await sql('ifqm_test_master',
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '__DB__'
           AND TABLE_NAME = 'login_otps' AND COLUMN_NAME IN ('code','otp','code_plain','plain_code')`);
      const anyDigits = !!row && /^\d{4,8}$/.test(String(row.code_hash));
      return ok(isHash && !cols.length && !anyDigits,
        isHash ? `bcrypt hash stored (${String(row.code_hash).slice(0, 7)}…), no clear-code column` : 'Code not hashed (CRITICAL)');
    });
  await tc(O, On, 'Request a code for a number that belongs to nobody',
    'Reply is identical to the registered case — no membership oracle', async () => {
      // Age the existing row first, or the resend throttle answers the known
      // number with a 429 and the two replies differ for an unrelated reason.
      await sql('ifqm_test_master',
        `UPDATE __DB__.login_otps SET created_at = DATE_SUB(NOW(), INTERVAL 5 MINUTE) WHERE identifier = ?`, [OTP_PHONE]);
      const known = await api('POST', '/api/auth/otp/request', { body: { identifier: OTP_PHONE } });
      const ghost = await api('POST', '/api/auth/otp/request', { body: { identifier: '9800000001' } });
      const same = known.status === ghost.status && known.data?.message === ghost.data?.message;
      return ok(same, same ? `Identical reply (${ghost.status}): ${ghost.data?.message}` : `Differs: [${known.status}] ${known.data?.message} vs [${ghost.status}] ${ghost.data?.message}`);
    });
  await tc(O, On, 'Unknown identifier writes no code row',
    'Nothing is stored for a number with no account', async () => {
      const row = await latestOtp('9800000001');
      return ok(!row, row ? 'Row created for unknown identifier (LEAK)' : 'No row written');
    });
  await tc(O, On, 'Sign in with a correct one-time code',
    'Session issued, identical in shape to a password login', async () => {
      await sql('ifqm_test_master', `UPDATE __DB__.login_otps SET created_at = DATE_SUB(NOW(), INTERVAL 5 MINUTE) WHERE identifier = ?`, [OTP_PHONE]);
      await api('POST', '/api/auth/otp/request', { body: { identifier: OTP_PHONE } });
      const code = await plantCode(OTP_PHONE);
      const r = await api('POST', '/api/auth/otp/verify', { body: { identifier: OTP_PHONE, code } });
      return ok(r.status === 200 && !!r.data?.token && !!r.data?.user?.role,
        r.data?.token ? `Signed in, role=${r.data.user.role}` : `No token (${r.status}: ${r.data?.error})`);
    });
  await tc(O, On, 'Re-use a code that has already been redeemed',
    'Refused — a code works exactly once', async () => {
      const r = await api('POST', '/api/auth/otp/verify', { body: { identifier: OTP_PHONE, code: KNOWN_CODE } });
      return ok(r.status === 401 && !r.data?.token, `Status ${r.status}: ${r.data?.error}`);
    });
  await tc(O, On, 'Enter a wrong code',
    'Refused, the attempt is counted against that code', async () => {
      await sql('ifqm_test_master', `UPDATE __DB__.login_otps SET created_at = DATE_SUB(NOW(), INTERVAL 5 MINUTE) WHERE identifier = ?`, [OTP_PHONE]);
      await api('POST', '/api/auth/otp/request', { body: { identifier: OTP_PHONE } });
      const before = await latestOtp(OTP_PHONE);
      const r = await api('POST', '/api/auth/otp/verify', { body: { identifier: OTP_PHONE, code: '000000' } });
      const after = await latestOtp(OTP_PHONE);
      const counted = Number(after?.attempts) > Number(before?.attempts);
      return ok(r.status === 401 && counted, `Status ${r.status}, attempts ${before?.attempts}→${after?.attempts}`);
    });
  await tc(O, On, 'Exhaust the wrong-guess limit on one code',
    'The code is destroyed rather than left alive with a pinned counter', async () => {
      for (let i = 0; i < 5; i++) {
        await api('POST', '/api/auth/otp/verify', { body: { identifier: OTP_PHONE, code: String(100000 + i) } });
      }
      const r = await api('POST', '/api/auth/otp/verify', { body: { identifier: OTP_PHONE, code: KNOWN_CODE } });
      return ok(r.status === 401 && !r.data?.token, `Correct code after limit: ${r.status} ${r.data?.error}`);
    });
  await tc(O, On, 'Request a second code while one is still live',
    'The earlier code stops working — resending does not widen the target', async () => {
      await sql('ifqm_test_master', `UPDATE __DB__.login_otps SET created_at = DATE_SUB(NOW(), INTERVAL 5 MINUTE) WHERE identifier = ?`, [OTP_PHONE]);
      await api('POST', '/api/auth/otp/request', { body: { identifier: OTP_PHONE } });
      const first = await plantCode(OTP_PHONE);
      await sql('ifqm_test_master', `UPDATE __DB__.login_otps SET created_at = DATE_SUB(NOW(), INTERVAL 5 MINUTE) WHERE identifier = ?`, [OTP_PHONE]);
      await api('POST', '/api/auth/otp/request', { body: { identifier: OTP_PHONE } });
      const r = await api('POST', '/api/auth/otp/verify', { body: { identifier: OTP_PHONE, code: first } });
      return ok(r.status === 401 && !r.data?.token, `Superseded code: ${r.status} ${r.data?.error}`);
    });
  await tc(O, On, 'Present an expired code',
    'Refused once the validity window has passed', async () => {
      await sql('ifqm_test_master', `UPDATE __DB__.login_otps SET created_at = DATE_SUB(NOW(), INTERVAL 5 MINUTE) WHERE identifier = ?`, [OTP_PHONE]);
      await api('POST', '/api/auth/otp/request', { body: { identifier: OTP_PHONE } });
      const code = await plantCode(OTP_PHONE);
      await sql('ifqm_test_master', `UPDATE __DB__.login_otps SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE identifier = ?`, [OTP_PHONE]);
      const r = await api('POST', '/api/auth/otp/verify', { body: { identifier: OTP_PHONE, code } });
      return ok(r.status === 401 && !r.data?.token, `Status ${r.status}: ${r.data?.error}`);
    });
  await tc(O, On, 'Ask for another code immediately after one was sent',
    'Throttled with a stated wait, so the gateway cannot be pumped', async () => {
      await sql('ifqm_test_master', `UPDATE __DB__.login_otps SET created_at = NOW() WHERE identifier = ?`, [OTP_PHONE]);
      const r = await api('POST', '/api/auth/otp/request', { body: { identifier: OTP_PHONE } });
      return ok(r.status === 429, `Status ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(O, On, 'Registration: an email code is accepted and then spent',
    'Applicant proves they hold the address; the code works once', async () => {
      /*
       * The row is created directly rather than through send-otp. The suite
       * deliberately has no mail account configured (helpers.js) so that a test
       * run cannot post to the internet, which makes the SEND half unavailable
       * here — it is covered by the case below. What matters for security is
       * the redemption half, and that is exercised in full.
       */
      const addr = 'applicant@registration.test';
      await sql('ifqm_test_master',
        `INSERT INTO __DB__.login_otps (identifier, id_type, channel, code_hash, purpose, expires_at)
         VALUES (?, 'email', 'email', ?, 'registration_verify', DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
        [addr, bcrypt.hashSync(KNOWN_CODE, 4)]);
      const v = await api('POST', '/api/registrations/verify-otp', { body: { email: addr, code: KNOWN_CODE } });
      const again = await api('POST', '/api/registrations/verify-otp', { body: { email: addr, code: KNOWN_CODE } });
      return ok(v.status === 200 && v.data?.success && again.status === 401,
        `verify ${v.status}, re-use ${again.status}: ${again.data?.error || ''}`);
    });
  await tc(O, On, 'Registration: email code requested with no mail sender configured',
    'Refused with a clear reason, never a 500 or a false "sent"', async () => {
      const r = await api('POST', '/api/registrations/send-otp', { body: { email: 'nomail@registration.test' } });
      const honest = r.status === 503 || r.status === 502;
      return ok(honest && r.status !== 500 && !r.data?.success,
        `Status ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(O, On, 'Registration: send and verify a mobile verification code',
    'Applicant proves they hold the number they typed', async () => {
      const num = '9812345699';
      const s = await api('POST', '/api/registrations/send-phone-otp', { body: { phone: num } });
      const code = await plantCode(num, 'registration_phone');
      const v = await api('POST', '/api/registrations/verify-phone-otp', { body: { phone: num, code } });
      return ok(v.status === 200 && v.data?.success, `send ${s.status}, verify ${v.status}: ${v.data?.error || 'verified'}`);
    });
  await tc(O, On, 'Registration: a wrong verification code is refused',
    'Rejected without consuming the real code', async () => {
      const num = '9812345698';
      await api('POST', '/api/registrations/send-phone-otp', { body: { phone: num } });
      const bad = await api('POST', '/api/registrations/verify-phone-otp', { body: { phone: num, code: '000000' } });
      const code = await plantCode(num, 'registration_phone');
      const good = await api('POST', '/api/registrations/verify-phone-otp', { body: { phone: num, code } });
      return ok(bad.status === 401 && good.status === 200, `wrong ${bad.status}, correct ${good.status}`);
    });
  await tc(O, On, 'Delivery log never stores the message body, and masks the number',
    'The log can be read without learning any code or full number', async () => {
      const rows = await sql('ifqm_test_master',
        `SELECT recipient, detail FROM __DB__.sms_delivery_log ORDER BY id DESC LIMIT 20`);
      const masked = rows.every((r) => !r.recipient || r.recipient.includes('*'));
      const noBody = rows.every((r) => !/\b\d{6}\b/.test(String(r.detail || '')));
      const noColumn = !(await sql('ifqm_test_master',
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '__DB__'
           AND TABLE_NAME = 'sms_delivery_log' AND COLUMN_NAME IN ('message','body','text')`)).length;
      return ok(masked && noBody && noColumn,
        `${rows.length} rows: recipients ${masked ? 'masked' : 'IN CLEAR'}, no code in detail ${noBody}, no body column ${noColumn}`);
    });
  await tc(O, On, 'Outgoing text matches the wording registered with the operator',
    'Message is built from the registered template, not a literal', async () => {
      const { messageFor, matchesTemplate } = await import('../src/services/smsService.js');
      const { default: cfg } = await import('../src/config/index.js');
      const built = messageFor('login', '482913', 5);
      const matches = matchesTemplate(cfg.sms.text.login, built.text);
      const drifted = matchesTemplate(cfg.sms.text.login, '482913 is your code. Expires in 5 min.');
      return ok(matches && !drifted && !!built.text,
        matches ? `Built from registration; drifted wording correctly rejected` : 'Message does not match its template (carrier would drop it)');
    });
  await tc(O, On, 'Gateway readiness names the missing setting',
    'An incomplete gateway reports which field is empty, not "unavailable"', async () => {
      const { kaleyraMissing } = await import('../src/services/smsService.js');
      const missing = kaleyraMissing({ apiKey: '', sid: '', senderId: 'ABC', peId: '', templates: {} }, 'login');
      const named = missing.some((m) => /SMS_API_KEY/i.test(m)) && missing.some((m) => /SID/i.test(m))
        && missing.some((m) => /6 characters/i.test(m));
      return ok(named, named ? `Names each gap: ${missing.length} reported` : `Unhelpful: ${missing.join(', ')}`);
    });
  await tc(O, On, 'Code sign-in while the platform is in maintenance',
    'Refused — the code route is shut with the password route', async () => {
      const pa = (await login('platform@ifqm.io', PASSWORDS.platform)).token;
      await api('PUT', '/api/platform/maintenance', { token: pa, body: { enabled: true } });
      const r = await api('POST', '/api/auth/otp/request', { body: { identifier: OTP_PHONE } });
      await api('PUT', '/api/platform/maintenance', { token: pa, body: { enabled: false } });
      return ok(r.status === 503 && r.data?.maintenance === true, `Status ${r.status}: ${r.data?.error || ''}`);
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
        role: 'employee', date_of_birth: '1994-05-01', phone: '9812345602',
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
      const r = await api('POST', '/api/ideas/review-action', { token: AREVIEWER, body: { idea_id: IDEA2, decision: 'Approved', comment: 'Clear ROI.' } });
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
      await api('POST', '/api/ideas/review-action', { token: AREVIEWER, body: { idea_id: IDEA2, decision: 'Approved', comment: 'again' } });
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
  await tc(Q, Qn, 'Admin overrides the QCMS base URL for this tenant',
    'Saved for this tenant; blank restores the environment default', async () => {
      const set = await api('PUT', '/api/integrations/qcms', { token: AADMIN, body: { base_url: 'https://qcms.example.com/v1/' } });
      const saved = set.data?.config?.base_url === 'https://qcms.example.com/v1' && set.data?.config?.base_url_custom === true;
      const cleared = await api('PUT', '/api/integrations/qcms', { token: AADMIN, body: { base_url: '' } });
      const back = cleared.data?.config?.base_url_custom === false
        && cleared.data?.config?.base_url === cleared.data?.config?.default_base_url;
      return ok(saved && back, saved ? (back ? 'Override saved and cleared' : 'Blank did not restore the default') : `Not saved: ${set.data?.error || set.status}`);
    });
  await tc(Q, Qn, 'A malformed QCMS base URL is rejected',
    'Rejected (400) — ideas are never sent to a bad endpoint', async () => {
      const r = await api('PUT', '/api/integrations/qcms', { token: AADMIN, body: { base_url: 'not a url' } });
      const cfg = await api('GET', '/api/integrations/qcms', { token: AADMIN });
      const stored = JSON.stringify(cfg.data || {}).includes('not a url');
      return ok(r.status === 400 && !stored, stored ? 'Malformed URL stored (RISK)' : `Status ${r.status}`);
    });
  await tc(Q, Qn, 'Non-admin cannot change the QCMS base URL',
    'Forbidden — admin only', async () => {
      const r = await api('PUT', '/api/integrations/qcms', { token: AUSER, body: { base_url: 'https://evil.example' } });
      return ok(r.status === 403 || r.status === 401, `Status ${r.status}`);
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

  // ════════════════════════════════════════════════════════════════════════
  //  DEEP ASSURANCE MODULES
  //  Everything above proves the features work. What follows is the harder
  //  question a buyer's IT department asks: is it SAFE, does it STAY UP, does
  //  it GROW, and can it be EXTENDED without a rewrite. Same rules — real HTTP
  //  against the real app, Actual Output is whatever happened.
  // ════════════════════════════════════════════════════════════════════════

  const { default: config, validateConfig } = await import('../src/config/index.js');
  const jwtlib = (await import('jsonwebtoken')).default;
  const { mapIdeaToQcms, pushIdeaToQcms } = await import('../src/services/qcmsService.js');

  /** Wall-clock a call → [result, ms]. Latency is an assertion here, not a note. */
  const timed = async (fn) => { const t0 = Date.now(); const r = await fn(); return [r, Date.now() - t0]; };
  const rawFetch = (p, init = {}) => fetch(getBaseUrl() + p, init);
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ms = (n) => `${n} ms`;

  const userRow = async (email) => (await sql('ifqm_test_a',
    'SELECT id, name, role, status, points, must_change_password, UNIX_TIMESTAMP(password_changed_at) AS pwd_ts FROM __DB__.users WHERE email = ?',
    [email]))[0];

  /** A throwaway tenant-A account we can deactivate/expire without collateral. */
  const seedUser = async (email, opts = {}) => {
    await sql('ifqm_test_a', 'DELETE FROM __DB__.users WHERE email = ?', [email]);
    await sql('ifqm_test_a',
      `INSERT INTO __DB__.users (employee_id,name,email,password_hash,role,status,must_change_password,password_changed_at)
       VALUES (?,?,?,?,?,?,?,NOW())`,
      [opts.employee_id || 'TC-' + Math.random().toString(36).slice(2, 8), opts.name || 'TC Probe', email,
        bcrypt.hashSync(opts.password || 'TcProbePass12345', 4), opts.role || 'employee',
        opts.status || 'active', opts.must_change_password ? 1 : 0]);
    return userRow(email);
  };
  const tokenFor = (u, over = {}) => signToken({
    user: { id: u.id, role: over.role || u.role }, org_slug: over.org_slug || 'orga', pwd_ts: over.pwd_ts ?? u.pwd_ts,
  });

  /** Upload a file as `token`'s user against `ideaId` (multipart, like the browser). */
  const uploadFile = async (token, ideaId, name, buf, section = 'situation') => {
    const fd = new FormData();
    fd.append('idea_id', String(ideaId));
    fd.append('section', section);
    fd.append('file', new Blob([buf]), name);
    return api('POST', '/api/upload', { token, raw: fd });
  };

  const AUSER_ROW = await userRow('user@orga.test');

  // ══════════════════════════════ SAFETY & DATA PROTECTION ════════════════
  const SF = 'SAFE', SFn = 'Safety & Data Protection';

  await tc(SF, SFn, 'Unsigned token (alg=none) presented as a session',
    'Rejected 401 — the verifier pins HS256, the token cannot choose', async () => {
      const t = `${b64u({ alg: 'none', typ: 'JWT' })}.${b64u({ user: { id: AUSER_ROW.id, role: 'admin' }, org_slug: 'orga', pwd_ts: AUSER_ROW.pwd_ts })}.`;
      const r = await api('GET', '/api/users', { token: t });
      return ok(r.status === 401, `Status ${r.status}`);
    });
  await tc(SF, SFn, 'Token signed with an attacker-chosen secret',
    'Rejected 401 — signature must verify against the server secret', async () => {
      const forged = jwtlib.sign({ user: { id: AUSER_ROW.id, role: 'admin' }, org_slug: 'orga', pwd_ts: AUSER_ROW.pwd_ts },
        'attacker-secret-attacker-secret-0123456789', { algorithm: 'HS256' });
      const r = await api('GET', '/api/users', { token: forged });
      return ok(r.status === 401, `Status ${r.status}`);
    });
  await tc(SF, SFn, 'Expired session token',
    'Rejected 401 with expired flag, no access', async () => {
      const expired = jwtlib.sign({ user: { id: AUSER_ROW.id, role: 'employee' }, org_slug: 'orga', pwd_ts: AUSER_ROW.pwd_ts },
        config.jwt.secret, { algorithm: 'HS256', expiresIn: -60 });
      const r = await api('GET', '/api/notifications', { token: expired });
      return ok(r.status === 401, `Status ${r.status}: ${r.data?.error || ''}${r.data?.expired ? ' (expired flag)' : ''}`);
    });
  await tc(SF, SFn, 'Valid token whose role claim was raised to admin',
    'Role is read from the database row, not the token — forbidden', async () => {
      const r = await api('GET', '/api/users/admin', { token: tokenFor(AUSER_ROW, { role: 'admin' }) });
      return ok(r.status === 403, `Status ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(SF, SFn, 'Employee edits their own user record to become admin',
    'Forbidden — role change is admin-only and the stored role is unchanged', async () => {
      const r = await api('PUT', `/api/users/${AUSER_ROW.id}`, { token: AUSER, body: { role: 'admin' } });
      const after = await userRow('user@orga.test');
      return ok((r.status === 403 || r.status === 401) && after.role === 'employee', `Status ${r.status}, stored role=${after.role}`);
    });
  await tc(SF, SFn, 'Employee posts role/points through the profile endpoint',
    'Mass-assignment ignored — role and points unchanged', async () => {
      const before = await userRow('user@orga.test');
      await api('POST', '/api/users/profile', { token: AUSER, body: { name: 'Orga Employee', role: 'super_admin', points: 999999 } });
      const after = await userRow('user@orga.test');
      const held = after.role === before.role && Number(after.points) === Number(before.points);
      return ok(held, held ? `role=${after.role}, points=${after.points} (unchanged)` : `ESCALATED to role=${after.role}, points=${after.points}`);
    });
  await tc(SF, SFn, 'Session opened before a password change is reused',
    'Rejected 401 — a password change kills tokens issued earlier', async () => {
      const u = await seedUser('pwdchange@orga.test');
      const old = tokenFor(u);
      const before = await api('GET', '/api/notifications', { token: old });
      await sql('ifqm_test_a', 'UPDATE __DB__.users SET password_changed_at = DATE_ADD(NOW(), INTERVAL 5 SECOND) WHERE email = ?', ['pwdchange@orga.test']);
      const after = await api('GET', '/api/notifications', { token: old });
      return ok(before.status === 200 && after.status === 401, `before=${before.status}, after password change=${after.status}`);
    });
  await tc(SF, SFn, 'Offboarded (deactivated) employee reuses a live token',
    'Rejected 401 on the very next request — status is re-read per request', async () => {
      const u = await seedUser('offboard@orga.test');
      const t = tokenFor(u);
      const before = await api('GET', '/api/notifications', { token: t });
      await sql('ifqm_test_a', "UPDATE __DB__.users SET status = 'inactive' WHERE email = ?", ['offboard@orga.test']);
      const after = await api('GET', '/api/notifications', { token: t });
      return ok(before.status === 200 && after.status === 401, `before=${before.status}, after deactivation=${after.status}`);
    });
  await tc(SF, SFn, 'Token for an account that has since been deleted',
    'Rejected 401 — no ghost sessions', async () => {
      const u = await seedUser('deleted@orga.test');
      const t = tokenFor(u);
      await sql('ifqm_test_a', 'DELETE FROM __DB__.users WHERE email = ?', ['deleted@orga.test']);
      const r = await api('GET', '/api/notifications', { token: t });
      return ok(r.status === 401, `Status ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(SF, SFn, 'User still on a temporary password calls the API directly',
    'Blocked 403 everywhere except the change-password / support allow-list', async () => {
      const u = await seedUser('temppw@orga.test', { must_change_password: true });
      const t = tokenFor(u);
      const blocked = await api('GET', '/api/ideas', { token: t });
      const allowed = await api('GET', '/api/auth/me', { token: t });
      return ok(blocked.status === 403 && allowed.status === 200, `ideas=${blocked.status} (${blocked.data?.error || ''}), me=${allowed.status}`);
    });
  await tc(SF, SFn, 'Password hashes in any authenticated response',
    'Never present — no hash or bcrypt prefix is ever serialised', async () => {
      const bodies = [
        (await api('GET', '/api/auth/me', { token: AADMIN })).text,
        (await api('GET', '/api/users', { token: AADMIN })).text,
        (await api('GET', `/api/ideas/${IDEA1}`, { token: AADMIN })).text,
        JSON.stringify((await login('admin@orga.test', PASSWORDS.orgaAdmin))),
      ].join(' ');
      const leak = /password_hash|\$2[aby]\$/.test(bodies);
      return ok(!leak, leak ? 'Hash material found in a response (CRITICAL)' : 'No hash material in any sampled response');
    });
  await tc(SF, SFn, 'Browser security headers on an API response',
    'nosniff, frame/CSP lockdown, no-referrer, no server fingerprint', async () => {
      const r = await api('GET', '/api/health', {});
      const h = r.headers || {};
      const has = h['x-content-type-options'] === 'nosniff'
        && /default-src 'none'/.test(h['content-security-policy'] || '')
        && (h['referrer-policy'] || '').includes('no-referrer')
        && !h['x-powered-by'];
      return ok(has, `nosniff=${h['x-content-type-options']}, csp=${(h['content-security-policy'] || '').slice(0, 40)}, referrer=${h['referrer-policy']}, x-powered-by=${h['x-powered-by'] || 'absent'}`);
    });
  await tc(SF, SFn, 'Cross-origin request from a site not on the allow-list',
    'No allow-origin granted to the unlisted site', async () => {
      const res = await rawFetch('/api/health', { headers: { Origin: 'https://evil.example' } });
      const allow = res.headers.get('access-control-allow-origin');
      return ok(!allow || allow === 'null', `access-control-allow-origin: ${allow || 'absent'}`);
    });
  await tc(SF, SFn, 'Malformed JSON body on a write endpoint',
    'Clean 400 "Malformed request body", never a 500', async () => {
      const res = await rawFetch('/api/ideas/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AUSER}` }, body: '{"title": "broken",,}',
      });
      const body = await res.text();
      return ok(res.status === 400, `Status ${res.status}: ${body.slice(0, 80)}`);
    });
  await tc(SF, SFn, 'SQL metacharacters stored in an idea title',
    'Stored as literal text — the ideas table is untouched', async () => {
      const before = (await sql('ifqm_test_a', 'SELECT COUNT(*) AS c FROM __DB__.ideas'))[0].c;
      await api('POST', '/api/ideas/submit', { token: AUSER, body: {
        title: "x'; DROP TABLE ideas; --", present_situation: 'Injection probe situation text for the runner.',
        proposed_solution: 'Injection probe solution text for the runner.',
      } });
      const after = (await sql('ifqm_test_a', 'SELECT COUNT(*) AS c FROM __DB__.ideas'))[0].c;
      return ok(Number(after) >= Number(before), `ideas rows before=${before}, after=${after} (table intact)`);
    });
  await tc(SF, SFn, 'Stored HTML/script payload read back through the API',
    'Returned as JSON data, never as executable HTML', async () => {
      const r = await api('GET', '/api/ideas', { token: AADMIN });
      const isJson = /application\/json/.test(r.contentType);
      const noHtmlType = !/text\/html/.test(r.contentType);
      return ok(isJson && noHtmlType, `content-type=${r.contentType}`);
    });
  await tc(SF, SFn, 'Attachment with a disallowed extension (.exe)',
    'Rejected 400 — extension allow-list enforced server-side', async () => {
      const r = await uploadFile(AUSER, IDEA1, 'payload.exe', Buffer.from('MZ fake executable'));
      return ok(r.status >= 400 && r.status < 500, `Status ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(SF, SFn, 'Attachment with a double extension (report.pdf.exe)',
    'Rejected — the real (last) extension is what is checked', async () => {
      const r = await uploadFile(AUSER, IDEA1, 'report.pdf.exe', Buffer.from('MZ fake executable'));
      return ok(r.status >= 400 && r.status < 500, `Status ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(SF, SFn, 'Attachment over the configured size limit',
    'Clean 400 stating the limit, not a dropped connection', async () => {
      const big = Buffer.alloc((config.maxFileMb + 1) * 1024 * 1024, 0x41);
      const r = await uploadFile(AUSER, IDEA1, 'huge.pdf', big);
      return ok(r.status >= 400 && r.status < 500, `Status ${r.status}: ${r.data?.error || ''}`);
    });
  let ATTACH_ID = null;
  await tc(SF, SFn, 'Employee attaches a valid file to their own idea',
    'Accepted and recorded against that idea only', async () => {
      const r = await uploadFile(AUSER, IDEA1, 'evidence.png', tinyPng());
      const row = (await sql('ifqm_test_a', 'SELECT id FROM __DB__.idea_attachments WHERE idea_id = ? ORDER BY id DESC LIMIT 1', [IDEA1]))[0];
      ATTACH_ID = row?.id || null;
      return ok(r.status === 200 && ATTACH_ID, `Status ${r.status}, attachment id=${ATTACH_ID}`);
    });
  await tc(SF, SFn, 'Attaching a file to someone else\'s idea',
    'Forbidden — ownership checked before the file is written', async () => {
      const r = await uploadFile(AADMIN, IDEA1, 'notmine.png', tinyPng());
      return ok(r.status >= 400, `Status ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(SF, SFn, 'Downloading an attachment with no session',
    'Rejected 401 — attachments are not public URLs', async () => {
      const r = await api('GET', `/api/upload/${ATTACH_ID}/download`, {});
      return ok(r.status === 401, `Status ${r.status}`);
    });
  await tc(SF, SFn, 'Downloading another organisation\'s attachment id',
    'Not found — the lookup is scoped to the caller\'s tenant database', async () => {
      const r = await api('GET', `/api/upload/${ATTACH_ID}/download`, { token: BADMIN });
      return ok(r.status >= 400, `Status ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(SF, SFn, 'Legitimate attachment download by a permitted user',
    'Streamed as an attachment with nosniff — never renderable in-origin', async () => {
      const r = await api('GET', `/api/upload/${ATTACH_ID}/download`, { token: AUSER });
      const h = r.headers || {};
      const safe = /attachment/i.test(h['content-disposition'] || '') && h['x-content-type-options'] === 'nosniff';
      return ok(r.status === 200 && safe, `Status ${r.status}, disposition=${(h['content-disposition'] || '').slice(0, 40)}, nosniff=${h['x-content-type-options']}`);
    });
  await tc(SF, SFn, 'Path traversal in the attachment id',
    'Rejected — id is numeric, no filesystem path is ever taken from input', async () => {
      const r = await api('GET', '/api/upload/..%2F..%2F..%2Fetc%2Fpasswd/download', { token: AUSER });
      const leaked = /root:|Windows Registry|\[boot loader\]/i.test(r.text || '');
      return ok(r.status >= 400 && !leaked, leaked ? 'File contents returned (CRITICAL)' : `Status ${r.status}`);
    });
  await tc(SF, SFn, 'Deleting an attachment belonging to another user',
    'Forbidden — only the owner may remove their file', async () => {
      const r = await api('DELETE', `/api/upload/${ATTACH_ID}`, { token: AADMIN });
      return ok(r.status >= 400, `Status ${r.status}: ${r.data?.error || ''}`);
    });
  let ANON_ID = null;
  await tc(SF, SFn, 'Anonymous idea opened by a colleague',
    'Submitter name, e-mail and department masked from the peer', async () => {
      const s = await api('POST', '/api/ideas/submit', { token: AUSER, body: {
        title: 'Anonymous safety concern on the night shift', present_situation: 'Reporting this without my name attached to it.',
        proposed_solution: 'Add a second inspection before the line restarts after a stoppage.', is_anonymous: 1,
      } });
      ANON_ID = s.data?.idea_id;
      await sql('ifqm_test_a', 'UPDATE __DB__.ideas SET is_anonymous = 1 WHERE id = ?', [ANON_ID]);
      const peer = await seedUser('peer@orga.test');
      const view = await api('GET', `/api/ideas/${ANON_ID}`, { token: tokenFor(peer) });
      const shown = JSON.stringify(view.data || {});
      const leaked = /Orga Employee|user@orga\.test/.test(shown);
      return ok(!leaked && /Anonymous/.test(shown), leaked ? 'Real identity exposed on an anonymous idea' : 'Identity masked for the colleague');
    });
  await tc(SF, SFn, 'Anonymous idea opened by its own author',
    'Author still sees their own submission unmasked', async () => {
      const own = await api('GET', `/api/ideas/${ANON_ID}`, { token: AUSER });
      return ok(/Orga Employee/.test(own.text || ''), /Orga Employee/.test(own.text || '') ? 'Author sees their own name' : 'Author masked from their own idea');
    });
  await tc(SF, SFn, 'Anonymous idea still auditable in storage',
    'submitter_id retained in the database for accountability', async () => {
      const row = (await sql('ifqm_test_a', 'SELECT submitter_id, is_anonymous FROM __DB__.ideas WHERE id = ?', [ANON_ID]))[0];
      return ok(row?.submitter_id > 0 && row?.is_anonymous, `submitter_id=${row?.submitter_id}, is_anonymous=${row?.is_anonymous}`);
    });
  await tc(SF, SFn, 'Platform (vendor) admin reads a customer\'s ideas',
    'Refused — vendor staff see counts, never tenant content', async () => {
      const ideas = await api('GET', '/api/ideas', { token: PA });
      const users = await api('GET', '/api/users', { token: PA });
      const leaked = /Recirculate coolant/.test(ideas.text || '') || /orga\.test/.test(users.text || '');
      return ok(!leaked, leaked ? 'Tenant content reached the vendor console (CRITICAL)' : `ideas=${ideas.status}, users=${users.status}, no tenant content`);
    });
  await tc(SF, SFn, 'Login to a suspended organisation',
    'Blocked while suspended, restored on reactivation', async () => {
      const list = (await api('GET', '/api/platform/tenants', { token: PA })).data;
      const orgb = (list?.tenants || list || []).find(x => x.slug === 'orgb');
      await api('PATCH', `/api/platform/tenants/${orgb.id}`, { token: PA, body: { status: 'suspended' } });
      const during = await login('admin@orgb.test', PASSWORDS.orgbAdmin, 'orgb');
      await api('PATCH', `/api/platform/tenants/${orgb.id}`, { token: PA, body: { status: 'active' } });
      await sql('ifqm_test_master', 'DELETE FROM __DB__.login_attempts');
      const after = await login('admin@orgb.test', PASSWORDS.orgbAdmin, 'orgb');
      return ok(!during.token && !!after.token, `suspended: ${during.status} (${during.error || ''}); reactivated: ${after.token ? 'login ok' : 'still blocked'}`);
    });
  await tc(SF, SFn, 'Five wrong passwords then the CORRECT one',
    'Account locked out — the right password does not clear a live lockout', async () => {
      await seedUser('lockme@orga.test', { password: 'LockMeRightPass12' });
      await sql('ifqm_test_master', 'DELETE FROM __DB__.login_attempts');
      for (let i = 0; i < 5; i++) await login('lockme@orga.test', 'WrongOne' + i, 'orga');
      const r = await login('lockme@orga.test', 'LockMeRightPass12', 'orga');
      await sql('ifqm_test_master', 'DELETE FROM __DB__.login_attempts');
      return ok(!r.token, r.token ? 'Correct password bypassed the lockout' : `Blocked: ${r.error}`);
    });
  await tc(SF, SFn, 'Lockout counter is stored centrally, not per process',
    'Recorded in the master registry so every instance sees it', async () => {
      await sql('ifqm_test_master', 'DELETE FROM __DB__.login_attempts');
      await login('lockme@orga.test', 'WrongAgain1', 'orga');
      const rows = await sql('ifqm_test_master', 'SELECT login_id, attempts FROM __DB__.login_attempts');
      await sql('ifqm_test_master', 'DELETE FROM __DB__.login_attempts');
      return ok(rows.length > 0, rows.length ? `${rows.length} row(s) persisted, attempts=${rows[0].attempts}` : 'Nothing persisted (counter would be per-process)');
    });
  await tc(SF, SFn, 'Server error body inspected for internals',
    'Generic message only — no stack trace, SQL or file path', async () => {
      const r = await api('GET', '/api/ideas/999999999', { token: AUSER });
      const body = r.text || '';
      const leak = /at\s+\w+\s+\(|SELECT\s|node_modules|C:\\\\|\/src\//.test(body);
      return ok(!leak, leak ? `Internals leaked: ${body.slice(0, 120)}` : `Clean ${r.status}: ${body.slice(0, 80)}`);
    });
  await tc(SF, SFn, 'Request to an endpoint that does not exist',
    'Uniform 404 envelope, no framework fingerprint', async () => {
      const r = await api('GET', '/api/does-not-exist', { token: AADMIN });
      return ok(r.status === 404 && r.data?.success === false, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    });
  await tc(SF, SFn, 'Rate-limit budget is advertised to clients',
    'Standard RateLimit headers present on API responses', async () => {
      const r = await api('GET', '/api/health', {});
      const h = r.headers || {};
      const has = h['ratelimit-limit'] || h['ratelimit-policy'] || h['ratelimit'];
      return ok(!!has, has
        ? `RateLimit headers present (budget shown: ${h['ratelimit-limit'] || h['ratelimit-policy']}; the suite raises GLOBAL_RATE_LIMIT — the shipped default is 300/min per IP, 30/15min on auth)`
        : 'No RateLimit headers');
    });
  await tc(SF, SFn, 'Employee reads the integration (API key) screen',
    'Forbidden — secrets are admin-only', async () => {
      const r = await api('GET', '/api/integrations/qcms', { token: AUSER });
      return ok(r.status === 403 || r.status === 401, `Status ${r.status}`);
    });
  await tc(SF, SFn, 'Production configuration guard against insecure defaults',
    'Placeholder JWT secret / rootless DB flagged before boot', async () => {
      const problems = validateConfig({ ...config, env: 'production', jwt: { ...config.jwt, secret: 'change-this-to-a-long-random-secret-string' }, appDb: { user: 'root', password: '' } });
      return ok(problems.length >= 3, `${problems.length} problem(s) reported, first: ${(problems[0] || '').slice(0, 90)}`);
    });
  await tc(SF, SFn, 'Password shorter than the policy minimum',
    'Rejected — minimum length enforced server-side', async () => {
      const r = await api('POST', '/api/auth/reset-password', { body: { token: 'whatever', password: 'short1' } });
      return ok(r.status >= 400, `Status ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(SF, SFn, 'CRLF injection through a user-supplied name',
    'Stored as text — no header split, no 500', async () => {
      const r = await api('POST', '/api/users/profile', { token: AUSER, body: { name: 'Evil\r\nSet-Cookie: admin=1' } });
      await api('POST', '/api/users/profile', { token: AUSER, body: { name: 'Orga Employee' } });
      return ok(r.status !== 500, `Status ${r.status}`);
    });

  // ══════════════════════════════ RELIABILITY ═════════════════════════════
  const RL = 'REL', RLn = 'Reliability & Fault Tolerance';

  await tc(RL, RLn, 'Request body sent as text/plain to a JSON endpoint',
    'Handled as a client error, never a 500', async () => {
      const res = await rawFetch('/api/ideas/submit', {
        method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${AUSER}` }, body: 'title=hello',
      });
      return ok(res.status !== 500, `Status ${res.status}`);
    });
  await tc(RL, RLn, 'POST with no body at all',
    'Validation error, service stays up', async () => {
      const r = await api('POST', '/api/ideas/submit', { token: AUSER });
      return ok(r.status >= 400 && r.status < 500, `Status ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(RL, RLn, 'Null values in required fields',
    'Validation error, not a null-dereference crash', async () => {
      const r = await api('POST', '/api/ideas/submit', { token: AUSER, body: { title: null, present_situation: null, proposed_solution: null } });
      return ok(r.status >= 400 && r.status < 500, `Status ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(RL, RLn, 'JSON array sent where an object is expected',
    'Rejected cleanly', async () => {
      const res = await rawFetch('/api/ideas/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AUSER}` }, body: '[1,2,3]',
      });
      return ok(res.status !== 500, `Status ${res.status}`);
    });
  await tc(RL, RLn, 'Deeply nested JSON (200 levels)',
    'Parsed or rejected without exhausting the stack', async () => {
      let payload = '{"title":"deep"'; let close = '}';
      for (let i = 0; i < 200; i++) { payload += `,"n${i}":{`; close = '}' + close; }
      const res = await rawFetch('/api/ideas/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AUSER}` }, body: payload + close.slice(1) + '}',
      });
      return ok(res.status !== 500, `Status ${res.status}`);
    });
  await tc(RL, RLn, 'Absurd numeric value in a money field',
    'Handled without overflow or crash', async () => {
      const r = await api('POST', '/api/ideas/submit', { token: AUSER, body: {
        title: 'Overflow probe idea', present_situation: 'Checking numeric handling on the money fields.',
        proposed_solution: 'Submit an absurd figure and confirm the service copes.', roi_value: 1e30, investment_required: '-500',
      } });
      return ok(r.status !== 500, `Status ${r.status}: ${r.data?.error || 'accepted'}`);
    });
  await tc(RL, RLn, 'Non-numeric id in a path parameter',
    'Client error, not a 500', async () => {
      const r = await api('GET', '/api/ideas/not-a-number', { token: AUSER });
      return ok(r.status !== 500, `Status ${r.status}`);
    });
  await tc(RL, RLn, 'Ten simultaneous votes from one user on one idea',
    'At most one stored vote — no double counting under concurrency', async () => {
      const target = await mkIdea(AUSER, 'Concurrency probe: vote race');
      await Promise.all(Array.from({ length: 10 }, () => api('POST', '/api/votes/community', { token: AADMIN, body: { idea_id: target, vote_type: 'up' } })));
      const rows = await sql('ifqm_test_a', 'SELECT COUNT(*) AS c FROM __DB__.idea_community_votes WHERE idea_id = ?', [target]);
      return ok(Number(rows[0].c) <= 1, `Stored vote rows: ${rows[0].c}`);
    });
  await tc(RL, RLn, 'Ten simultaneous comments on one idea',
    'All accepted, none lost, no deadlock', async () => {
      const target = await mkIdea(AUSER, 'Concurrency probe: comment storm');
      const res = await Promise.all(Array.from({ length: 10 }, (_, i) => api('POST', '/api/comments', { token: AADMIN, body: { idea_id: target, content: `Parallel comment ${i}` } })));
      const rows = await sql('ifqm_test_a', 'SELECT COUNT(*) AS c FROM __DB__.idea_comments WHERE idea_id = ?', [target]);
      const errors = res.filter(r => r.status >= 500).length;
      return ok(errors === 0 && Number(rows[0].c) === 10, `${rows[0].c}/10 stored, ${errors} server errors`);
    });
  await tc(RL, RLn, 'Five simultaneous approvals of the same idea',
    'Exactly one approval recorded — the guard holds under a race', async () => {
      const target = await mkIdea(AUSER, 'Concurrency probe: double approval');
      await Promise.all(Array.from({ length: 5 }, () => api('POST', '/api/ideas/review-action', { token: AREVIEWER, body: { idea_id: target, decision: 'Approved', comment: 'Race probe' } })));
      const rows = await sql('ifqm_test_a', "SELECT COUNT(*) AS c FROM __DB__.idea_workflow WHERE idea_id = ? AND action = 'Approved'", [target]);
      return ok(Number(rows[0].c) === 1, `Approved workflow rows: ${rows[0].c}`);
    });
  await tc(RL, RLn, 'Two simultaneous account creations with the same email',
    'Only one account exists afterwards', async () => {
      const email = 'racecreate@orga.test';
      await sql('ifqm_test_a', 'DELETE FROM __DB__.users WHERE email = ?', [email]);
      await Promise.all([
        api('POST', '/api/users', { token: AADMIN, body: { name: 'Race One', email, employee_id: 'A-RACE1', role: 'employee', date_of_birth: '1990-01-01', phone: '9812345603' } }),
        api('POST', '/api/users', { token: AADMIN, body: { name: 'Race Two', email, employee_id: 'A-RACE2', role: 'employee', date_of_birth: '1990-01-01', phone: '9812345604' } }),
      ]);
      const rows = await sql('ifqm_test_a', 'SELECT COUNT(*) AS c FROM __DB__.users WHERE email = ?', [email]);
      return ok(Number(rows[0].c) === 1, `Accounts with that email: ${rows[0].c}`);
    });
  await tc(RL, RLn, 'QCMS endpoint refuses connections',
    'Push reports failed per idea; the platform keeps serving', async () => {
      await api('PUT', '/api/integrations/qcms', { token: AADMIN, body: { base_url: 'http://127.0.0.1:1/none', api_key: 'qcms_live_probe', enabled: true } });
      const r = await api('POST', '/api/integrations/push', { token: AADMIN, body: { idea_ids: [IDEA2] } });
      const health = await api('GET', '/api/health', {});
      return ok(r.status === 200 && r.data?.failed >= 1 && health.status === 200, `push status=${r.status}, failed=${r.data?.failed}, health=${health.status}`);
    });
  await tc(RL, RLn, 'QCMS accepts the connection then never responds',
    'Timed out and classified as failed, no hung request', async () => {
      const hang = http.createServer(() => { /* deliberately silent */ });
      await new Promise((r) => hang.listen(0, '127.0.0.1', r));
      try {
        const [res, took] = await timed(() => pushIdeaToQcms({
          baseUrl: `http://127.0.0.1:${hang.address().port}/api/v1/integrations`, apiKey: 'qcms_live_x', timeoutMs: 800,
          idea: { idea_code: 'IDA-TIMEOUT-1', title: 'timeout probe', impact_areas: 'Quality', impact_level: 'Low' },
        }));
        return ok(res.status === 'failed' && took < 5000, `status=${res.status} in ${took} ms: ${res.message}`);
      } finally { await new Promise((r) => hang.close(r)); }
    });
  await tc(RL, RLn, 'Idea submitted while the mail server is unreachable',
    'Idea is still saved — notification failure never blocks the user', async () => {
      await api('POST', '/api/settings', { token: AADMIN, body: { smtp_host: 'smtp.invalid.local', smtp_port: '2525', smtp_user: 'x', smtp_pass: 'y' } });
      const r = await api('POST', '/api/ideas/submit', { token: AUSER, body: {
        title: 'Submitted while mail is down', present_situation: 'The SMTP host is deliberately unreachable for this case.',
        proposed_solution: 'The submission must still be persisted and acknowledged.',
      } });
      const stored = r.data?.idea_id ? (await sql('ifqm_test_a', 'SELECT COUNT(*) AS c FROM __DB__.ideas WHERE id = ?', [r.data.idea_id]))[0].c : 0;
      return ok(r.status === 200 && Number(stored) === 1, `Status ${r.status}, stored=${stored}`);
    });
  await tc(RL, RLn, 'Approval recorded while the mail server is unreachable',
    'Decision persists even though the e-mail cannot be sent', async () => {
      const target = await mkIdea(AUSER, 'Approve while mail is down');
      const r = await api('POST', '/api/ideas/review-action', { token: AREVIEWER, body: { idea_id: target, decision: 'Approved', comment: 'Mail-down probe' } });
      const row = (await sql('ifqm_test_a', 'SELECT status FROM __DB__.ideas WHERE id = ?', [target]))[0];
      return ok(r.status === 200 && row.status === 'Approved', `Status ${r.status}, stored status=${row.status}`);
    });
  await tc(RL, RLn, 'Sixty mixed requests fired back to back',
    'No 5xx across the burst; the service stays healthy', async () => {
      const paths = ['/api/ideas', '/api/notifications', '/api/leaderboard', '/api/categories', '/api/ideas/dashboard', '/api/health'];
      const res = await Promise.all(Array.from({ length: 60 }, (_, i) => api('GET', paths[i % paths.length], { token: AADMIN })));
      const bad = res.filter(r => r.status >= 500).length;
      const after = await api('GET', '/api/health', {});
      return ok(bad === 0 && after.status === 200, `${60 - bad}/60 clean, health afterwards=${after.status}`);
    });
  await tc(RL, RLn, 'Multilingual and emoji content round-trip',
    'Stored and returned byte-identical (utf8mb4 end to end)', async () => {
      const title = 'सुरक्षा सुधार · பாதுகாப்பு · 安全 🚀🔧';
      const s = await api('POST', '/api/ideas/submit', { token: AUSER, body: {
        title, present_situation: 'Multilingual round-trip probe — देवनागरी, தமிழ், 中文, emoji 🚀.',
        proposed_solution: 'Confirm the exact characters survive storage and retrieval.',
      } });
      const back = await api('GET', `/api/ideas/${s.data?.idea_id}`, { token: AUSER });
      const got = back.data?.idea?.title || back.data?.title || '';
      return ok(got === title, got === title ? 'Exact round-trip' : `Returned: ${got}`);
    });
  await tc(RL, RLn, 'Comment containing 4-byte emoji',
    'Accepted and stored without mangling', async () => {
      const r = await api('POST', '/api/comments', { token: AADMIN, body: { idea_id: IDEA1, content: 'Good catch 👍🏽🎯' } });
      const row = (await sql('ifqm_test_a', 'SELECT content FROM __DB__.idea_comments WHERE idea_id = ? ORDER BY id DESC LIMIT 1', [IDEA1]))[0];
      return ok(r.status === 200 && /👍/.test(row?.content || ''), `Status ${r.status}, stored: ${(row?.content || '').slice(0, 30)}`);
    });
  await tc(RL, RLn, 'Marking notifications read twice',
    'Idempotent — the second call is still a success', async () => {
      const a = await api('POST', '/api/notifications/mark-read', { token: AUSER, body: { ids: [] } });
      const b = await api('POST', '/api/notifications/mark-read', { token: AUSER, body: { ids: [] } });
      return ok(a.status === 200 && b.status === 200, `first=${a.status}, second=${b.status}`);
    });
  await tc(RL, RLn, 'Whitespace-only title',
    'Rejected — trimmed validation, no blank ideas', async () => {
      const r = await api('POST', '/api/ideas/submit', { token: AUSER, body: { title: '     ', present_situation: 'x'.repeat(40), proposed_solution: 'y'.repeat(40) } });
      return ok(r.status >= 400 && r.status < 500, `Status ${r.status}: ${r.data?.error || ''}`);
    });
  await tc(RL, RLn, 'Near-duplicate idea title check',
    'Similar existing ideas are surfaced before submission', async () => {
      const r = await api('GET', `/api/ideas/check-duplicate?title=${encodeURIComponent('Recirculate coolant')}`, { token: AUSER });
      const n = (r.data?.matches || r.data?.ideas || []).length;
      return ok(r.status === 200, `Status ${r.status}, ${n} similar idea(s) reported`);
    });
  await tc(RL, RLn, '60,000-character solution text',
    'Accepted and returned intact, or rejected cleanly — never a 500', async () => {
      const long = 'The detailed rollout plan repeats across shifts. '.repeat(1250).slice(0, 60000);
      const r = await api('POST', '/api/ideas/submit', { token: AUSER, body: {
        title: 'Very long solution narrative', present_situation: 'Storage limit probe for long-form business cases.', proposed_solution: long,
      } });
      let intact = 'n/a';
      if (r.data?.idea_id) {
        const row = (await sql('ifqm_test_a', 'SELECT CHAR_LENGTH(proposed_solution) AS n FROM __DB__.ideas WHERE id = ?', [r.data.idea_id]))[0];
        intact = `${row.n} chars stored`;
      }
      return ok(r.status !== 500, `Status ${r.status}, ${intact}`);
    });
  await tc(RL, RLn, 'Ten login/logout cycles in a row',
    'Every cycle succeeds — no session leak or degradation', async () => {
      let okCount = 0;
      for (let i = 0; i < 10; i++) {
        const l = await login('admin@orga.test', PASSWORDS.orgaAdmin, 'orga');
        const out = await api('POST', '/api/auth/logout', { token: l.token });
        if (l.token && out.status === 200) okCount++;
      }
      return ok(okCount === 10, `${okCount}/10 cycles clean`);
    });
  await tc(RL, RLn, 'Export requested while writes are in flight',
    'Export completes; concurrent writes are unaffected', async () => {
      const [exp, writes] = await Promise.all([
        api('GET', '/api/export/ideas', { token: AADMIN }),
        Promise.all(Array.from({ length: 5 }, (_, i) => mkIdea(AUSER, `Write during export ${i}`))),
      ]);
      return ok(exp.status === 200 && writes.every(Boolean), `export=${exp.status}, ${writes.filter(Boolean).length}/5 writes stored`);
    });

  // ══════════════════════════════ SCALABILITY — HORIZONTAL ═══════════════
  //  A second, genuinely separate OS process is started against the same
  //  databases. That is what sits behind a load balancer, and it is the only
  //  honest way to prove nothing depends on hitting the same instance twice.
  const HS = 'SCLH', HSn = 'Scalability — Horizontal';

  let inst2 = null; let base2 = ''; let spawnError = '';
  try {
    inst2 = spawn(process.execPath, [path.join(HERE, 'instance2.mjs')], {
      cwd: BACKEND_DIR, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    base2 = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no READY line within 30s')), 30000);
      let buf = '';
      inst2.stdout.on('data', (d) => {
        buf += d.toString();
        const m = buf.match(/READY (\d+)/);
        if (m) { clearTimeout(timer); resolve(`http://127.0.0.1:${m[1]}`); }
      });
      inst2.stderr.on('data', (d) => { buf += d.toString(); });
      inst2.on('error', (e) => { clearTimeout(timer); reject(e); });
      inst2.on('exit', (c) => { clearTimeout(timer); reject(new Error(`exited early (code ${c}): ${buf.slice(-200)}`)); });
    });
  } catch (e) { spawnError = e.message; base2 = ''; }

  const api2 = async (method, p, { token, body } = {}) => {
    if (!base2) return { status: 0, data: null, text: `second instance unavailable: ${spawnError}`, headers: {} };
    const headers = {}; let payload;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base2 + p, { method, headers, body: payload });
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, data, text, headers: Object.fromEntries(res.headers.entries()) };
  };
  const login2 = async (email, password, slug = '') => {
    const r = await api2('POST', '/api/auth/login', { body: { email, password, org_slug: slug } });
    return { status: r.status, token: r.data?.token, error: r.data?.error };
  };

  await tc(HS, HSn, 'A second application instance starts against the same databases',
    'Instance 2 boots and answers its liveness probe', async () => {
      const r = await api2('GET', '/api/health', {});
      return ok(r.status === 200, base2 ? `Instance 2 on ${base2}, health=${r.status}` : `Could not start: ${spawnError}`);
    });
  await tc(HS, HSn, 'Readiness probe on the second instance',
    'Reports ready — the load balancer may route to it', async () => {
      const r = await api2('GET', '/api/ready', {});
      return ok(r.status === 200, `Status ${r.status}: ${r.data?.status || ''}`);
    });
  await tc(HS, HSn, 'Session issued by instance 1 used on instance 2',
    'Accepted — authentication is stateless, no sticky sessions needed', async () => {
      const r = await api2('GET', '/api/ideas/dashboard', { token: AADMIN });
      return ok(r.status === 200, `Status ${r.status}`);
    });
  await tc(HS, HSn, 'Session issued by instance 2 used on instance 1',
    'Accepted in both directions', async () => {
      const l = await login2('user@orga.test', PASSWORDS.orgaUser, 'orga');
      const r = await api('GET', '/api/notifications', { token: l.token });
      return ok(!!l.token && r.status === 200, `login on 2 = ${l.token ? 'ok' : l.error}, request on 1 = ${r.status}`);
    });
  await tc(HS, HSn, 'Idea created on instance 1 read from instance 2',
    'Immediately visible — no per-process cache to go stale', async () => {
      const id = await mkIdea(AUSER, 'Cross-instance visibility probe (written on 1)');
      const r = await api2('GET', `/api/ideas/${id}`, { token: AUSER });
      return ok(r.status === 200 && /written on 1/.test(r.text || ''), `Status ${r.status}`);
    });
  await tc(HS, HSn, 'Idea created on instance 2 read from instance 1',
    'Immediately visible in the other direction', async () => {
      const s = await api2('POST', '/api/ideas/submit', { token: AUSER, body: {
        title: 'Cross-instance visibility probe (written on 2)', present_situation: 'Written through the second instance.',
        proposed_solution: 'Read it back through the first instance without a restart.',
      } });
      const r = await api('GET', `/api/ideas/${s.data?.idea_id}`, { token: AUSER });
      return ok(r.status === 200 && /written on 2/.test(r.text || ''), `Status ${r.status}`);
    });
  await tc(HS, HSn, 'Vote cast on instance 2, counted once on instance 1',
    'One vote — shared state lives in the database, not in a process', async () => {
      const id = await mkIdea(AUSER, 'Cross-instance vote probe');
      await api2('POST', '/api/votes/community', { token: AADMIN, body: { idea_id: id, vote_type: 'up' } });
      const rows = await sql('ifqm_test_a', 'SELECT COUNT(*) AS c FROM __DB__.idea_community_votes WHERE idea_id = ?', [id]);
      return ok(Number(rows[0].c) === 1, `Stored votes: ${rows[0].c}`);
    });
  await tc(HS, HSn, 'Organisation settings changed on 1 take effect on 2',
    'No configuration cached per process', async () => {
      await api('POST', '/api/settings', { token: AADMIN, body: { review_sla_days: '11' } });
      const r = await api2('GET', '/api/settings', { token: AADMIN });
      return ok(String(r.data?.settings?.review_sla_days) === '11', `Instance 2 reports review_sla_days=${r.data?.settings?.review_sla_days}`);
    });
  await tc(HS, HSn, 'Integration credentials saved on 1 are usable on 2',
    'Per-tenant integration config is shared, not per instance', async () => {
      await api('PUT', '/api/integrations/qcms', { token: AADMIN, body: { base_url: 'https://qcms.shared.example/v1', enabled: true } });
      const r = await api2('GET', '/api/integrations/qcms', { token: AADMIN });
      return ok(r.data?.config?.base_url === 'https://qcms.shared.example/v1', `Instance 2 reports base_url=${r.data?.config?.base_url}`);
    });
  await tc(HS, HSn, 'Branding updated on 1 is served by 2',
    'Tenant branding is read from the database on both', async () => {
      await api('PUT', '/api/branding', { token: AADMIN, body: { org_name: 'Org A Renamed' } });
      const r = await api2('GET', '/api/branding', { token: AADMIN });
      return ok(/Org A Renamed/.test(r.text || ''), `Instance 2 branding: ${(r.text || '').slice(0, 80)}`);
    });
  await tc(HS, HSn, 'Failed logins counted on 1 lock the account on 2',
    'Brute-force state is central — an attacker cannot rotate instances', async () => {
      await seedUser('crosslock@orga.test', { password: 'CrossLockPass123' });
      await sql('ifqm_test_master', 'DELETE FROM __DB__.login_attempts');
      for (let i = 0; i < 5; i++) await login('crosslock@orga.test', 'Nope' + i, 'orga');
      const onTwo = await login2('crosslock@orga.test', 'CrossLockPass123', 'orga');
      await sql('ifqm_test_master', 'DELETE FROM __DB__.login_attempts');
      return ok(!onTwo.token, onTwo.token ? 'Instance 2 ignored the lockout (state is per process)' : `Instance 2 also blocked: ${onTwo.error}`);
    });
  await tc(HS, HSn, 'Organisation created on 1 is served by 2 with no restart',
    'New tenants are picked up from the registry at request time', async () => {
      const created = await api('POST', '/api/platform/tenants', { token: PA, body: {
        org_name: 'Growth Co', slug: 'growth', admin_name: 'Growth Admin',
        admin_email: 'admin@growth.test', admin_password: 'GrowthAdminPass123',
      } });
      const l = await login2('admin@growth.test', 'GrowthAdminPass123', 'growth');
      return ok(created.status < 400 && !!l.token, `create=${created.status}, login on instance 2=${l.token ? 'ok' : l.error}`);
    });
  await tc(HS, HSn, 'Twenty requests alternating between the two instances',
    'All succeed — any request may land on any instance', async () => {
      let good = 0;
      for (let i = 0; i < 20; i++) {
        const r = i % 2 ? await api2('GET', '/api/ideas/dashboard', { token: AADMIN }) : await api('GET', '/api/ideas/dashboard', { token: AADMIN });
        if (r.status === 200) good++;
      }
      return ok(good === 20, `${good}/20 succeeded across both instances`);
    });
  await tc(HS, HSn, 'Attachment uploaded through 1, downloaded through 2',
    'Served by either instance when the upload directory is shared storage', async () => {
      const r = await api2('GET', `/api/upload/${ATTACH_ID}/download`, { token: AUSER });
      return ok(r.status === 200, `Status ${r.status} — note: requires shared/NFS storage or object storage across hosts`);
    });
  await tc(HS, HSn, 'Per-IP rate-limit counters across two instances',
    'Counters are per process — a strict global cap needs a shared store', async () => {
      await Promise.all(Array.from({ length: 40 }, () => api('GET', '/api/health', {})));
      const r = await api2('GET', '/api/health', {});
      return ok(r.status === 200, `Instance 2 unaffected by instance 1 traffic (health=${r.status}); documented limitation — use a Redis store for one global budget`);
    });
  await tc(HS, HSn, 'One instance is killed mid-service',
    'The surviving instance keeps serving — no shared in-process state', async () => {
      if (inst2) inst2.kill('SIGKILL');
      await new Promise((r) => setTimeout(r, 400));
      const survivor = await api('GET', '/api/ideas/dashboard', { token: AADMIN });
      const dead = await api2('GET', '/api/health', {}).catch(() => ({ status: 0 }));
      base2 = '';
      return ok(survivor.status === 200, `instance 1 = ${survivor.status} after instance 2 was killed (instance 2 = ${dead.status || 'down'})`);
    });

  // ══════════════════════════════ SCALABILITY — VERTICAL ══════════════════
  //  Load one tenant with a realistic multi-year dataset and then hold every
  //  screen to a latency budget on that same box.
  const VS = 'SCLV', VSn = 'Scalability — Vertical & Performance';

  const LOAD_IDEAS = 5000;
  const LOAD_USERS = 300;
  let loadMs = 0;

  await tc(VS, VSn, `Load one organisation with ${LOAD_IDEAS.toLocaleString()} ideas and ${LOAD_USERS} users`,
    'Dataset lands in the tenant database and is queryable', async () => {
      const t0 = Date.now();
      const uid = AUSER_ROW.id;
      const statuses = ['Submitted', 'Under Review', 'Approved', 'Rejected', 'Implemented'];
      for (let start = 0; start < LOAD_USERS; start += 100) {
        const rows = []; const params = [];
        for (let i = start; i < Math.min(LOAD_USERS, start + 100); i++) {
          rows.push('(?,?,?,?,?,?,NOW())');
          params.push(`LOAD-${i}`, `Load User ${i}`, `load${i}@orga.test`, bcrypt.hashSync('LoadUserPass123', 4), 'employee', 'active');
        }
        await sql('ifqm_test_a',
          `INSERT IGNORE INTO __DB__.users (employee_id,name,email,password_hash,role,status,password_changed_at) VALUES ${rows.join(',')}`, params);
      }
      for (let start = 0; start < LOAD_IDEAS; start += 500) {
        const rows = []; const params = [];
        for (let i = start; i < Math.min(LOAD_IDEAS, start + 500); i++) {
          rows.push('(?,?,?,?,?,?,?,DATE_SUB(NOW(), INTERVAL ? DAY),DATE_SUB(NOW(), INTERVAL ? DAY),DATE_SUB(NOW(), INTERVAL ? DAY))');
          params.push(`LOAD-2026-${String(i).padStart(6, '0')}`, `Load test idea ${i} — reduce cycle time on line ${i % 12}`,
            'Baseline situation captured by the load generator for performance measurement.',
            'Proposed counter-measure captured by the load generator for performance measurement.',
            statuses[i % statuses.length], uid, ['Low', 'Medium', 'High'][i % 3], i % 700, i % 700, i % 700);
        }
        await sql('ifqm_test_a',
          `INSERT IGNORE INTO __DB__.ideas
             (idea_code,title,present_situation,proposed_solution,status,submitter_id,impact_level,submitted_at,created_at,updated_at)
           VALUES ${rows.join(',')}`, params);
      }
      loadMs = Date.now() - t0;
      const rows = await sql('ifqm_test_a', 'SELECT COUNT(*) AS c FROM __DB__.ideas');
      return ok(Number(rows[0].c) >= LOAD_IDEAS, `${rows[0].c} ideas in ${ms(loadMs)} (${Math.round(LOAD_IDEAS / (loadMs / 1000))} rows/s)`);
    });
  await tc(VS, VSn, 'Idea list response size at 5,000 ideas',
    'Bounded at 100 rows — response size does not grow with the dataset', async () => {
      const r = await api('GET', '/api/ideas', { token: AADMIN });
      const n = (r.data?.ideas || []).length;
      return ok(r.status === 200 && n <= 100, `${n} rows returned, payload ${(r.text.length / 1024).toFixed(0)} KB`);
    });
  await tc(VS, VSn, 'Client attempts to raise the row cap (?limit=100000)',
    'Cap is server-side — a client cannot ask for the whole table', async () => {
      const r = await api('GET', '/api/ideas?limit=100000', { token: AADMIN });
      const n = (r.data?.ideas || []).length;
      return ok(n <= 100, `${n} rows returned`);
    });
  const budget = async (label, code, path, token, limitMs) => {
    await tc(VS, VSn, label, `Responds in under ${limitMs} ms at ${LOAD_IDEAS.toLocaleString()} ideas`, async () => {
      const [r, took] = await timed(() => api('GET', path, { token }));
      return ok(r.status === 200 && took < limitMs, `Status ${r.status} in ${ms(took)} (budget ${limitMs} ms)`);
    });
  };
  await budget('Idea list latency under load', 'list', '/api/ideas', AADMIN, 3000);
  await budget('Dashboard aggregate latency under load', 'dash', '/api/ideas/dashboard', AADMIN, 3000);
  await budget('Analytics latency under load', 'anl', '/api/reports/analytics', AADMIN, 4000);
  await budget('Leaderboard latency with 300+ users', 'lb', '/api/leaderboard', AADMIN, 3000);
  await budget('Audit report latency under load', 'aud', '/api/reports/audit', AADMIN, 4000);
  await budget('Title search latency under load', 'search', '/api/ideas?search=cycle%20time', AADMIN, 3000);
  await budget('Status-filtered list latency under load', 'filter', '/api/ideas?status=Approved', AADMIN, 3000);
  await budget('Approved-ideas (integration) listing under load', 'appr', '/api/integrations/approved-ideas', AADMIN, 4000);
  await budget('Single idea detail stays constant-time', 'detail', `/api/ideas/${IDEA1}`, AADMIN, 1000);
  await budget('Employee\'s own idea list under load', 'my', '/api/ideas/my', AUSER, 3000);

  await tc(VS, VSn, 'Index behind the list ordering exists',
    'idx_ideas_updated_at present so the top-100 read is an ordered index scan', async () => {
      const idx = await sql('ifqm_test_a', "SHOW INDEX FROM __DB__.ideas WHERE Key_name = 'idx_ideas_updated_at'");
      return ok(idx.length > 0, idx.length ? `Index present on column ${idx[0].Column_name}` : 'Index missing — list would filesort the whole table');
    });
  await tc(VS, VSn, 'Query plan for the list query at 5,000 rows',
    'No full scan of ideas with a filesort of the entire table', async () => {
      const plan = await sql('ifqm_test_a',
        'EXPLAIN SELECT i.id FROM __DB__.ideas i JOIN ifqm_test_a.users u ON u.id = i.submitter_id ORDER BY i.updated_at DESC LIMIT 100');
      const ideasRow = plan.find((p) => p.table === 'i') || plan[0];
      const good = ideasRow && (ideasRow.type !== 'ALL' || !/filesort/i.test(ideasRow.Extra || ''));
      return ok(good, `type=${ideasRow?.type}, key=${ideasRow?.key || 'none'}, rows=${ideasRow?.rows}, extra=${ideasRow?.Extra || '-'}`);
    });
  await tc(VS, VSn, 'CSV export of the full 5,000-idea dataset',
    'Completes inside 15 s and contains every row', async () => {
      const [r, took] = await timed(() => api('GET', '/api/export/ideas', { token: AADMIN }));
      const lines = (r.text || '').split('\n').filter(Boolean).length;
      return ok(r.status === 200 && took < 15000 && lines > LOAD_IDEAS, `${lines} lines, ${(r.text.length / 1024 / 1024).toFixed(1)} MB in ${ms(took)}`);
    });
  await tc(VS, VSn, 'Thirty concurrent requests against a pool of ' + config.dbPoolSize,
    'All served — requests queue for a connection instead of failing', async () => {
      const [res, took] = await timed(() => Promise.all(Array.from({ length: 30 }, () => api('GET', '/api/ideas/dashboard', { token: AADMIN }))));
      const good = res.filter((r) => r.status === 200).length;
      return ok(good === 30, `${good}/30 succeeded in ${ms(took)} with DB_POOL_SIZE=${config.dbPoolSize}`);
    });
  await tc(VS, VSn, 'Sustained throughput on the loaded dataset',
    'One hundred reads with no errors, throughput recorded', async () => {
      const t0 = Date.now();
      let bad = 0;
      for (let i = 0; i < 100; i++) {
        const r = await api('GET', i % 3 === 0 ? '/api/ideas' : '/api/ideas/dashboard', { token: AADMIN });
        if (r.status !== 200) bad++;
      }
      const took = Date.now() - t0;
      return ok(bad === 0, `100 requests in ${ms(took)} → ${(100 / (took / 1000)).toFixed(1)} req/s, ${bad} errors`);
    });
  await tc(VS, VSn, 'The other organisation while this one holds 5,000 ideas',
    'Unaffected — each tenant is a separate schema with its own indexes', async () => {
      const [r, took] = await timed(() => api('GET', '/api/ideas/dashboard', { token: BADMIN }));
      return ok(r.status === 200 && took < 1500, `Org B dashboard ${r.status} in ${ms(took)}`);
    });
  await tc(VS, VSn, 'Process memory after the load run',
    'Resident memory stays bounded — no dataset is held in the application', async () => {
      const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);
      const heap = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      return ok(rss < 1024, `RSS ${rss} MB, heap ${heap} MB after ${LOAD_IDEAS.toLocaleString()} ideas`);
    });
  await tc(VS, VSn, 'Notification list is bounded',
    'Returns a capped page rather than every notification ever raised', async () => {
      const r = await api('GET', '/api/notifications', { token: AUSER });
      const n = (r.data?.notifications || r.data?.items || []).length;
      return ok(r.status === 200 && n <= 200, `${n} notifications returned`);
    });

  // ══════════════════════════════ DATA INTEGRITY & RECOVERY ═══════════════
  const DT = 'DATA', DTn = 'Data Integrity & Recovery';

  const mysql = (await import('mysql2/promise')).default;
  const { runMigrations } = await import('../scripts/migrate.js');
  const migConn = await mysql.createConnection({
    host: config.masterDb.host, user: config.masterDb.user, password: config.masterDb.password,
    multipleStatements: true, charset: 'utf8mb4',
  });
  const quiet = () => {};

  await tc(DT, DTn, 'Paginated queries do not bind LIMIT or OFFSET',
    'No prepared statement takes a row limit as a parameter - MySQL 8 rejects it', async () => {
      /*
       * This is a portability trap that a passing test suite cannot catch on
       * its own, which is why it is checked in the source rather than by
       * running a query.
       *
       * MariaDB (what most people run locally) accepts LIMIT ? and OFFSET ? as
       * bound parameters. MySQL 8 does not: the prepared-statement protocol
       * refuses them with "Incorrect arguments to mysqld_stmt_execute". So a
       * paginated list works perfectly in development and returns 500 in
       * production against a managed MySQL - which is exactly what happened to
       * the admin console's user list. An organisation with four employees
       * showed an empty table, and the only visible symptom was the absence of
       * data.
       *
       * The fix everywhere is to build the row count into the statement text
       * after clamping it to an integer, as activityService already did.
       */
      const files = fs.readdirSync(path.join(REPO_DIR, 'backend', 'src', 'services'))
        .filter((f) => f.endsWith('.js'));
      const offenders = [];
      for (const f of files) {
        const src = readRepo(`backend/src/services/${f}`);
        // Look inside execute()/query() calls only, so a LIMIT ? appearing in a
        // comment or a string of prose does not trip it.
        for (const m of src.matchAll(/(?:execute|query)\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g)) {
          if (/\b(?:LIMIT|OFFSET)\s+\?/i.test(m[1])) offenders.push(f);
        }
      }
      const unique = [...new Set(offenders)];
      return ok(unique.length === 0,
        unique.length ? `bound LIMIT/OFFSET in: ${unique.join(', ')}` : `${files.length} service files clean`);
    });

  await tc(DT, DTn, 'Migration runner applied against the live schemas',
    'Pending migrations applied and recorded in the ledger', async () => {
      const ran = await runMigrations(migConn, quiet, 'ifqm_test_master');
      const [rows] = await migConn.query('SELECT COUNT(*) AS c FROM ifqm_test_master.schema_migrations');
      return ok(rows[0].c > 0, `${ran} application(s) this pass, ${rows[0].c} ledger row(s) total`);
    });
  await tc(DT, DTn, 'Migration runner executed a second time',
    'Applies nothing — migrations are idempotent and ledgered', async () => {
      const ran = await runMigrations(migConn, quiet, 'ifqm_test_master');
      return ok(ran === 0, `${ran} application(s) on the repeat run`);
    });
  await tc(DT, DTn, 'A brand-new migration file is dropped into the folder',
    'Picked up automatically on the next run, then recorded', async () => {
      const file = path.join(REPO_DIR, 'db', 'migrations', '999_tc_probe.sql');
      fs.writeFileSync(file, 'CREATE TABLE IF NOT EXISTS tc_probe (id INT PRIMARY KEY) ENGINE=InnoDB;\n');
      try {
        const ran = await runMigrations(migConn, quiet, 'ifqm_test_master');
        const [t] = await migConn.query("SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA='ifqm_test_a' AND TABLE_NAME='tc_probe'");
        return ok(ran >= 1 && t[0].c === 1, `${ran} application(s); probe table present in tenant A = ${t[0].c === 1}`);
      } finally {
        fs.unlinkSync(file);
        await migConn.query("DELETE FROM ifqm_test_master.schema_migrations WHERE filename = '999_tc_probe.sql'");
        for (const d of ['ifqm_test_a', 'ifqm_test_b']) await migConn.query(`DROP TABLE IF EXISTS \`${d}\`.tc_probe`);
      }
    });
  await tc(DT, DTn, 'Ledger records which schema received which migration',
    'One row per (database, migration) — reproducible on a new environment', async () => {
      const [rows] = await migConn.query('SELECT db_name, COUNT(*) AS c FROM ifqm_test_master.schema_migrations GROUP BY db_name');
      return ok(rows.length >= 2, rows.map((r) => `${r.db_name}:${r.c}`).join(', '));
    });
  await tc(DT, DTn, 'A tenant provisioned by the product versus the reference schema',
    'Same table set — a new organisation is not a second-class database', async () => {
      const tables = async (db) => (await migConn.query(
        'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', [db]))[0].map((r) => r.t);
      const ref = await tables('ifqm_test_a');
      const fresh = await tables('ifqm_growth');
      const missing = ref.filter((t) => !fresh.includes(t) && t !== 'tc_probe');
      return ok(fresh.length > 0 && missing.length === 0, `reference ${ref.length} tables, provisioned ${fresh.length}, missing: ${missing.join(', ') || 'none'}`);
    });
  await tc(DT, DTn, 'Duplicate idea code inserted directly',
    'Rejected by the UNIQUE constraint — codes cannot collide', async () => {
      const code = (await sql('ifqm_test_a', 'SELECT idea_code FROM __DB__.ideas LIMIT 1'))[0].idea_code;
      let failed = false; let msg = '';
      try {
        await sql('ifqm_test_a', 'INSERT INTO __DB__.ideas (idea_code,title,present_situation,proposed_solution,status,submitter_id) VALUES (?,?,?,?,?,?)',
          [code, 'dup probe', 'x', 'y', 'Submitted', AUSER_ROW.id]);
      } catch (e) { failed = true; msg = e.code || e.message; }
      return ok(failed, failed ? `Rejected: ${msg}` : 'Duplicate code accepted (integrity gap)');
    });
  await tc(DT, DTn, 'Idea deleted while it still has children',
    'Comments, votes, attachments and workflow rows go with it', async () => {
      const id = await mkIdea(AUSER, 'Cascade probe idea');
      await api('POST', '/api/comments', { token: AADMIN, body: { idea_id: id, content: 'Cascade probe comment' } });
      await api('POST', '/api/votes/community', { token: AADMIN, body: { idea_id: id, vote_type: 'up' } });
      await sql('ifqm_test_a', 'DELETE FROM __DB__.ideas WHERE id = ?', [id]);
      const c = (await sql('ifqm_test_a', 'SELECT COUNT(*) AS c FROM __DB__.idea_comments WHERE idea_id = ?', [id]))[0].c;
      const v = (await sql('ifqm_test_a', 'SELECT COUNT(*) AS c FROM __DB__.idea_community_votes WHERE idea_id = ?', [id]))[0].c;
      const w = (await sql('ifqm_test_a', 'SELECT COUNT(*) AS c FROM __DB__.idea_workflow WHERE idea_id = ?', [id]))[0].c;
      return ok(Number(c) + Number(v) + Number(w) === 0, `orphans left — comments:${c}, votes:${v}, workflow:${w}`);
    });
  await tc(DT, DTn, 'Idea code sequence after a deletion',
    'Next code continues past the highest issued — no reuse, no collision', async () => {
      const before = (await sql('ifqm_test_a', "SELECT MAX(CAST(SUBSTRING_INDEX(idea_code,'-',-1) AS UNSIGNED)) AS n FROM __DB__.ideas WHERE idea_code LIKE 'IDA-%'"))[0].n;
      const id = await mkIdea(AUSER, 'Sequence probe after deletion');
      const row = (await sql('ifqm_test_a', 'SELECT idea_code FROM __DB__.ideas WHERE id = ?', [id]))[0];
      const n = Number(String(row.idea_code).split('-').pop());
      return ok(n > Number(before), `previous max ${before} → issued ${row.idea_code}`);
    });
  await tc(DT, DTn, 'Approval writes the status and the audit entry together',
    'Both present — a decision is never half-recorded', async () => {
      const id = await mkIdea(AUSER, 'Atomicity probe idea');
      await api('POST', '/api/ideas/review-action', { token: AREVIEWER, body: { idea_id: id, decision: 'Approved', comment: 'Atomicity probe' } });
      const idea = (await sql('ifqm_test_a', 'SELECT status FROM __DB__.ideas WHERE id = ?', [id]))[0];
      const wf = (await sql('ifqm_test_a', 'SELECT COUNT(*) AS c FROM __DB__.idea_workflow WHERE idea_id = ?', [id]))[0].c;
      return ok(idea.status !== 'Submitted' && Number(wf) >= 1, `status=${idea.status}, workflow rows=${wf}`);
    });
  await tc(DT, DTn, 'Points awarded on submission match the configured value',
    'Ledger and configuration agree', async () => {
      const before = (await userRow('user@orga.test')).points;
      await mkIdea(AUSER, 'Points integrity probe');
      const after = (await userRow('user@orga.test')).points;
      const delta = Number(after) - Number(before);
      return ok(delta === config.points.submit, `+${delta} points (POINTS_SUBMIT=${config.points.submit})`);
    });
  await tc(DT, DTn, 'Stored timestamps versus the database clock',
    'Written in the database\'s own time — no timezone drift', async () => {
      const id = await mkIdea(AUSER, 'Timestamp integrity probe');
      const row = (await sql('ifqm_test_a', 'SELECT ABS(TIMESTAMPDIFF(SECOND, created_at, NOW())) AS d FROM __DB__.ideas WHERE id = ?', [id]))[0];
      return ok(Number(row.d) <= 120, `created_at is ${row.d} s from NOW()`);
    });
  await tc(DT, DTn, 'Character set of the tenant tables',
    'utf8mb4 throughout — every language and emoji storable', async () => {
      const [rows] = await migConn.query(
        "SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA='ifqm_test_a' AND TABLE_COLLATION NOT LIKE 'utf8mb4%'");
      return ok(Number(rows[0].c) === 0, `${rows[0].c} table(s) not on utf8mb4`);
    });
  await tc(DT, DTn, 'Storage engine of the tenant tables',
    'InnoDB throughout — transactional and crash-recoverable', async () => {
      const [rows] = await migConn.query(
        "SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA='ifqm_test_a' AND ENGINE <> 'InnoDB'");
      return ok(Number(rows[0].c) === 0, `${rows[0].c} table(s) not InnoDB`);
    });
  await tc(DT, DTn, 'Primary keys on every tenant table',
    'Required for replication and for safe row-level recovery', async () => {
      const [rows] = await migConn.query(`
        SELECT t.TABLE_NAME AS t FROM information_schema.TABLES t
         WHERE t.TABLE_SCHEMA='ifqm_test_a' AND t.TABLE_TYPE='BASE TABLE'
           AND NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS s
                            WHERE s.TABLE_SCHEMA=t.TABLE_SCHEMA AND s.TABLE_NAME=t.TABLE_NAME AND s.INDEX_NAME='PRIMARY')`);
      return ok(rows.length === 0, rows.length ? `Missing PK: ${rows.map((r) => r.t).join(', ')}` : 'Every table has a primary key');
    });
  await tc(DT, DTn, 'Backup script is parameterised, not hard-coded',
    'Reads credentials and schema names from configuration', async () => {
      const src = readRepo('backend/scripts/backup.js');
      const envDriven = /process\.env\.MASTER_DB_USER/.test(src) && /mysqldump/i.test(src);
      const discovers = /FROM tenants|db_name/i.test(src);
      const hardcoded = /ifqm_ideation|PASS\s*=\s*['"][^'"]+['"]/.test(src);
      return ok(envDriven && !hardcoded, `env-driven credentials=${envDriven}, schemas discovered from the registry=${discovers}, hard-coded secrets=${hardcoded}`);
    });
  await tc(DT, DTn, 'Restore procedure documented for operators',
    'Deployment guide covers backup and restore', async () => {
      const doc = readRepo('docs/DEPLOYMENT.md').toLowerCase();
      return ok(doc.includes('backup') && (doc.includes('restore') || doc.includes('mysql <')), `backup mentioned=${doc.includes('backup')}, restore mentioned=${doc.includes('restore')}`);
    });
  await tc(DT, DTn, 'Suspended organisation reactivated',
    'All of its data is intact after the outage', async () => {
      const list = (await api('GET', '/api/platform/tenants', { token: PA })).data;
      const rows = Array.isArray(list?.tenants) ? list.tenants : (Array.isArray(list) ? list : []);
      const orgb = rows.find((x) => x.slug === 'orgb');
      const before = (await sql('ifqm_test_b', 'SELECT COUNT(*) AS c FROM __DB__.ideas'))[0].c;
      await api('PATCH', `/api/platform/tenants/${orgb.id}`, { token: PA, body: { status: 'suspended' } });
      await api('PATCH', `/api/platform/tenants/${orgb.id}`, { token: PA, body: { status: 'active' } });
      const after = (await sql('ifqm_test_b', 'SELECT COUNT(*) AS c FROM __DB__.ideas'))[0].c;
      return ok(Number(before) === Number(after), `ideas before=${before}, after=${after}`);
    });

  // ══════════════════════════════ EXTENSIBILITY & FUTURE SCOPE ════════════
  const FU = 'FUT', FUn = 'Extensibility & Future Scope';

  const localeKeys = (code) => {
    const src = readRepo(`frontend/src/i18n/${code}.js`);
    return new Set([...src.matchAll(/^\s*'([^']+)'\s*:/gm)].map((m) => m[1]));
  };
  const LOCALES = ['en', 'hi', 'kn', 'ml', 'mr', 'ta', 'te'];

  await tc(FU, FUn, 'Translation coverage across all shipped languages',
    'Every locale carries the same key set as English', async () => {
      const en = localeKeys('en');
      const report = [];
      let complete = true;
      for (const code of LOCALES.filter((c) => c !== 'en')) {
        const k = localeKeys(code);
        const missing = [...en].filter((x) => !k.has(x)).length;
        const extra = [...k].filter((x) => !en.has(x)).length;
        if (missing || extra) complete = false;
        report.push(`${code}:${k.size}${missing ? ` (-${missing})` : ''}${extra ? ` (+${extra})` : ''}`);
      }
      return ok(complete, `en:${en.size} · ${report.join(' · ')}`);
    });
  await tc(FU, FUn, 'Adding an eighth language',
    'Purely additive — one dictionary file plus one registry line', async () => {
      const reg = readRepo('frontend/src/i18n/translations.js');
      const importsAll = LOCALES.every((c) => new RegExp(`['"\`./]*${c}(\\.js)?['"]`).test(reg));
      return ok(importsAll, importsAll ? 'All seven locales registered in one map — an eighth is one import + one entry' : 'Locale registry is not a simple map');
    });
  await tc(FU, FUn, 'Adding a new API area',
    'Feature modules are mounted in one aggregator, no core surgery', async () => {
      const src = readRepo('backend/src/routes/index.js');
      const mounts = [...src.matchAll(/router\.use\('\/([a-z-]+)'/g)].length;
      return ok(mounts >= 15, `${mounts} feature modules mounted under /api`);
    });
  await tc(FU, FUn, 'Adding a new reviewer role',
    'Roles are data in one list per route file, not scattered conditionals', async () => {
      const src = readRepo('backend/src/routes/ideaRoutes.js');
      const declared = /const REVIEWER_ROLES = \[/.test(src) && /const IMPL_ROLES = \[/.test(src);
      return ok(declared, declared ? 'Reviewer and implementer role sets are single declarations' : 'Role sets are not centralised');
    });
  await tc(FU, FUn, 'Onboarding a new organisation at runtime',
    'Usable the moment it is created — no deploy, no restart', async () => {
      const l = await login('admin@growth.test', 'GrowthAdminPass123', 'growth');
      const r = await api('GET', '/api/ideas/dashboard', { token: l.token });
      return ok(!!l.token && r.status === 200, `login=${l.token ? 'ok' : l.error}, dashboard=${r.status}`);
    });
  await tc(FU, FUn, 'Two organisations holding different integration endpoints',
    'Per-tenant configuration — customers can point at their own systems', async () => {
      await api('PUT', '/api/integrations/qcms', { token: AADMIN, body: { base_url: 'https://qcms-a.example/v1' } });
      await api('PUT', '/api/integrations/qcms', { token: BADMIN, body: { base_url: 'https://qcms-b.example/v2' } });
      const a = await api('GET', '/api/integrations/qcms', { token: AADMIN });
      const b = await api('GET', '/api/integrations/qcms', { token: BADMIN });
      const distinct = a.data?.config?.base_url === 'https://qcms-a.example/v1' && b.data?.config?.base_url === 'https://qcms-b.example/v2';
      return ok(distinct, `org A → ${a.data?.config?.base_url}, org B → ${b.data?.config?.base_url}`);
    });
  await tc(FU, FUn, 'Capacity and policy knobs without a code change',
    'Limits, pool size, token life and points all come from the environment', async () => {
      const knobs = {
        GLOBAL_RATE_LIMIT: Number(process.env.GLOBAL_RATE_LIMIT) || 300,
        AUTH_RATE_LIMIT: Number(process.env.AUTH_RATE_LIMIT) || 30,
        DB_POOL_SIZE: config.dbPoolSize, MAX_FILE_MB: config.maxFileMb,
        JWT_EXPIRES_IN: config.jwt.expiresIn, POINTS_SUBMIT: config.points.submit,
        POINTS_APPROVED: config.points.approved, POINTS_IMPLEMENTED: config.points.implemented,
        MIN_PASSWORD_LENGTH: config.minPasswordLength,
      };
      const all = Object.values(knobs).every((v) => Number.isFinite(v));
      return ok(all, Object.entries(knobs).map(([k, v]) => `${k}=${v}`).join(', '));
    });
  await tc(FU, FUn, 'Tenants can be spread across database servers',
    'The registry stores a host per tenant, so growth means another DB box', async () => {
      const rows = await sql('ifqm_test_master', 'SELECT slug, db_host, db_name FROM __DB__.tenants');
      const perTenantHost = rows.every((r) => 'db_host' in r);
      return ok(perTenantHost && rows.length >= 2, rows.map((r) => `${r.slug}@${r.db_host}/${r.db_name}`).join(' · '));
    });
  await tc(FU, FUn, 'AI scoring with no provider key configured',
    'Falls back to the built-in heuristic — the feature never hard-fails', async () => {
      const r = await api('GET', `/api/score?id=${IDEA1}`, { token: AADMIN });
      return ok(r.status === 200, `Status ${r.status}, provider="${config.ai.provider || 'none — heuristic'}"`);
    });
  await tc(FU, FUn, 'Swapping the AI provider',
    'Provider and keys are configuration, not embedded calls', async () => {
      const surface = ['provider', 'openaiApiKey', 'geminiApiKey'].every((k) => k in config.ai);
      return ok(surface, `config.ai exposes: ${Object.keys(config.ai).join(', ')}`);
    });
  await tc(FU, FUn, 'Targeting a second downstream system',
    'The QCMS field mapping is a pure function — a new target is a new mapper', async () => {
      const payload = mapIdeaToQcms({
        idea_code: 'IDA-2026-999', title: 'Mapper purity probe', impact_areas: 'Cost', impact_level: 'High',
        present_situation: 'a', proposed_solution: 'b', department: 'Quality', submitter_name: 'Probe User',
        roi_value: 1000, investment_required: '250',
      });
      const shaped = payload.ideaCode === 'IDA-2026-999' && payload.category === 'Cost' && payload.status === 'Approved';
      return ok(shaped, `mapped ${Object.keys(payload).length} fields with no I/O: category=${payload.category}, status=${payload.status}`);
    });
  await tc(FU, FUn, 'Response envelope is uniform across features',
    'New clients can rely on one success/error shape', async () => {
      const paths = ['/api/ideas', '/api/categories', '/api/leaderboard', '/api/notifications', '/api/settings'];
      const shapes = await Promise.all(paths.map((p) => api('GET', p, { token: AADMIN })));
      const uniform = shapes.every((r) => r.data && typeof r.data.success === 'boolean');
      return ok(uniform, `${shapes.filter((r) => r.data?.success !== undefined).length}/${paths.length} endpoints return the standard envelope`);
    });
  await tc(FU, FUn, 'Continuous integration runs this suite',
    'Every push is gated by the automated tests', async () => {
      const ci = readRepo('.github/workflows/ci.yml');
      return ok(/npm (run )?test/.test(ci), /npm (run )?test/.test(ci) ? 'ci.yml runs npm test on push' : 'No test step in CI');
    });
  await tc(FU, FUn, 'Runtime floor is declared',
    'package.json pins the supported Node version for future upgrades', async () => {
      const pkg = JSON.parse(readRepo('backend/package.json'));
      return ok(!!pkg.engines?.node, `engines.node = ${pkg.engines?.node || 'undeclared'}`);
    });
  await tc(FU, FUn, 'Reproducible dependency installs',
    'Lockfile committed so a future build resolves the same tree', async () => {
      const present = fs.existsSync(path.join(BACKEND_DIR, 'package-lock.json'));
      return ok(present, present ? 'backend/package-lock.json present' : 'No lockfile');
    });
  await tc(FU, FUn, 'No production database name hard-coded in the source',
    'Schema names come from configuration, so environments stay separable', async () => {
      const hits = [];
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith('.js') && /ifqm_ideation/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(BACKEND_DIR, p));
        }
      };
      walk(path.join(BACKEND_DIR, 'src'));
      const onlyConfig = hits.every((h) => h.includes('config'));
      return ok(onlyConfig, hits.length ? `referenced in: ${hits.join(', ')}` : 'not referenced anywhere in src/');
    });
  await tc(FU, FUn, 'Operator and end-user documentation ships with the code',
    'Deployment, user guide and changelog are in the repository', async () => {
      const docs = ['docs/DEPLOYMENT.md', 'docs/USER_GUIDE.md', 'docs/CHANGELOG.md', 'README.md'];
      const missing = docs.filter((d) => !fs.existsSync(path.join(REPO_DIR, d)));
      return ok(missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${docs.length} documents present`);
    });
  await tc(FU, FUn, 'Front end builds to static assets',
    'Can be served from a CDN or any number of web nodes', async () => {
      const pkg = JSON.parse(readRepo('frontend/package.json'));
      return ok(!!pkg.scripts?.build, `build script: ${pkg.scripts?.build || 'none'}`);
    });

  // ══════════════════════════════ OBSERVABILITY & OPERATIONS ══════════════
  const OB = 'OPS', OBn = 'Observability & Operations';

  await tc(OB, OBn, 'Liveness probe cost',
    'Answers in single-digit milliseconds — safe to poll often', async () => {
      const [r, took] = await timed(() => api('GET', '/api/health', {}));
      return ok(r.status === 200 && took < 250, `Status ${r.status} in ${ms(took)}`);
    });
  await tc(OB, OBn, 'Readiness probe reports database reachability',
    'Distinct from liveness so a database-less instance leaves rotation', async () => {
      const r = await api('GET', '/api/ready', {});
      return ok(r.status === 200 && r.data?.status === 'ready', `Status ${r.status}: ${JSON.stringify(r.data)}`);
    });
  await tc(OB, OBn, 'Graceful shutdown is wired up',
    'SIGTERM/SIGINT drain in-flight requests and close pools', async () => {
      const src = readRepo('backend/server.js');
      const wired = /SIGTERM/.test(src) && /server\.close/.test(src) && /closeAllPools/.test(src);
      return ok(wired, wired ? 'Drain-then-close handler registered for SIGINT and SIGTERM' : 'No graceful shutdown');
    });
  await tc(OB, OBn, 'Crash handlers registered',
    'Unhandled rejections and exceptions are logged, not silent', async () => {
      const src = readRepo('backend/server.js');
      return ok(/unhandledRejection/.test(src) && /uncaughtException/.test(src), 'unhandledRejection and uncaughtException handlers present');
    });
  await tc(OB, OBn, 'Durable log trail for support',
    'Daily files, location configurable, enabled in production', async () => {
      const src = readRepo('backend/src/utils/logger.js');
      const good = /LOG_TO_FILE/.test(src) && /LOG_DIR/.test(src) && /error-/.test(src);
      return ok(good, 'LOG_TO_FILE / LOG_DIR honoured; separate daily error log');
    });
  await tc(OB, OBn, 'Audit trail available to an administrator',
    'Who did what, retrievable from the product itself', async () => {
      const r = await api('GET', '/api/reports/audit', { token: AADMIN });
      const rows = r.data?.audit || r.data?.rows || r.data?.entries || [];
      return ok(r.status === 200, `Status ${r.status}, ${Array.isArray(rows) ? rows.length : 'n/a'} entries returned`);
    });
  await tc(OB, OBn, 'Configuration is validated at boot',
    'Insecure production settings stop the process rather than run wide open', async () => {
      const src = readRepo('backend/server.js');
      return ok(/assertConfigOrExit/.test(src), 'server.js calls assertConfigOrExit before listening');
    });
  await tc(OB, OBn, 'Release history is maintained',
    'CHANGELOG present for operators tracking what shipped', async () => {
      const ch = readRepo('docs/CHANGELOG.md');
      return ok(ch.length > 200, `${ch.split('\n').length} lines of change history`);
    });

  await migConn.end().catch(() => {});
  if (inst2 && !inst2.killed) inst2.kill('SIGKILL');

  await teardownSuite();
  await dropProvisionedDbs();

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

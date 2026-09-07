/** MSME self-registration. */
import { masterDb } from '../database/master.js';
import { ApiError, badRequest, notFound } from '../utils/respond.js';
import { assignPlan, defaultTrialDays } from './subscriptionService.js';
import { defaultTrialPlan } from './planService.js';
import logger from '../utils/logger.js';
import { verifyGstin } from '../utils/gstin.js';
import { createTenant } from './platformService.js';
import bcrypt from 'bcryptjs';
import * as verification from './verificationService.js';

// Both are delegated to verificationService, the same machinery the rest of the product
// uses for one-time codes.
export async function sendRegistrationEmailOtp(email, meta = {}) {
  // AWAITED. It was not, and checkCorporateEmail is async.
  const check = await checkCorporateEmail(String(email || '').trim().toLowerCase());
  if (!check.ok) throw badRequest(check.reason);
  return verification.sendCode({
    identifier: email, purpose: 'registration_verify', ip: meta.ip, announce: true,
  });
}

export async function verifyRegistrationEmailOtp(email, code) {
  await verification.verifyCode({ identifier: email, code, purpose: 'registration_verify' });
  return { success: true, verified: true, message: 'Email verified successfully.' };
}

export async function sendRegistrationPhoneOtp(phone, meta = {}) {
  const p = String(phone || '').trim();
  if (!PHONE_RE.test(p)) throw badRequest('Enter a valid mobile number.');
  return verification.sendCode({
    identifier: p, purpose: 'registration_phone', ip: meta.ip, announce: true,
  });
}

export async function verifyRegistrationPhoneOtp(phone, code) {
  await verification.verifyCode({ identifier: phone, code, purpose: 'registration_phone' });
  return { success: true, verified: true, message: 'Mobile number verified successfully.' };
}

// Consumer mailbox providers.
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk', 'ymail.com',
  'rocketmail.com', 'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'outlook.in', 'live.com',
  'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'proton.me',
  'pm.me', 'gmx.com', 'gmx.net', 'yandex.com', 'yandex.ru', 'mail.com', 'mail.ru',
  'zoho.com', 'zohomail.com', 'rediffmail.com', 'rediff.com', 'indiatimes.com',
  'sify.com', 'in.com', 'inbox.com', 'fastmail.com', 'hushmail.com', 'tutanota.com',
  'tuta.io', 'qq.com', '163.com', '126.com', 'naver.com', 'daum.net',
]);

// Throwaway-mailbox services. Same intent as above: keep the queue reviewable.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'sharklasers.com', '10minutemail.com',
  'temp-mail.org', 'tempmail.com', 'throwawaymail.com', 'yopmail.com', 'trashmail.com',
  'getnada.com', 'dispostable.com', 'maildrop.cc', 'fakeinbox.com', 'mailnesia.com',
  'spamgourmet.com', 'moakt.com', 'emailondeck.com', 'mohmal.com',
]);

const ENTITY_TYPES = [
  'proprietorship', 'partnership', 'llp', 'private_limited',
  'public_limited', 'cooperative', 'trust', 'society', 'other',
];
const ENTERPRISE_CATEGORIES = ['micro', 'small', 'medium'];
const TURNOVER_BANDS = [
  'under_50l', '50l_2cr', '2cr_10cr', '10cr_50cr', '50cr_250cr', 'above_250cr',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Statutory identifier formats.
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const UDYAM_RE = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;
const CIN_RE = /^[LUu][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
const PINCODE_RE = /^[1-9][0-9]{5}$/;
const PHONE_RE = /^[0-9+\-\s()]{7,20}$/;

const str = (v) => String(v ?? '').trim();
const upper = (v) => str(v).toUpperCase();

/** The domain part of an email, lowercased. */
export function emailDomain(email) {
  const at = str(email).lastIndexOf('@');
  return at === -1 ? '' : str(email).slice(at + 1).toLowerCase();
}

/*
 * Has a platform admin allowed this address, or its whole provider, through the
 * corporate-email rule?
 */
export async function isAllowedFreeEmail(email) {
  const e = str(email).toLowerCase();
  const domain = emailDomain(e);
  if (!e || !domain) return false;
  try {
    const [rows] = await masterDb().execute(
      'SELECT entry FROM email_whitelist WHERE entry IN (?, ?) LIMIT 1', [e, domain]
    );
    return rows.length > 0;
  } catch (err) {
    logger.warn('email whitelist lookup failed', err.message);
    return false;
  }
}

/** Is this a corporate address we will accept an application from? */
/*
 * The half of the rule that needs no database: is this a well-formed address on a domain
 * we would never accept whatever anybody says?
 */
export function checkEmailShape(email) {
  const e = str(email).toLowerCase();
  if (!EMAIL_RE.test(e)) return { ok: false, reason: 'Enter a valid email address.' };

  const domain = emailDomain(e);
  if (!domain || !domain.includes('.')) {
    return { ok: false, reason: 'Enter a valid email address.' };
  }
  // A bare TLD or a single-label host is not a valid email domain. Checked before the lists,
  // because neither can meaningfully contain one.
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some((l) => !l)) {
    return { ok: false, reason: 'Enter a valid work email address.' };
  }
  // Disposable mailboxes are refused outright and are NOT whitelistable.
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
    return { ok: false, reason: 'Temporary email addresses are not accepted.' };
  }
  return { ok: true, free_provider: FREE_EMAIL_DOMAINS.has(domain) };
}

export async function checkCorporateEmail(email) {
  const e = str(email).toLowerCase();
  const shape = checkEmailShape(e);
  if (!shape.ok) return shape;

  if (shape.free_provider) {
    if (await isAllowedFreeEmail(e)) return { ok: true, allowed_by_exception: true };
    return {
      ok: false,
      free_provider: true,
      reason: 'Please apply from your company email address. '
        + 'If your business does not have one, contact us and we will enable this address for you.',
    };
  }
  return { ok: true };
}

/** Normalise a requested org code the same way tenant resolution will. */
function normaliseSlug(raw) {
  return str(raw).toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

/** Validate an application and return the row to insert. */

export function validateApplication(body) {
  const companyName = str(body.company_name);
  if (companyName.length < 2 || companyName.length > 150) {
    throw badRequest('Enter your registered company name (2-150 characters).');
  }

  const contactEmail = str(body.contact_email).toLowerCase();
  const emailCheck = checkEmailShape(contactEmail);
  if (!emailCheck.ok) throw badRequest(emailCheck.reason);

  const contactName = str(body.contact_name);
  if (contactName.length < 2 || contactName.length > 120) {
    throw badRequest('Enter the full name of the person applying.');
  }

  let slug = normaliseSlug(body.proposed_slug);
  if (!slug) {
    // Derive one from the domain's second-level label so the applicant is not forced to invent
    // an identifier they have no opinion about.
    slug = normaliseSlug(emailDomain(contactEmail).split('.')[0]);
  }
  if (slug.length < 2 || slug.length > 30) {
    throw badRequest('Organisation code must be 2-30 characters (letters, numbers, - and _).');
  }

  // A mobile number is required, not optional.
  const phone = str(body.contact_phone);
  if (!phone) throw badRequest('Enter the contact mobile number.');
  if (!PHONE_RE.test(phone)) throw badRequest('Enter a valid contact phone number.');
  if (phone.replace(/\D/g, '').length < 10) {
    throw badRequest('Enter a full mobile number, including the area or country code.');
  }

  // Verified, not merely shaped.
  const gstin = upper(body.gstin);
  if (gstin) {
    const g = verifyGstin(gstin, upper(body.pan));
    if (!g.ok) throw badRequest(g.reason);
  }
  const pan = upper(body.pan);
  if (pan && !PAN_RE.test(pan)) {
    throw badRequest('PAN does not look valid. It is 10 characters, e.g. ABCDE1234F.');
  }
  const udyam = upper(body.udyam_number);
  if (udyam && !UDYAM_RE.test(udyam)) {
    throw badRequest('Udyam number does not look valid. The format is UDYAM-XX-00-0000000.');
  }
  const cin = upper(body.cin);
  if (cin && !CIN_RE.test(cin)) throw badRequest('CIN does not look valid (21 characters).');

  const entityType = str(body.entity_type).toLowerCase();
  if (entityType && !ENTITY_TYPES.includes(entityType)) throw badRequest('Select a valid entity type.');

  const category = str(body.enterprise_category).toLowerCase();
  if (category && !ENTERPRISE_CATEGORIES.includes(category)) {
    throw badRequest('Select micro, small or medium.');
  }

  const turnover = str(body.annual_turnover_band).toLowerCase();
  if (turnover && !TURNOVER_BANDS.includes(turnover)) throw badRequest('Select a valid turnover range.');

  const employeeCount = body.employee_count === '' || body.employee_count == null
    ? null : Number(body.employee_count);
  if (employeeCount != null && (!Number.isFinite(employeeCount) || employeeCount < 1 || employeeCount > 100000)) {
    throw badRequest('Enter a realistic number of employees.');
  }

  const year = body.year_established === '' || body.year_established == null
    ? null : Number(body.year_established);
  const thisYear = new Date().getFullYear();
  if (year != null && (!Number.isInteger(year) || year < 1850 || year > thisYear)) {
    throw badRequest(`Year established must be between 1850 and ${thisYear}.`);
  }

  const pincode = str(body.pincode);
  if (pincode && !PINCODE_RE.test(pincode)) throw badRequest('Enter a valid 6-digit PIN code.');

  const nic = str(body.nic_code);
  if (nic && !/^[0-9]{2,5}$/.test(nic)) throw badRequest('NIC code is 2-5 digits.');

  const website = str(body.website);
  if (website && !/^https?:\/\/\S+\.\S+/.test(website)) {
    throw badRequest('Website must start with http:// or https://');
  }

  const designation = str(body.contact_designation);
  const addressLine = str(body.address_line);
  const city = str(body.city);
  const stateName = str(body.state);
  const country = str(body.country) || 'India';

  // Everything above validates the FORM of a value if one was supplied.
  // MOM 29 Jul 2026 §13 sets this list, and it is deliberately shorter than it was.
  const required = [
    [companyName, 'registered company name'],
    [phone, 'contact phone number'],
    [gstin, 'GSTIN'],
    [pan, 'business PAN'],
    [entityType, 'entity type'],
    // MSME category is NOT required, and asking for it here was a live bug.
    [str(body.sector), 'sector'],
  ];
  for (const [value, label] of required) {
    if (!value) throw badRequest(`Enter your ${label}.`);
  }
  if (employeeCount == null) throw badRequest('Enter your number of employees.');
  if (year == null) throw badRequest('Enter the year your business was established.');

  if (!body.accepted_terms) {
    throw badRequest('Please confirm you are authorised to register this organisation.');
  }

  return {
    company_name: companyName,
    proposed_slug: slug,
    email_domain: emailDomain(contactEmail),
    website: website || null,
    udyam_number: udyam || null,
    gstin: gstin || null,
    pan: pan || null,
    cin: cin || null,
    entity_type: entityType || null,
    enterprise_category: category || null,
    sector: str(body.sector).slice(0, 100) || null,
    nic_code: nic || null,
    employee_count: employeeCount,
    annual_turnover_band: turnover || null,
    year_established: year,
    address_line: str(body.address_line).slice(0, 255) || null,
    city: str(body.city).slice(0, 100) || null,
    state: str(body.state).slice(0, 100) || null,
    pincode: pincode || null,
    country: str(body.country).slice(0, 80) || 'India',
    contact_name: contactName,
    contact_designation: str(body.contact_designation).slice(0, 120) || null,
    contact_email: contactEmail,
    contact_phone: phone,
    accepted_terms: 1,
  };
}

/** Tell IFQM that somebody has applied. */
export async function notifyPlatformOfApplication(reg, reference, registrationId = null) {
  const { sendViaPlatform } = await import('./mailerService.js');
  const master = masterDb();

  const recipients = new Map();
  try {
    const [admins] = await master.query('SELECT name, email FROM platform_admins');
    for (const a of admins) {
      if (a.email) recipients.set(String(a.email).toLowerCase(), a.name || 'IFQM');
    }
  } catch (e) {
    logger.warn('registration notice: could not read platform admins', e.message);
  }
  try {
    const [[row] = []] = await master.execute(
      "SELECT value FROM platform_settings WHERE key_name = 'billing_contact_email' LIMIT 1"
    );
    const billing = str(row && row.value).toLowerCase();
    if (billing && !recipients.has(billing)) recipients.set(billing, 'IFQM');
  } catch { /* optional */ }

  if (!recipients.size) {
    logger.warn(`registration notice: ${reference} has no platform recipient configured`);
    return { recipients: 0, sent: 0 };
  }

  const esc = (v) => String(v == null ? '' : v).replace(/[<>&]/g, '');
  const line = (label, value) => (value
    ? `<tr><td style="padding:4px 14px 4px 0;color:#667089">${label}</td>`
      + `<td style="padding:4px 0;color:#111"><b>${esc(value)}</b></td></tr>`
    : '');

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">
  <p style="margin:0 0 4px"><b>${esc(reg.company_name)}</b> has applied for a workspace.</p>
  <p style="margin:0 0 14px;color:#667089">Reference ${esc(reference)} - waiting in the registration queue.</p>
  <table style="border-collapse:collapse;font-size:14px">
    ${line('Contact', reg.contact_name)}
    ${line('Designation', reg.contact_designation)}
    ${line('Email', reg.contact_email)}
    ${line('Phone', reg.contact_phone)}
    ${line('Email domain', reg.email_domain)}
    ${line('Requested code', reg.proposed_slug)}
    ${line('Sector', reg.sector)}
    ${line('Employees', reg.employee_count)}
    ${line('Location', [reg.city, reg.state].filter(Boolean).join(', '))}
  </table>
  <p style="margin:16px 0 0">Both the email address and the mobile number were verified by
  one-time code before this was submitted.</p>
  <p style="margin:14px 0 0;color:#667089">Open the platform console to approve or reject it.</p>
</div>`;

  const subject = `New workspace application - ${reg.company_name} (${reference})`;
  const results = await Promise.allSettled(
    [...recipients].map(([email, name]) => sendViaPlatform(email, name, subject, html))
  );
  const sent = results.filter((r) => r.status === 'fulfilled' && r.value && r.value.success !== false).length;

  // Stamped only when somebody actually accepted the message.
  if (sent && registrationId) {
    try {
      await master.execute(
        'UPDATE tenant_registrations SET notified_at = NOW() WHERE id = ? AND notified_at IS NULL',
        [registrationId]
      );
    } catch (e) {
      logger.warn(`registration notice: ${reference} sent but not stamped - ${e.message}`);
    }
  }

  if (sent) logger.info(`registration notice: ${reference} sent to ${sent} platform recipient(s)`);
  else logger.error(`registration notice: ${reference} reached nobody - will retry hourly`);
  // Returned rather than only logged so the recipient selection can be asserted on without a
  // mail server: who it goes to is the part worth testing, and it is decided entirely before
  // anything is sent.
  return { recipients: recipients.size, sent };
}

/** POST /api/registrations - public. */
export async function submitRegistration(body, meta = {}) {
  const row = validateApplication(body);
  const master = masterDb();

  // The provider rule, applied again at the door that actually creates the row.
  const policy = await checkCorporateEmail(row.contact_email);
  if (!policy.ok) throw badRequest(policy.reason);

  // Both the address and the number must have been proved, in the last half hour, by a code
  // this server issued and consumed.
  const [emailOk, phoneOk] = await Promise.all([
    verification.wasVerified(row.contact_email, 'registration_verify'),
    verification.wasVerified(row.contact_phone, 'registration_phone'),
  ]);
  if (!emailOk || !phoneOk) {
    const what = !emailOk && !phoneOk ? 'email address and mobile number'
      : !emailOk ? 'email address' : 'mobile number';
    throw badRequest(`Please verify your ${what} with the code we send before submitting.`);
  }

  // Already a live tenant on this domain, or an application in flight? Answer the applicant
  // identically either way and let the reviewer see the clash.
  const [pending] = await master.execute(
    `SELECT id FROM tenant_registrations
      WHERE status = 'pending' AND (contact_email = ? OR email_domain = ?) LIMIT 1`,
    [row.contact_email, row.email_domain]
  );
  if (pending.length) {
    return {
      success: true,
      status: 'pending',
      reference: `REG-${pending[0].id}`,
      message: 'An application for your organisation is already under review.',
    };
  }

  const [res] = await master.execute(
    `INSERT INTO tenant_registrations
       (company_name, proposed_slug, email_domain, website, udyam_number, gstin, pan, cin,
        entity_type, enterprise_category, sector, nic_code, employee_count,
        annual_turnover_band, year_established, address_line, city, state, pincode, country,
        contact_name, contact_designation, contact_email, contact_phone, accepted_terms, submitted_ip,
        contact_email_verified, contact_phone_verified)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1)`,
    [
      row.company_name, row.proposed_slug, row.email_domain, row.website, row.udyam_number,
      row.gstin, row.pan, row.cin, row.entity_type, row.enterprise_category, row.sector,
      row.nic_code, row.employee_count, row.annual_turnover_band, row.year_established,
      row.address_line, row.city, row.state, row.pincode, row.country,
      row.contact_name, row.contact_designation, row.contact_email, row.contact_phone,
      row.accepted_terms, str(meta.ip).slice(0, 45) || null,
    ]
  );

  const reference = `REG-${res.insertId}`;
  logger.info(`registration: ${row.company_name} (${row.email_domain}) queued as ${reference}`);

  // Deliberately not awaited. The application is committed; the applicant should not wait on
  // our outbound mail server to be told so.
  notifyPlatformOfApplication(row, reference, res.insertId).catch((e) =>
    logger.error(`registration notice: ${reference} failed - ${e.message}`));

  return {
    success: true,
    status: 'pending',
    reference,
    message: 'Application received. We will email you once it has been reviewed.',
  };
}

/** Try again for applications the platform was never told about. */
export async function retryUnsentRegistrationNotices() {
  const master = masterDb();
  let rows = [];
  try {
    [rows] = await master.query(
      `SELECT * FROM tenant_registrations
        WHERE notified_at IS NULL
          AND status = 'pending'
          AND created_at > DATE_SUB(NOW(), INTERVAL 14 DAY)
        ORDER BY created_at ASC
        LIMIT 10`
    );
  } catch (e) {
    // A registry without migration 040 has no such column. Nothing to do, and certainly
    // nothing worth failing the scheduler over.
    logger.warn(`registration notice retry: skipped - ${e.message}`);
    return { checked: 0, sent: 0 };
  }
  if (!rows.length) return { checked: 0, sent: 0 };

  let sent = 0;
  for (const reg of rows) {
    try {
      const r = await notifyPlatformOfApplication(reg, `REG-${reg.id}`, reg.id);
      if (r.sent) sent += 1;
    } catch (e) {
      logger.warn(`registration notice retry: REG-${reg.id} failed again - ${e.message}`);
    }
  }
  if (sent) logger.info(`registration notice retry: ${sent} of ${rows.length} delivered`);
  return { checked: rows.length, sent };
}

/** GET /api/platform/registrations - platform admin. */
// Platform-admin only. Small enough to return whole: an operator who has hundreds of these
// has a policy problem rather than a paging problem, and seeing all of them at once is the
// point - the list is meant to be reviewed.

/** Classify an entry as one address or a whole provider, or reject it. */
export function parseWhitelistEntry(raw) {
  const v = str(raw).toLowerCase().replace(/^@/, '');
  if (!v) return { ok: false, reason: 'Enter an email address or a domain.' };

  if (v.includes('@')) {
    if (!EMAIL_RE.test(v)) return { ok: false, reason: 'That is not a valid email address.' };
    // Checked before the provider test below, or a throwaway address would be turned away with
    // the wrong reason ("that is a company domain").
    if (DISPOSABLE_EMAIL_DOMAINS.has(emailDomain(v))) {
      return {
        ok: false,
        reason: 'Throwaway mailbox addresses cannot be allowed. '
          + 'An approved workspace whose only contact address is designed to stop existing helps nobody.',
      };
    }
    // A company address may be added, and the list says so.
    return {
      ok: true,
      entry: v,
      entry_type: 'address',
      redundant: !FREE_EMAIL_DOMAINS.has(emailDomain(v)),
    };
  }

  const labels = v.split('.');
  if (labels.length < 2 || labels.some((l) => !l) || /\s/.test(v)) {
    return { ok: false, reason: 'That is not a valid domain.' };
  }
  if (DISPOSABLE_EMAIL_DOMAINS.has(v)) {
    return {
      ok: false,
      reason: 'Throwaway mailbox providers cannot be allowed. '
        + 'An approved workspace whose only contact address is designed to stop existing helps nobody.',
    };
  }
  // Same as above: any domain may be recorded, and a domain that was never blocked is
  // flagged as redundant rather than rejected.
  return { ok: true, entry: v, entry_type: 'domain', redundant: !FREE_EMAIL_DOMAINS.has(v) };
}

export async function listWhitelist() {
  const [rows] = await masterDb().query(
    'SELECT id, entry, entry_type, note, created_by, created_at FROM email_whitelist ORDER BY created_at DESC'
  );
  return { success: true, entries: rows };
}

export async function addWhitelistEntry({ entry, note = '' } = {}, actor = null) {
  const parsed = parseWhitelistEntry(entry);
  if (!parsed.ok) throw badRequest(parsed.reason);

  try {
    await masterDb().execute(
      `INSERT INTO email_whitelist (entry, entry_type, note, created_by)
            VALUES (?, ?, ?, ?)`,
      [parsed.entry, parsed.entry_type, str(note).slice(0, 255) || null,
        str(actor?.email || actor?.name).slice(0, 150) || null]
    );
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      throw new ApiError(409, `${parsed.entry} is already on the list.`);
    }
    throw err;
  }
  logger.info(`registrations: allowed ${parsed.entry_type} "${parsed.entry}" past the corporate-email rule`);
  return {
    success: true,
    entry: parsed.entry,
    entry_type: parsed.entry_type,
    // The entry was accepted, but it grants nothing that was not already permitted.
    redundant: !!parsed.redundant,
  };
}

export async function removeWhitelistEntry(id) {
  const n = Number(id) || 0;
  const [res] = await masterDb().execute('DELETE FROM email_whitelist WHERE id = ?', [n]);
  if (!res.affectedRows) throw notFound('That entry is no longer on the list.');
  return { success: true };
}

export async function listRegistrations({ status = '' } = {}) {
  const master = masterDb();
  const where = ['pending', 'approved', 'rejected'].includes(status) ? 'WHERE r.status = ?' : '';
  const params = where ? [status] : [];

  const [rows] = await master.query(
    `SELECT r.*, t.slug AS tenant_slug
       FROM tenant_registrations r
       LEFT JOIN tenants t ON t.id = r.tenant_id
      ${where}
      ORDER BY r.status = 'pending' DESC, r.created_at DESC
      LIMIT 200`,
    params
  );

  const [[counts]] = await master.query(
    `SELECT SUM(status='pending')  AS pending,
            SUM(status='approved') AS approved,
            SUM(status='rejected') AS rejected
       FROM tenant_registrations`
  );

  return {
    success: true,
    registrations: rows,
    counts: {
      pending: Number(counts?.pending || 0),
      approved: Number(counts?.approved || 0),
      rejected: Number(counts?.rejected || 0),
    },
  };
}

async function requireRegistration(id) {
  const [rows] = await masterDb().execute(
    'SELECT * FROM tenant_registrations WHERE id = ? LIMIT 1',
    [Number(id) || 0]
  );
  if (!rows[0]) throw notFound('Registration not found.');
  return rows[0];
}

/** Provisions the tenant and hands back a one-time admin password. */
export async function approveRegistration(id, {
  adminId = null, adminName = null, slug: slugOverride = '',
  planId = null, trialDays = null, billingNote = '',
} = {}) {
  const reg = await requireRegistration(id);
  if (reg.status !== 'pending') {
    throw new ApiError(409, `This application has already been ${reg.status}.`);
  }

  const slug = normaliseSlug(slugOverride || reg.proposed_slug);
  if (slug.length < 2 || slug.length > 30) {
    throw badRequest('Organisation code must be 2-30 characters.');
  }

  const master = masterDb();
  const [dup] = await master.execute('SELECT id FROM tenants WHERE slug = ? LIMIT 1', [slug]);
  if (dup.length) {
    throw new ApiError(409, `Organisation code "${slug}" is taken. Approve with a different code.`);
  }

  // A temporary password the operator relays; 24 base64url chars comfortably clears the
  // strength check createTenant applies.
  const { randomBytes } = await import('node:crypto');
  const tempPassword = randomBytes(18).toString('base64url');

  const created = await createTenant({
    org_name: reg.company_name,
    slug,
    admin_name: reg.contact_name,
    admin_email: reg.contact_email,
    admin_password: tempPassword,
  });

  // Put the new organisation on a plan straight away.
  const days = trialDays === null || trialDays === undefined || trialDays === ''
    ? await defaultTrialDays()
    : Math.max(0, Math.min(365, parseInt(trialDays, 10) || 0));

  // Every approved organisation starts on the trial plan.
  let effectivePlanId = planId;
  if (!effectivePlanId) {
    const trialPlan = await defaultTrialPlan();
    effectivePlanId = trialPlan?.id || null;
    if (!trialPlan) {
      logger.warn(`registration ${reg.id}: no trial plan on file - organisation starts unpriced`);
    }
  }

  if (effectivePlanId) {
    try {
      const [[chosen]] = await master.execute(
        'SELECT tier FROM plans WHERE id = ? LIMIT 1', [effectivePlanId]
      );
      await assignPlan(created.tenant_id, {
        planId: effectivePlanId,
        // A paid plan starts paying; only the trial plan carries trial days.
        trialDays: chosen && chosen.tier !== 'trial' ? 0 : days,
        note: billingNote,
      }, { id: adminId, name: adminName });
    } catch (e) {
      // A billing mishap must not undo a workspace that has just been created. The organisation
      // exists and can be put on a plan from its own page.
      logger.warn(`registration ${reg.id}: plan not applied - ${e.message}`);
    }
  } else if (days > 0) {
    const endsAt = new Date(Date.now() + days * 86400000)
      .toISOString().slice(0, 19).replace('T', ' ');
    await master.execute(
      "UPDATE tenants SET billing_status = 'trial', trial_days = ?, trial_ends_at = ? WHERE id = ?",
      [days, endsAt, created.tenant_id]
    ).catch(() => {});
  }

  await master.execute(
    `UPDATE tenant_registrations
        SET status = 'approved', tenant_id = ?, reviewed_by = ?, reviewed_at = NOW(),
            assigned_plan_id = ?, assigned_trial_days = ?
      WHERE id = ?`,
    [created.tenant_id, adminId, planId || null, days, reg.id]
  );

  // The approved organisation's own domain becomes its tenant domain, so a user arriving
  // from a company link resolves to the right org without a code.
  await master.execute('UPDATE tenants SET domain = ? WHERE id = ?', [reg.email_domain, created.tenant_id]);

  logger.info(`registration REG-${reg.id} approved → tenant ${slug} (${created.tenant_id})`);

  // Awaited, unlike the application notice earlier in this file, because the answer changes
  // what the console tells the operator to do next: hand the password over themselves, or
  // not.
  const { sendTemporaryPassword } = await import('./mailerService.js');
  const emailed = await sendTemporaryPassword({
    email: reg.contact_email, name: reg.contact_name, orgName: reg.company_name,
    slug, password: tempPassword, reason: 'welcome',
  });

  return {
    success: true,
    tenant_id: created.tenant_id,
    slug,
    admin_email: reg.contact_email,
    // Still returned even when the email went.
    temp_password: tempPassword,
    password_emailed: emailed,
    message: emailed
      ? `Organisation created. The temporary password has been emailed to ${reg.contact_email}.`
      : 'Organisation created, but the welcome email could not be sent - share the '
        + 'temporary password with the applicant yourself. It is shown once.',
  };
}

/** POST /api/platform/registrations/:id/reject */
export async function rejectRegistration(id, { adminId = null, note = '' } = {}) {
  const reg = await requireRegistration(id);
  if (reg.status !== 'pending') {
    throw new ApiError(409, `This application has already been ${reg.status}.`);
  }
  await masterDb().execute(
    `UPDATE tenant_registrations
        SET status = 'rejected', review_note = ?, reviewed_by = ?, reviewed_at = NOW()
      WHERE id = ?`,
    [str(note).slice(0, 2000) || null, adminId, reg.id]
  );
  logger.info(`registration REG-${reg.id} rejected`);
  return { success: true, message: 'Application rejected.' };
}

export default {
  submitRegistration, listRegistrations, approveRegistration, rejectRegistration,
  checkCorporateEmail, checkEmailShape, isAllowedFreeEmail, emailDomain,
  listWhitelist, addWhitelistEntry, removeWhitelistEntry, parseWhitelistEntry,
};

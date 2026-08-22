/**
 * MSME self-registration.
 *
 * An organisation applies for itself; a platform admin approves; only then is a
 * tenant database provisioned. Nothing an anonymous caller does here touches a
 * tenant schema — the worst a flood of junk applications can do is fill a
 * review queue, which is why this file is heavy on validation and light on
 * side effects.
 *
 * The corporate-domain rule is the one deliberate piece of friction: an
 * ideation platform is sold to a company, not to a person, and a free-mail
 * address gives no evidence the applicant speaks for the business. It is a
 * filter for accident and casual abuse, not a security control — anyone
 * determined can register a domain — so it sits alongside human approval
 * rather than replacing it.
 */
import { masterDb } from '../database/master.js';
import { ApiError, badRequest, notFound } from '../utils/respond.js';
import { assignPlan, defaultTrialDays } from './subscriptionService.js';
import { defaultTrialPlan } from './planService.js';
import logger from '../utils/logger.js';
import { createTenant } from './platformService.js';
import bcrypt from 'bcryptjs';
import * as verification from './verificationService.js';

/*
 * ── Proving the applicant owns the address and the number ──────────────────
 *
 * Both are delegated to verificationService, the same machinery the rest of the
 * product uses for one-time codes. What was here before did its own thing and
 * got three parts of it wrong: the code came from Math.random(), which is
 * predictable from previous output; wrong guesses were never counted, so six
 * digits could be walked at network speed; and the row it wrote used a purpose
 * value the column could not store, so every request answered 500 — email
 * verification at sign-up had never once worked.
 *
 * announce: true — unlike sign-in, these report honestly whether the code went
 * out. The applicant is typing their own address into a form they are filling
 * in and already knows whether they own it, so there is nothing to disclose;
 * and a form that cannot say "that did not send" leaves somebody waiting for a
 * code that is never coming.
 */
export async function sendRegistrationEmailOtp(email, meta = {}) {
  const check = checkCorporateEmail(String(email || '').trim().toLowerCase());
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

/* Consumer mailbox providers. A company applying from one of these is either a
   sole trader using personal email (ask them to use a domain) or noise. */
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk', 'ymail.com',
  'rocketmail.com', 'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'outlook.in', 'live.com',
  'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'proton.me',
  'pm.me', 'gmx.com', 'gmx.net', 'yandex.com', 'yandex.ru', 'mail.com', 'mail.ru',
  'zoho.com', 'zohomail.com', 'rediffmail.com', 'rediff.com', 'indiatimes.com',
  'sify.com', 'in.com', 'inbox.com', 'fastmail.com', 'hushmail.com', 'tutanota.com',
  'tuta.io', 'qq.com', '163.com', '126.com', 'naver.com', 'daum.net',
]);

/* Throwaway-mailbox services. Same intent as above: keep the queue reviewable. */
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
/* Statutory identifier formats. Each is checked only when supplied — an MSME
   below the GST threshold genuinely has no GSTIN, and rejecting the form over a
   field the applicant cannot fill would be a bug, not diligence. */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
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

/**
 * Has a platform admin allowed this address, or its whole provider, through the
 * corporate-email rule?
 *
 * Two shapes of entry, checked in that order of specificity: the exact address,
 * then the bare domain. Allowing 'ravi@gmail.com' lets one person apply;
 * allowing 'gmail.com' reopens the provider for everybody.
 *
 * A registry that cannot be read answers "not allowed". That is the safe way
 * round: the failure then shows up as an applicant being told to use a work
 * address, which is visible and recoverable, rather than as the rule silently
 * switching itself off for everyone.
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

/**
 * Is this a corporate address we will accept an application from?
 *
 * ── Why the free-provider rule is enforced at all ──────────────────────────
 *
 * FREE_EMAIL_DOMAINS has sat above since this file was written, with a comment
 * explaining exactly why a company applying from Gmail is either a sole trader
 * on personal email or noise — and nothing consulted it. Only disposable
 * mailboxes were refused.
 *
 * It matters more now than it did. Udyam, GSTIN, PAN and CIN came off the
 * registration form, and those numbers were how a reviewer checked an applicant
 * against the public registers. With them gone the work email domain is the
 * strongest remaining signal that an application comes from a real business.
 *
 * ── And why it is not enforced alone ───────────────────────────────────────
 *
 * A genuine two-person engineering firm very often has no domain at all. A rule
 * meant to filter noise would quietly exclude the customer, so the exception
 * ships with it: a platform admin can allow one address, or a whole provider,
 * without a deployment.
 *
 * @returns {Promise<{ ok: boolean, reason?: string, allowed_by_exception?: boolean }>}
 */
/**
 * The half of the rule that needs no database: is this a well-formed address on
 * a domain we would never accept whatever anybody says?
 *
 * Split out so validateApplication() can stay synchronous and pure. The
 * provider rule needs the registry, and threading a database read through a
 * validator that is otherwise a function of its argument would make every
 * caller — and every test — carry a connection to ask whether a string looks
 * like an email.
 */
export function checkEmailShape(email) {
  const e = str(email).toLowerCase();
  if (!EMAIL_RE.test(e)) return { ok: false, reason: 'Enter a valid email address.' };

  const domain = emailDomain(e);
  if (!domain || !domain.includes('.')) {
    return { ok: false, reason: 'Enter a valid email address.' };
  }
  // A bare TLD or a single-label host is not a valid email domain. Checked
  // before the lists, because neither can meaningfully contain one.
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some((l) => !l)) {
    return { ok: false, reason: 'Enter a valid work email address.' };
  }
  /*
   * Disposable mailboxes are refused outright and are NOT whitelistable. A
   * throwaway address is not a small business without a domain; it is an
   * address designed to stop existing, and an approved workspace whose only
   * contact has evaporated helps nobody.
   */
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

/**
 * Validate an application and return the row to insert.
 * Throws ApiError(400) with a single, actionable message on the first problem.
 */

export function validateApplication(body) {
  const companyName = str(body.company_name);
  if (companyName.length < 2 || companyName.length > 150) {
    throw badRequest('Enter your registered company name (2–150 characters).');
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
    // Derive one from the domain's second-level label so the applicant is not
    // forced to invent an identifier they have no opinion about.
    slug = normaliseSlug(emailDomain(contactEmail).split('.')[0]);
  }
  if (slug.length < 2 || slug.length > 30) {
    throw badRequest('Organisation code must be 2–30 characters (letters, numbers, - and _).');
  }

  /*
   * A mobile number is required, not optional.
   *
   * It is what the SMS code is sent to, at registration and at every later
   * point where the account has to be proved — password reset above all. An
   * account with no number on file cannot use any of it, and the gap only
   * shows up on the day somebody is locked out.
   */
  const phone = str(body.contact_phone);
  if (!phone) throw badRequest('Enter the contact mobile number.');
  if (!PHONE_RE.test(phone)) throw badRequest('Enter a valid contact phone number.');
  if (phone.replace(/\D/g, '').length < 10) {
    throw badRequest('Enter a full mobile number, including the area or country code.');
  }

  const gstin = upper(body.gstin);
  if (gstin && !GSTIN_RE.test(gstin)) {
    throw badRequest('GSTIN does not look valid. It is 15 characters, e.g. 29ABCDE1234F1Z5.');
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
  if (nic && !/^[0-9]{2,5}$/.test(nic)) throw badRequest('NIC code is 2–5 digits.');

  const website = str(body.website);
  if (website && !/^https?:\/\/\S+\.\S+/.test(website)) {
    throw badRequest('Website must start with http:// or https://');
  }

  const designation = str(body.contact_designation);
  const addressLine = str(body.address_line);
  const city = str(body.city);
  const stateName = str(body.state);
  const country = str(body.country) || 'India';

  /*
   * Everything above validates the FORM of a value if one was supplied. This
   * block is about whether it was supplied at all.
   *
   * ── The statutory identifiers are no longer asked for ──────────────────────
   *
   * Udyam, GSTIN, PAN, CIN and the website used to be required here, and the
   * form collected them on its own step. They are no longer on the form, so
   * requiring them would refuse every application the product now sends.
   *
   * The COLUMNS are deliberately kept, and so is the format checking above:
   * every application already submitted keeps its numbers, the platform screens
   * go on showing them, and anything supplied by an older client or a future
   * step is still stored and still validated. What changed is that an absent
   * value is now an absent value rather than a rejection.
   */
  /*
   * MOM 29 Jul 2026 §13 sets this list, and it is deliberately shorter than it
   * was.
   *
   * MANDATORY — who the business is, provably, plus the two statutory numbers a
   * reviewer checks against the public registers. GSTIN and PAN came off the
   * form for a while when the whole statutory step was removed; §13 puts them
   * back, and they are the reason the domain rule is not the only check on
   * whether an applicant is a real company.
   *
   * OPTIONAL — everything §13 calls "other details": designation, NIC code,
   * turnover band, and the whole registered address. None of them decides
   * whether an application can be assessed, and each one is another field
   * between somebody deciding to try the product and actually doing so. They
   * are still validated when supplied and still stored.
   *
   * Udyam and CIN stay off the form entirely: §13 does not ask for them, a
   * proprietorship never has a CIN, and an MSME below the threshold has no
   * Udyam registration to give.
   */
  const required = [
    [companyName, 'registered company name'],
    [phone, 'contact phone number'],
    [gstin, 'GSTIN'],
    [pan, 'business PAN'],
    [entityType, 'entity type'],
    [category, 'MSME category'],
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

/**
 * Tell IFQM that somebody has applied.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * An application landed in a queue that nobody is looking at. The applicant is
 * told "we will email you once it has been reviewed", and until somebody
 * happened to open the console that was a promise with no mechanism behind it.
 * The first working day of a customer's relationship with the product was
 * silence of unknown length.
 *
 * ── Who it goes to ─────────────────────────────────────────────────────────
 *
 * Every platform admin, because "the person who checks registrations" is not a
 * role the schema knows about — anybody with console access may be the one who
 * acts. The billing contact is included when one is configured, since that is
 * the address IFQM already publishes for commercial questions.
 *
 * ── Why it can never fail the submission ───────────────────────────────────
 *
 * The whole thing is wrapped and swallowed. An applicant who filled in a long
 * form, verified an address and verified a phone must not be told their
 * application failed because OUR notification could not be delivered — the row
 * is already committed and the queue is the source of truth. A failure is
 * logged loudly instead, because a notification that silently stopped working
 * is exactly the thing nobody notices.
 */
export async function notifyPlatformOfApplication(reg, reference) {
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
  <p style="margin:0 0 14px;color:#667089">Reference ${esc(reference)} — waiting in the registration queue.</p>
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

  const subject = `New workspace application — ${reg.company_name} (${reference})`;
  const results = await Promise.allSettled(
    [...recipients].map(([email, name]) => sendViaPlatform(email, name, subject, html))
  );
  const sent = results.filter((r) => r.status === 'fulfilled' && r.value && r.value.success !== false).length;
  if (sent) logger.info(`registration notice: ${reference} sent to ${sent} platform recipient(s)`);
  else logger.error(`registration notice: ${reference} reached nobody — check platform mail`);
  // Returned rather than only logged so the recipient selection can be asserted
  // on without a mail server: who it goes to is the part worth testing, and it
  // is decided entirely before anything is sent.
  return { recipients: recipients.size, sent };
}

/**
 * POST /api/registrations — public.
 *
 * Returns only a reference number. It deliberately does NOT say whether the
 * domain was already known: "this company already has an account" told to an
 * anonymous caller is a free customer-list lookup.
 */
export async function submitRegistration(body, meta = {}) {
  const row = validateApplication(body);
  const master = masterDb();

  /*
   * The provider rule, applied again at the door that actually creates the row.
   *
   * In practice an application cannot reach here from a blocked provider — the
   * address must carry a consumed one-time code, and the only thing that issues
   * one is sendRegistrationEmailOtp, which applies the same rule. This is not
   * relying on that. The two doors are separate code paths that can be changed
   * independently, and the cost of checking twice is one indexed lookup against
   * the cost of an unnoticed hole in the only check on who may apply.
   */
  const policy = await checkCorporateEmail(row.contact_email);
  if (!policy.ok) throw badRequest(policy.reason);

  /*
   * Both the address and the number must have been proved, in the last half
   * hour, by a code this server issued and consumed.
   *
   * Checked HERE rather than trusted from the form. The browser knows it
   * verified them, but the browser is not what we are asking — anyone can post
   * this endpoint directly with verified: true in the body, and a claim about a
   * check is not the check. The two lookups read the consumed code rows, which
   * only exist if the codes actually came back.
   */
  const [emailOk, phoneOk] = await Promise.all([
    verification.wasVerified(row.contact_email, 'registration_verify'),
    verification.wasVerified(row.contact_phone, 'registration_phone'),
  ]);
  if (!emailOk || !phoneOk) {
    const what = !emailOk && !phoneOk ? 'email address and mobile number'
      : !emailOk ? 'email address' : 'mobile number';
    throw badRequest(`Please verify your ${what} with the code we send before submitting.`);
  }

  // Already a live tenant on this domain, or an application in flight? Answer
  // the applicant identically either way and let the reviewer see the clash.
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

  // Deliberately not awaited. The application is committed; the applicant
  // should not wait on our outbound mail server to be told so.
  notifyPlatformOfApplication(row, reference).catch((e) =>
    logger.error(`registration notice: ${reference} failed — ${e.message}`));

  return {
    success: true,
    status: 'pending',
    reference,
    message: 'Application received. We will email you once it has been reviewed.',
  };
}

/** GET /api/platform/registrations — platform admin. */
/* ── The corporate-email exception list ──────────────────────────────────────
 *
 * Platform-admin only. Small enough to return whole: an operator who has
 * hundreds of these has a policy problem rather than a paging problem, and
 * seeing all of them at once is the point — the list is meant to be reviewed.
 */

/** Classify an entry as one address or a whole provider, or reject it. */
export function parseWhitelistEntry(raw) {
  const v = str(raw).toLowerCase().replace(/^@/, '');
  if (!v) return { ok: false, reason: 'Enter an email address or a domain.' };

  if (v.includes('@')) {
    if (!EMAIL_RE.test(v)) return { ok: false, reason: 'That is not a valid email address.' };
    // Checked before the provider test below, or a throwaway address would be
    // turned away with the wrong reason ("that is a company domain").
    if (DISPOSABLE_EMAIL_DOMAINS.has(emailDomain(v))) {
      return {
        ok: false,
        reason: 'Throwaway mailbox addresses cannot be allowed. '
          + 'An approved workspace whose only contact address is designed to stop existing helps nobody.',
      };
    }
    /*
     * Allowing a corporate address is a no-op that reads as an action, which is
     * worse than an error: somebody adds 'ravi@acme.com', sees it in the list,
     * and believes they have granted something. acme.com was never blocked.
     */
    if (!FREE_EMAIL_DOMAINS.has(emailDomain(v))) {
      return {
        ok: false,
        reason: `${emailDomain(v)} is a company domain — applications from it are already accepted. `
          + 'This list is only for personal-mailbox providers such as gmail.com.',
      };
    }
    return { ok: true, entry: v, entry_type: 'address' };
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
  if (!FREE_EMAIL_DOMAINS.has(v)) {
    return {
      ok: false,
      reason: `${v} is not a blocked provider — applications from it are already accepted.`,
    };
  }
  return { ok: true, entry: v, entry_type: 'domain' };
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
  return { success: true, entry: parsed.entry, entry_type: parsed.entry_type };
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

/**
 * POST /api/platform/registrations/:id/approve
 *
 * Provisions the tenant and hands back a one-time admin password. The password
 * is generated here rather than chosen by the applicant: at this point they
 * have not proved control of the mailbox, so the credential has to travel out
 * of band, and must_change_password forces it to be replaced on first sign-in.
 */
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
    throw badRequest('Organisation code must be 2–30 characters.');
  }

  const master = masterDb();
  const [dup] = await master.execute('SELECT id FROM tenants WHERE slug = ? LIMIT 1', [slug]);
  if (dup.length) {
    throw new ApiError(409, `Organisation code "${slug}" is taken. Approve with a different code.`);
  }

  // A temporary password the operator relays; 24 base64url chars comfortably
  // clears the strength check createTenant applies.
  const { randomBytes } = await import('node:crypto');
  const tempPassword = randomBytes(18).toString('base64url');

  const created = await createTenant({
    org_name: reg.company_name,
    slug,
    admin_name: reg.contact_name,
    admin_email: reg.contact_email,
    admin_password: tempPassword,
  });

  /*
   * Put the new organisation on a plan straight away.
   *
   * This is the right moment: the approver has the company's details in front
   * of them — size, turnover, sector — which is exactly what decides which plan
   * they belong on. Leaving it until later means somebody has to remember, and
   * an organisation with no plan has no trial end date, so it would never lapse
   * and never be billed.
   *
   * If no plan is chosen, the trial still starts. A workspace nobody has priced
   * yet should be evaluating, not quietly free forever.
   */
  const days = trialDays === null || trialDays === undefined || trialDays === ''
    ? await defaultTrialDays()
    : Math.max(0, Math.min(365, parseInt(trialDays, 10) || 0));

  /*
   * Every approved organisation starts on the trial plan.
   *
   * The approver may still pick one, but leaving the box alone no longer leaves
   * the organisation unpriced. That was the previous behaviour and it produced
   * workspaces with no plan at all - which meant no trial end date, so they
   * never lapsed, were never billed, and stayed free until somebody happened to
   * notice. The billing screen showed them as "None set".
   *
   * A paid plan cannot carry a trial (see assignPlan), so a chosen paid plan is
   * applied with no trial and starts its period immediately; that is a
   * deliberate approval of a paying customer, not an evaluation.
   */
  let effectivePlanId = planId;
  if (!effectivePlanId) {
    const trialPlan = await defaultTrialPlan();
    effectivePlanId = trialPlan?.id || null;
    if (!trialPlan) {
      logger.warn(`registration ${reg.id}: no trial plan on file — organisation starts unpriced`);
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
      // A billing mishap must not undo a workspace that has just been created.
      // The organisation exists and can be put on a plan from its own page.
      logger.warn(`registration ${reg.id}: plan not applied — ${e.message}`);
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

  // The approved organisation's own domain becomes its tenant domain, so a user
  // arriving from a company link resolves to the right org without a code.
  await master.execute('UPDATE tenants SET domain = ? WHERE id = ?', [reg.email_domain, created.tenant_id]);

  logger.info(`registration REG-${reg.id} approved → tenant ${slug} (${created.tenant_id})`);

  /*
   * Awaited, unlike the application notice earlier in this file, because the
   * answer changes what the console tells the operator to do next: hand the
   * password over themselves, or not.
   */
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
    // Still returned even when the email went. Mail fails, and an operator
    // holding the only copy of a credential is the difference between
    // "resend it" and "provision the whole thing again".
    temp_password: tempPassword,
    password_emailed: emailed,
    message: emailed
      ? `Organisation created. The temporary password has been emailed to ${reg.contact_email}.`
      : 'Organisation created, but the welcome email could not be sent — share the '
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

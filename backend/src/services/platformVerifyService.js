/**
 * A platform admin proving they hold the address and the number on the account.
 *
 * ── Why this account and not the others ────────────────────────────────────
 *
 * A platform admin reaches every tenant on the platform — every organisation's
 * people, their ideas, their billing and their support history. It is the widest
 * credential the product issues, and until now it was created by typing a name,
 * an address and a password into a form. Nothing checked that the address
 * existed, that anybody read it, or that the number belonged to the person being
 * handed the keys. A typo in the email field produced a fully working account
 * whose intended owner could never receive a password reset — and the account
 * still worked, for whoever did receive the mail.
 *
 * ── Both channels, not either ──────────────────────────────────────────────
 *
 * Two separate purposes rather than one that accepts whichever arrives first.
 * The property being established is that the account is reachable on two
 * independent channels: an address alone can be taken by whoever holds that
 * mailbox, and a number alone leaves nobody to send a reset to. Letting one
 * stand in for the other would collect a proof and call the job done.
 *
 * ── When the codes are sent ────────────────────────────────────────────────
 *
 * At first sign-in, not at creation. The person being given the account is not
 * at the keyboard when it is made — somebody else is making it for them — so
 * codes sent then would sit unread in a mailbox and a handset until they
 * expired, and the account would look broken on the one screen it is allowed to
 * reach. Asking for them when the right person is present is both safer and the
 * only version that works.
 */
import { masterDb } from '../database/master.js';
import * as verification from './verificationService.js';
import { badRequest, notFound } from '../utils/respond.js';
import logger from '../utils/logger.js';

/** channel → the row column it proves, and the verification purpose. */
const CHANNELS = {
  email: { column: 'email_verified_at', purpose: 'platform_admin_email', field: 'email' },
  phone: { column: 'phone_verified_at', purpose: 'platform_admin_phone', field: 'phone' },
};

/** The numeric id behind a `pa_<id>` session id. */
const idOf = (actor) => Number(String(actor?.id ?? '').replace(/^pa_/, '')) || 0;

async function loadAdmin(actor) {
  const id = idOf(actor);
  if (!id) throw badRequest('Not a platform administrator session.');
  const [[row] = []] = await masterDb().execute(
    `SELECT id, name, email, phone, email_verified_at, phone_verified_at
       FROM platform_admins WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!row) throw notFound('Platform admin not found.');
  return row;
}

/** What still has to be proved, and where each code would go. */
function stateOf(row) {
  const pending = [];
  if (!row.email_verified_at) pending.push('email');
  if (!row.phone_verified_at) pending.push('phone');
  return {
    email_verified: !!row.email_verified_at,
    phone_verified: !!row.phone_verified_at,
    pending,
    verified: pending.length === 0,
  };
}

export async function status(actor) {
  const row = await loadAdmin(actor);
  return { success: true, ...stateOf(row), email: row.email, phone: row.phone };
}

/**
 * Send a code to one of the two channels.
 *
 * The destination comes from the ROW, never from the request. Taking it from
 * the caller would turn this into a way to point an unverified account at an
 * address or a handset of the caller's choosing and then verify it — which is
 * the whole thing being prevented, wearing the flow's own clothes.
 */
export async function sendCode(actor, body = {}) {
  const channel = String(body.channel ?? '').trim().toLowerCase();
  const spec = CHANNELS[channel];
  if (!spec) throw badRequest('Choose email or phone.');

  const row = await loadAdmin(actor);
  if (row[spec.column]) {
    // Already proved. Not an error — a double-click on Send should not read as
    // a failure — but no second code goes out.
    return { success: true, already_verified: true, ...stateOf(row) };
  }

  const destination = row[spec.field];
  if (!destination) {
    throw badRequest(channel === 'phone'
      ? 'This account has no mobile number on file. Ask another platform administrator to add one.'
      : 'This account has no email address on file.');
  }

  const sent = await verification.sendCode({
    identifier: destination,
    purpose: spec.purpose,
    name: row.name,
  });
  logger.info(`platform verify: ${channel} code sent for admin #${row.id}`);
  return { success: true, channel, ...sent, ...stateOf(row) };
}

/**
 * Accept a code and record the proof.
 *
 * The timestamp is written only after verifyCode has consumed the code, so a
 * wrong guess cannot mark anything verified, and a replayed code cannot either
 * — verificationService marks it consumed.
 */
export async function confirmCode(actor, body = {}) {
  const channel = String(body.channel ?? '').trim().toLowerCase();
  const spec = CHANNELS[channel];
  if (!spec) throw badRequest('Choose email or phone.');

  const row = await loadAdmin(actor);
  if (row[spec.column]) return { success: true, already_verified: true, ...stateOf(row) };

  const destination = row[spec.field];
  if (!destination) throw badRequest('Nothing to verify on that channel.');

  await verification.verifyCode({
    identifier: destination,
    code: body.code,
    purpose: spec.purpose,
  });

  await masterDb().execute(
    `UPDATE platform_admins SET ${spec.column} = NOW() WHERE id = ?`,
    [row.id]
  );
  logger.info(`platform verify: ${channel} confirmed for admin #${row.id} (${row.email})`);

  const after = await loadAdmin(actor);
  const state = stateOf(after);
  if (state.verified) {
    logger.info(`platform verify: admin #${after.id} (${after.email}) is fully verified`);
  }
  return { success: true, channel, ...state };
}

export default { status, sendCode, confirmCode };

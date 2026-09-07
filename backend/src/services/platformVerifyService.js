/** A platform admin proving they hold the address and the number on the account. */
import { masterDb } from '../database/master.js';
import * as verification from './verificationService.js';
import { badRequest, notFound } from '../utils/respond.js';
import logger from '../utils/logger.js';

/** channel the row column it proves, and the verification purpose. */
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

/** Send a code to one of the two channels. */
export async function sendCode(actor, body = {}) {
  const channel = String(body.channel ?? '').trim().toLowerCase();
  const spec = CHANNELS[channel];
  if (!spec) throw badRequest('Choose email or phone.');

  const row = await loadAdmin(actor);
  if (row[spec.column]) {
    // Already proved. Not an error - a double-click on Send should not read as a failure - but
    // no second code goes out.
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

/** Accept a code and record the proof. */
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

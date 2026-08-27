/**
 * The DLT-registered SMS templates, as approved by Jio for header IFQMID-T.
 *
 * ── Why the exact text lives in the code ───────────────────────────────────
 *
 * On an Indian DLT gateway the carrier checks the message body against the
 * template id sent with it. If the two disagree — by a word, by a full stop —
 * the gateway ACCEPTS the request and the carrier DROPS the message. There is
 * no error, no delivery report, and nothing to see at either end. The user just
 * never gets their code.
 *
 * That failure is invisible in every test that does not involve a real handset,
 * which is why the wording is pinned here beside the id it was approved under
 * rather than left to an environment variable somebody might reword.
 *
 * ── {#var#} and {#number#} are the same thing ──────────────────────────────
 *
 * Jio's portal shows the placeholder as {#number#}. This file writes it as
 * {#var#} because that is the token fillTemplate() substitutes. The text that
 * actually goes out — the OTP already substituted in — is what the carrier
 * matches, and it is identical either way.
 *
 * ── One variable, not two ─────────────────────────────────────────────────
 *
 * The wording that was here before said "It expires in {#var#} minute(s)" and
 * took two variables. None of the approved templates mention an expiry, so any
 * message built from the old wording would have been dropped by the carrier the
 * moment these ids went live. The expiry is still shown on screen, where it
 * costs nothing and no carrier has an opinion about it.
 */

/*
 * Registered on 26 Aug 2026. Sender header IFQMID-T, Kaleyra SID
 * HXAP1678914824IN.
 *
 *   purpose        the internal name the OTP services already use
 *   id             the DLT Content Template ID
 *   text           the approved body, verbatim
 *   registered     false means the carrier will drop it — do not send
 */
export const DLT_TEMPLATES = {
  /* 1. Registration OTP */
  registration_phone: {
    id: '1277178671564743852',
    text: 'Dear Customer, use OTP {#var#} to complete your registration on IFQM Ideation. Do not share this OTP with anyone.',
    registered: true,
    label: 'Registration OTP',
  },

  /* 2. Sign-in OTP */
  login: {
    id: '1277178730169418603',
    text: 'Dear Customer, use OTP {#var#} to complete your sign-in on IFQM Ideation. Do not share this OTP with anyone.',
    registered: true,
    label: 'Sign-in OTP',
  },

  /* 3. Password Reset OTP */
  password_reset: {
    id: '1277178730612100625',
    text: 'Dear Customer, use OTP {#var#} to reset your password on IFQM Ideation. Do not share this OTP with anyone.',
    registered: true,
    label: 'Password Reset OTP',
  },

  /*
   * 4. Mobile Number Changed — security alert.
   *
   * PENDING. Jio classified it as Service Implicit rather than Transactional
   * and it has no id yet, so `registered` is false and sendSms() refuses it.
   *
   * Refusing is the point. This alert was already being sent, under the
   * REGISTRATION template's id with completely different wording, which means
   * the carrier has been dropping it silently for as long as it has existed —
   * a security alert that never arrives is worse than one that was never
   * built, because the code and the changelog both claim it works.
   *
   * When the id arrives: paste it in and set registered to true. Nothing else
   * needs to change.
   */
  phone_changed: {
    id: '',
    text: 'Your IFQM Ideation sign-in number was changed to one ending {#var#}. If this was not you, contact your administrator.',
    registered: false,
    label: 'Mobile Number Changed — Security Alert',
    pendingReason:
      'Jio classified this as Service Implicit rather than Transactional. '
      + 'Awaiting re-submission for Transactional approval.',
  },

  /*
   * Verifying a NEW number on an existing account.
   *
   * There is no template of its own for this, so it borrows the Registration
   * one — which is deliverable, because the id and the text match, and which
   * says "complete your registration" to somebody who is changing their phone
   * number. That is confusing rather than harmful, and it is the better of the
   * two available options: the alternative is not sending, which would break
   * the change-number flow outright.
   *
   * Worth registering a fifth template for. Suggested wording, in the same
   * shape as the three that were approved:
   *
   *   Dear Customer, use OTP {#number#} to confirm your new mobile number on
   *   IFQM Ideation. Do not share this OTP with anyone.
   */
  phone_verify: {
    id: '1277178671564743852',
    text: 'Dear Customer, use OTP {#var#} to complete your registration on IFQM Ideation. Do not share this OTP with anyone.',
    registered: true,
    borrowsFrom: 'registration_phone',
    label: 'Registration OTP (borrowed for number change)',
  },
};

/** Sender header, as registered. */
export const DLT_SENDER_ID = 'IFQMID-T';

/** Kaleyra account SID — a path segment in every request, not a header. */
export const KALEYRA_SID = 'HXAP1678914824IN';

/**
 * Header validity.
 *
 * A DLT header is six characters, optionally followed by a category suffix:
 * -T transactional, -S service, -P promotional. IFQMID-T is the six-character
 * header IFQMID registered for transactional traffic.
 *
 * The check this replaces demanded exactly six characters and would have
 * rejected the header we actually hold, reporting a correctly configured
 * gateway as misconfigured.
 */
export const SENDER_ID_RE = /^[A-Za-z0-9]{6}(-[TSP])?$/i;

/** The purposes that can be delivered today, for status displays. */
export function templateStatus() {
  return Object.entries(DLT_TEMPLATES).map(([purpose, t]) => ({
    purpose,
    label: t.label,
    id: t.id,
    registered: t.registered,
    borrows_from: t.borrowsFrom || null,
    pending_reason: t.pendingReason || null,
  }));
}

export default { DLT_TEMPLATES, DLT_SENDER_ID, KALEYRA_SID, SENDER_ID_RE, templateStatus };

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
   * 5. Number Change OTP — verifying a NEW number on an existing account.
   *
   * SUBMITTED, awaiting a template id.
   *
   * Until it is granted this falls back to the Registration template, and the
   * fallback takes that template's TEXT as well as its id. Taking one without
   * the other is the mistake this whole file exists to prevent: a body and an
   * id that disagree are accepted by the gateway and dropped by the carrier.
   *
   * So today a person changing their number reads "complete your registration",
   * which is confusing but arrives. The alternative — sending nothing until the
   * id exists — would break the change-number flow outright, and unlike the
   * security alert below there is no second channel to fall back on: the whole
   * point is to prove they hold the new handset.
   *
   * When the id arrives: paste it in and set registered to true. The fallback
   * stops being consulted and the wording below goes out instead. Nothing else
   * changes.
   */
  phone_verify: {
    id: '',
    text: 'Dear Customer, use OTP {#var#} to confirm your new mobile number on IFQM Ideation. Do not share this OTP with anyone.',
    registered: false,
    fallback: 'registration_phone',
    label: 'Number Change OTP',
    pendingReason: 'Submitted to Jio DLT; awaiting a template id.',
  },
};

/**
 * What would actually be sent for a purpose, today.
 *
 * A template that is not yet registered may name a `fallback`. The fallback
 * supplies BOTH its id and its text, never one of them — the carrier's only
 * job is to check those two against each other, so borrowing half of a
 * registration produces exactly the silent drop this module exists to avoid.
 *
 * @returns {{id:string, text:string, sendable:boolean, usingFallback:string|null,
 *            label:string, pendingReason:string|null}}
 */
export function resolveTemplate(purpose) {
  const spec = DLT_TEMPLATES[purpose];
  if (!spec) return { id: '', text: '', sendable: false, usingFallback: null, label: purpose, pendingReason: null };

  if (spec.registered && spec.id) {
    return {
      id: spec.id, text: spec.text, sendable: true,
      usingFallback: null, label: spec.label, pendingReason: null,
    };
  }

  const alt = spec.fallback ? DLT_TEMPLATES[spec.fallback] : null;
  if (alt && alt.registered && alt.id) {
    return {
      id: alt.id,
      text: alt.text,           // the fallback's own wording — the matched pair
      sendable: true,
      usingFallback: spec.fallback,
      label: spec.label,
      pendingReason: spec.pendingReason || null,
    };
  }

  // Nothing deliverable. The caller must decline rather than send.
  return {
    id: '', text: spec.text, sendable: false,
    usingFallback: null, label: spec.label, pendingReason: spec.pendingReason || null,
  };
}

/**
 * The sender header, as it goes on the wire: six characters.
 *
 * ── IFQMID, not IFQMID-T ──────────────────────────────────────────────────
 *
 * The registration was handed to us as "IFQMID-T" and that string was taken
 * literally. It is not the header. An Indian DLT header is exactly six
 * characters; the "-T" is the CATEGORY annotation Jio's portal appends to show
 * the header is approved for Transactional traffic, in the same way another
 * listing might read -S for service or -P for promotional.
 *
 * Sending the annotated form is rejected outright — Kaleyra answers
 * 400 "Invalid or In-Correct sender", which is exactly what the delivery log
 * recorded for every attempt made with it.
 *
 * The failure with the OLD header was quieter and worse. IFQMSK is a valid
 * sender on the same Kaleyra account (it belongs to IFQM Skills), so the
 * gateway ACCEPTED those messages with a 202 — while the template ids being
 * sent alongside are registered against IFQMID. A template that does not
 * belong to the header it is sent under is discarded by the carrier. So the
 * log showed "accepted by gateway" and no handset ever rang.
 */
export const DLT_SENDER_ID = 'IFQMID';

/** Kaleyra account SID — a path segment in every request, not a header. */
export const KALEYRA_SID = 'HXAP1678914824IN';

/**
 * Header validity — liberal in what is accepted, strict in what is sent.
 *
 * The annotated form (IFQMID-T) is ACCEPTED here, because that is how the
 * registration is written down and how somebody copying it from an email or a
 * portal will type it into a dashboard. Rejecting it would turn a
 * transcription of the truth into a configuration error.
 *
 * It is never TRANSMITTED in that form. senderHeader() below strips the
 * category suffix, so whichever way it was entered, six characters go on the
 * wire — which is the only thing the gateway will accept.
 */
export const SENDER_ID_RE = /^[A-Za-z0-9]{6}(-[TSP])?$/i;

/**
 * The six characters to put in the `sender` field.
 *
 * Anything after the header — the -T/-S/-P category — is annotation and is
 * removed. This is the single place that decision is made, so a value entered
 * either way behaves identically.
 */
export function senderHeader(value) {
  return String(value ?? '').trim().replace(/-[TSP]$/i, '');
}

/** The purposes that can be delivered today, for status displays. */
export function templateStatus() {
  return Object.entries(DLT_TEMPLATES).map(([purpose, t]) => {
    const r = resolveTemplate(purpose);
    return {
      purpose,
      label: t.label,
      id: r.id,
      registered: t.registered && !!t.id,
      sendable: r.sendable,
      using_fallback: r.usingFallback,
      pending_reason: r.pendingReason,
    };
  });
}

export default {
  DLT_TEMPLATES, DLT_SENDER_ID, KALEYRA_SID, SENDER_ID_RE, senderHeader,
  templateStatus, resolveTemplate,
};

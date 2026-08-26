/**
 * GSTIN verification — MOM 24/08 §2.
 *
 * ── What "verification" can honestly mean here ─────────────────────────────
 *
 * The MOM asks to explore the feasibility of verifying a GSTIN at registration.
 * There are two different things that phrase can mean, and only one of them is
 * available to us today:
 *
 *   1. Live lookup against the GSTN.  Confirms the number exists, is active,
 *      and belongs to the business named on the form. It needs a GSP contract
 *      or an authorised API reseller, a paid per-call plan, credentials held
 *      server-side, and a fallback for when the service is down — which it
 *      regularly is. See docs/GSTIN_VERIFICATION.md for the feasibility note.
 *
 *   2. Structural verification.  No network, no cost, no dependency. A GSTIN
 *      is not an opaque string: it carries a checksum, a state code, and a PAN
 *      inside it, and the three have to agree with each other.
 *
 * This file is (2), which is worth doing on its own merits. The regex that was
 * here before accepted 27AAAAA0000A1Z9 — correctly shaped, and not a GSTIN.
 * The checksum rejects it, along with essentially every typo and every invented
 * number, because a wrong digit anywhere changes the check character.
 *
 * What it cannot tell you is whether a structurally valid GSTIN was actually
 * issued, or to whom. That distinction is stated in the caller's error messages
 * rather than glossed over: telling an applicant their number is "verified"
 * when all we did was arithmetic would be a lie a reviewer might rely on.
 *
 * ── Layout ────────────────────────────────────────────────────────────────
 *
 *   27 AAPFU0939F 1 Z V
 *   ├┘ ├────────┘ │ │ └ checksum over the first 14
 *   │  │          │ └── always 'Z' (reserved)
 *   │  │          └──── registration count for this PAN in this state
 *   │  └─────────────── the holder's PAN, embedded verbatim
 *   └────────────────── state code
 */

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/*
 * State and union-territory codes, as issued.
 *
 * Gaps are real — 34 is Puducherry, and there is no 41..96 — so this is a list
 * rather than a range check. 97 is "Other Territory" (offshore) and 99 is
 * Centre Jurisdiction; both are issued and must be accepted.
 */
const STATE_CODES = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
  '31', '32', '33', '34', '35', '36', '37', '38',
  '97', '99',
]);

const SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * The check character for the first 14 positions.
 *
 * Weights alternate 1, 2, 1, 2… from the left. The product is folded back into
 * base 36 — quotient plus remainder — rather than simply summed, which is what
 * makes the algorithm catch a transposition rather than only a substitution.
 */
export function gstinCheckDigit(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(first14[i]);
    if (value < 0) return null;
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / CHARSET.length) + (product % CHARSET.length);
  }
  return CHARSET[(CHARSET.length - (sum % CHARSET.length)) % CHARSET.length];
}

/**
 * @param {string} raw   the GSTIN as typed
 * @param {string} [pan] the PAN from the same form, if one was given
 * @returns {{ok: boolean, reason?: string, gstin?: string, state_code?: string, pan?: string}}
 */
export function verifyGstin(raw, pan = '') {
  const v = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');

  if (!v) return { ok: false, reason: 'Enter your GSTIN.' };
  if (v.length !== 15) {
    return { ok: false, reason: `A GSTIN is 15 characters; this one has ${v.length}.` };
  }
  if (!SHAPE.test(v)) {
    return {
      ok: false,
      reason: 'That is not the shape of a GSTIN. It runs: 2-digit state code, '
        + '10-character PAN, 1 registration digit, the letter Z, then a check character.',
    };
  }

  const stateCode = v.slice(0, 2);
  if (!STATE_CODES.has(stateCode)) {
    return { ok: false, reason: `${stateCode} is not a valid state code for a GSTIN.` };
  }

  const expected = gstinCheckDigit(v.slice(0, 14));
  if (expected !== v[14]) {
    /*
     * The expected character is deliberately NOT quoted back.
     *
     * It would turn the error into a hint for fabricating a passing number:
     * type anything, read off the correct final character, and resubmit. The
     * applicant with a real certificate in front of them needs to be told to
     * re-read it, which this does.
     */
    return {
      ok: false,
      reason: 'That GSTIN fails its own check digit — it has been mistyped, or it is not a real number. '
        + 'Please copy it exactly as printed on your registration certificate.',
    };
  }

  const embeddedPan = v.slice(2, 12);
  if (pan) {
    const p = String(pan).trim().toUpperCase();
    if (p && p !== embeddedPan) {
      return {
        ok: false,
        reason: `The PAN inside this GSTIN is ${embeddedPan}, which does not match the PAN you entered (${p}). `
          + 'One of the two is wrong.',
      };
    }
  }

  return { ok: true, gstin: v, state_code: stateCode, pan: embeddedPan };
}

export default { verifyGstin, gstinCheckDigit };

/** GSTIN verification - MOM 24/08 §2. */

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// State and union-territory codes, as issued.
const STATE_CODES = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
  '31', '32', '33', '34', '35', '36', '37', '38',
  '97', '99',
]);

const SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The check character for the first 14 positions. */
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
    // The expected character is deliberately NOT quoted back.
    return {
      ok: false,
      reason: 'That GSTIN fails its own check digit - it has been mistyped, or it is not a real number. '
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

// GSTIN check digit, client side.
const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// The gaps are real - there is no 39-96. 97 is Other Territory, 99 is Centre Jurisdiction;
// both are issued.
const STATE_CODES = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
  '31', '32', '33', '34', '35', '36', '37', '38',
  '97', '99',
]);

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

/** true when the GSTIN's state code and check character both hold up. */
export function isValidGstin(raw) {
  const v = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v)) return false;
  if (!STATE_CODES.has(v.slice(0, 2))) return false;
  return gstinCheckDigit(v.slice(0, 14)) === v[14];
}

/** The PAN a GSTIN carries, or '' if the string is not shaped like one. */
export function panFromGstin(raw) {
  const v = String(raw ?? '').trim().toUpperCase();
  return v.length === 15 ? v.slice(2, 12) : '';
}

export default { isValidGstin, gstinCheckDigit, panFromGstin };

/**
 * TLS settings for a MySQL connection, decided in one place.
 *
 * Four callers used to build this themselves and all four agreed on a rule that
 * was wrong for a public-CA provider: with DB_SSL=true and no DB_SSL_CA they
 * fell back to `rejectUnauthorized: false`, which encrypts the link but accepts
 * any certificate at all. That is the shape a man-in-the-middle needs, and it
 * looked configured, which is why nobody noticed.
 *
 * It went unnoticed because the provider in use issued its own private CA, so
 * DB_SSL_CA was always set and the fallback never ran. A provider whose
 * certificates chain to a public root - Azure Database for MySQL chains to
 * DigiCert, which Node already trusts - needs no CA pasted anywhere, so it lands
 * exactly on the old fallback and silently loses verification.
 *
 * The rule now:
 *
 *   DB_SSL not "true"          plaintext (a local MySQL on the same host)
 *   DB_SSL_CA set              verify against that CA - a provider-private root
 *   DB_SSL=true, no CA         verify against Node's built-in roots - Azure,
 *                              and any provider using a public CA
 *   DB_SSL_INSECURE=true       encrypt without verifying. An escape hatch for a
 *                              broken chain, and it has to be asked for.
 *
 * @param {Record<string,string|undefined>} env  process.env, or a parsed .env
 * @param {string} [caOverride]  PEM read from a file, for the remote migrator
 * @returns {{ca?:string, rejectUnauthorized:boolean, minVersion:string}|undefined}
 */
export function buildDbSsl(env = process.env, caOverride = '') {
  if (String(env.DB_SSL || '').toLowerCase() !== 'true') return undefined;

  // Accept the PEM either with real newlines (pasting a file into a dashboard
  // field) or with the two-character sequence \n, which is what a .env file and
  // any tooling that flattens multi-line values will produce.
  const ca = String(caOverride || env.DB_SSL_CA || '').replace(/\\n/g, '\n').trim();

  if (String(env.DB_SSL_INSECURE || '').toLowerCase() === 'true') {
    return { rejectUnauthorized: false, minVersion: 'TLSv1.2' };
  }

  // No `ca` key at all means Node falls back to its bundled root store, which
  // is what verifies a public-CA provider. Passing an empty string instead
  // would replace that store with nothing and fail every handshake.
  return ca
    ? { ca, rejectUnauthorized: true, minVersion: 'TLSv1.2' }
    : { rejectUnauthorized: true, minVersion: 'TLSv1.2' };
}

export default buildDbSsl;

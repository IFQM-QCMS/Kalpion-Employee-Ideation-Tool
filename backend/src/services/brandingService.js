/*
 * Tenant branding - the organisation display name and PNG logo that a tenant admin sets
 * for their OWN organisation (TVS sees TVS, L&T sees L&T).
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { masterDb } from '../database/master.js';
import { tenantUploadDir } from './uploadService.js';
import { badRequest, ApiError } from '../utils/respond.js';
import logger from '../utils/logger.js';

/** Logos are inlined into a JSON response, so they must stay small. */
export const MAX_LOGO_BYTES = 1024 * 1024; // 1MB

/** tenants.name is VARCHAR(100). */
const MAX_NAME_LENGTH = 100;

/** The 8-byte PNG signature. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 8 && buffer.subarray(0, 8).equals(PNG_MAGIC);
}

/** Branding writes go to the master registry. */
function assertRegistryTenant(tenant) {
  if (!tenant?.id) {
    throw new ApiError(503, 'The tenant registry is unavailable, so branding cannot be saved right now.');
  }
}

/** The tenant's logo, inlined as a data: URI. */
async function readLogoDataUri(tenant) {
  // Fetched here by id, deliberately NOT taken off the resolved tenant row.
  if (tenant?.id) {
    try {
      const [[row]] = await masterDb().execute(
        'SELECT logo_blob FROM tenants WHERE id = ? LIMIT 1', [tenant.id]
      );
      if (row?.logo_blob?.length) {
        return `data:image/png;base64,${Buffer.from(row.logo_blob).toString('base64')}`;
      }
    } catch (e) {
      // A registry that predates migration 023 has no such column. Fall through to disk rather
      // than failing the whole branding read.
      logger.warn(`branding: logo_blob unavailable (${e.code || e.message}) - falling back to disk`);
    }
  }

  let logoFile = tenant?.logo_url;
  const dir = await tenantUploadDir(tenant?.slug);

  if (!logoFile) {
    try {
      const files = await fs.readdir(dir);
      const logos = files.filter((f) => /^logo_.*\.png$/i.test(f)).sort().reverse();
      if (logos.length > 0) {
        logoFile = logos[0];
        if (tenant?.id) {
          await masterDb().execute(
            'UPDATE tenants SET logo_url = ?, logo_updated_at = NOW() WHERE id = ?',
            [logoFile, tenant.id]
          ).catch(() => {});
        }
      }
    } catch { /* ignore fallback error */ }
  }

  if (!logoFile) return null;
  try {
    const buffer = await fs.readFile(path.join(dir, logoFile));
    // Found on disk but not in the registry: put it somewhere durable now, rather than
    // rediscovering the same file until the day it is gone.
    if (tenant?.id) {
      await masterDb().execute(
        'UPDATE tenants SET logo_blob = ? WHERE id = ?', [buffer, tenant.id]
      ).catch((e) => logger.warn(`branding: could not cache logo into the registry - ${e.message}`));
    }
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    logger.warn(`Branding logo missing on disk for tenant "${tenant?.slug}": ${logoFile}`);
    return null;
  }
}

/** GET - the branding every user under this tenant sees. */
export async function getBranding(tenant) {
  return {
    success: true,
    branding: {
      org_name: tenant?.name || 'IFQM',
      logo: await readLogoDataUri(tenant),
      logo_updated_at: tenant?.logo_updated_at || null,
    },
  };
}

/** PUT - rename the organisation. Admin only (enforced by the route guard). */
export async function updateName(tenant, rawName) {
  assertRegistryTenant(tenant);

  const name = String(rawName ?? '').trim();
  if (!name) throw badRequest('Organization name is required.');
  if (name.length > MAX_NAME_LENGTH) {
    throw badRequest(`Organization name must be ${MAX_NAME_LENGTH} characters or fewer.`);
  }

  await masterDb().execute('UPDATE tenants SET name = ? WHERE id = ?', [name, tenant.id]);
  return { success: true, org_name: name };
}

/** POST - replace the organisation logo. */
export async function updateLogo(tenant, file) {
  assertRegistryTenant(tenant);

  if (!file?.buffer?.length) throw badRequest('No logo uploaded.');
  if (file.size > MAX_LOGO_BYTES) {
    throw badRequest(`Logo exceeds the ${MAX_LOGO_BYTES / 1024 / 1024}MB limit.`);
  }
  if (!isPng(file.buffer)) throw badRequest('Logo must be a PNG image.');

  const dir = await tenantUploadDir(tenant.slug);
  const safeName = `logo_${Date.now().toString(16)}${crypto.randomBytes(7).toString('hex')}.png`;

  // The registry write is the one that must succeed: it is the only storage here that
  // survives a restart.
  const previous = tenant.logo_url;
  try {
    await masterDb().execute(
      'UPDATE tenants SET logo_url = ?, logo_blob = ?, logo_updated_at = NOW() WHERE id = ?',
      [safeName, file.buffer, tenant.id]
    );
  } catch (err) {
    logger.error(`Failed to save branding logo for tenant "${tenant.slug}"`, err);
    throw new ApiError(500, 'Failed to save logo.');
  }

  await fs.writeFile(path.join(dir, safeName), file.buffer)
    .catch((err) => logger.warn(`branding: logo cached to disk failed for "${tenant.slug}" - ${err.message}`));

  // Best-effort: the registry is already updated, so an orphaned old file is clutter, not a
  // failure the admin needs to see.
  if (previous && previous !== safeName) {
    await fs.unlink(path.join(dir, previous)).catch(() => {});
  }

  return { success: true, logo: `data:image/png;base64,${file.buffer.toString('base64')}` };
}

/*
 * An admin who gives us a URL instead of a file gets the same logo, fetched server-side -
 * never an <img src> pointed straight at somebody else's server, which would break the
 * moment that link moved or went offline. Fetching it ourselves means this is a genuine
 * server-side HTTP request to an address an admin typed, which is exactly the shape of
 * request SSRF abuses - a malicious or compromised admin account pointing it at the host's
 * own internal network. Guarded three ways: only http/https, the resolved address is
 * checked against private/loopback/link-local ranges BEFORE connecting, and the request is
 * then pinned to that exact address (not re-resolved) so a hostname that answers
 * differently a moment later - DNS rebinding - gets no second lookup to exploit. Redirects
 * are refused rather than followed, since a redirect is the other classic way around an
 * address check like this one.
 */
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;          // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true;                         // multicast / reserved
    return false;
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::1' || v6 === '::') return true;
  if (v6.startsWith('fe80:')) return true;             // link-local
  if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // unique local
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return false;
}

const LOGO_FETCH_TIMEOUT_MS = 10_000;

async function fetchLogoFromUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl || '').trim()); } catch { throw badRequest('That is not a valid URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw badRequest('The logo URL must start with http:// or https://.');
  }

  let address;
  try {
    address = (await dns.lookup(parsed.hostname)).address;
  } catch {
    throw badRequest('Could not resolve that address.');
  }
  if (isPrivateAddress(address)) {
    throw badRequest('That address cannot be used for a logo.');
  }

  const client = parsed.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request({
      hostname: address,              // pinned - not re-resolved by the client
      servername: parsed.protocol === 'https:' ? parsed.hostname : undefined,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { Host: parsed.hostname, 'User-Agent': 'Kalpion-LogoFetch/1.0' },
      timeout: LOGO_FETCH_TIMEOUT_MS,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.resume(); req.destroy();
        reject(badRequest('That address redirects. Please provide the direct image URL.'));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume(); req.destroy();
        reject(badRequest(`Could not fetch that image (the server said ${res.statusCode}).`));
        return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_LOGO_BYTES) {
          req.destroy();
          reject(badRequest(`Logo exceeds the ${MAX_LOGO_BYTES / 1024 / 1024}MB limit.`));
        } else {
          chunks.push(chunk);
        }
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => reject(badRequest('Could not fetch that image.')));
    });
    req.on('timeout', () => { req.destroy(); reject(badRequest('Timed out fetching that image.')); });
    req.on('error', () => reject(badRequest('Could not fetch that image.')));
    req.end();
  });
}

/** POST - replace the organisation logo with one fetched from an admin-supplied URL. */
export async function updateLogoFromUrl(tenant, rawUrl) {
  assertRegistryTenant(tenant);
  if (!String(rawUrl || '').trim()) throw badRequest('Enter an image URL.');

  const buffer = await fetchLogoFromUrl(rawUrl);
  return updateLogo(tenant, { buffer, size: buffer.length });
}

/** DELETE - drop the logo and fall back to the plain org name. */
export async function removeLogo(tenant) {
  assertRegistryTenant(tenant);

  const previous = tenant.logo_url;
  await masterDb().execute(
    // logo_blob too - clearing only the filename would leave the bytes behind and the logo
    // would reappear on the next read.
    'UPDATE tenants SET logo_url = NULL, logo_blob = NULL, logo_updated_at = NOW() WHERE id = ?',
    [tenant.id]
  );

  if (previous) {
    const dir = await tenantUploadDir(tenant.slug);
    await fs.unlink(path.join(dir, previous)).catch(() => {});
  }

  return { success: true };
}

export default { getBranding, updateName, updateLogo, updateLogoFromUrl, removeLogo, MAX_LOGO_BYTES };

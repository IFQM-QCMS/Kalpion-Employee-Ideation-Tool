/**
 * Tenant branding — the organisation display name and PNG logo that a tenant
 * admin sets for their OWN organisation (TVS sees TVS, L&T sees L&T).
 *
 * Storage: the display name and the stored filename live on the master registry
 * row (ifqm_master.tenants.name / .logo_url). The PNG bytes live under
 * backend/uploads/<slug>/, next to idea attachments — a directory that is
 * deliberately not web-accessible.
 *
 * Reads hand the logo back as a data: URI rather than a URL. An <img> tag cannot
 * send an Authorization header, so a URL would have to point at a public,
 * unauthenticated endpoint keyed by org slug — which would let anyone enumerate
 * which organisations are on the platform, and fetch their logos, without
 * signing in. Inlining the bytes keeps the whole thing behind the authenticated
 * GET /api/branding. That is also why the logo is capped well below the 10MB
 * attachment limit: it rides inside a JSON response.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { masterDb } from '../database/master.js';
import { tenantUploadDir } from './uploadService.js';
import { badRequest, ApiError } from '../utils/respond.js';
import logger from '../utils/logger.js';

/** Logos are inlined into a JSON response, so they must stay small. */
export const MAX_LOGO_BYTES = 1024 * 1024; // 1MB

/** tenants.name is VARCHAR(100). */
const MAX_NAME_LENGTH = 100;

/**
 * The 8-byte PNG signature. The extension and the browser-supplied MIME type are
 * both attacker-controlled, so neither is evidence of anything — this checks the
 * actual bytes. A tenant admin is trusted, but "trusted" is not "should be able
 * to park arbitrary content in the uploads directory under a .png name".
 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 8 && buffer.subarray(0, 8).equals(PNG_MAGIC);
}

/**
 * Branding writes go to the master registry. When the registry is unreachable,
 * resolveTenant() degrades to the built-in fallback tenant (id 0) on a dev box —
 * there is no row to update, so saving would silently do nothing.
 */
function assertRegistryTenant(tenant) {
  if (!tenant?.id) {
    throw new ApiError(503, 'The tenant registry is unavailable, so branding cannot be saved right now.');
  }
}

/** Read the tenant's logo off disk and inline it. Returns null when unset/missing. */
async function readLogoDataUri(tenant) {
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
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    logger.warn(`Branding logo missing on disk for tenant "${tenant?.slug}": ${logoFile}`);
    return null;
  }
}

/**
 * GET — the branding every user under this tenant sees.
 * Available to any authenticated user, not just admins: it is what renders in
 * their sidebar.
 */
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

/** PUT — rename the organisation. Admin only (enforced by the route guard). */
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

/**
 * POST — replace the organisation logo.
 *
 * The new file is written under a fresh random name and the old one is unlinked
 * afterwards, so a failed write never destroys the logo that is currently live.
 */
export async function updateLogo(tenant, file) {
  assertRegistryTenant(tenant);

  if (!file?.buffer?.length) throw badRequest('No logo uploaded.');
  if (file.size > MAX_LOGO_BYTES) {
    throw badRequest(`Logo exceeds the ${MAX_LOGO_BYTES / 1024 / 1024}MB limit.`);
  }
  if (!isPng(file.buffer)) throw badRequest('Logo must be a PNG image.');

  const dir = await tenantUploadDir(tenant.slug);
  const safeName = `logo_${Date.now().toString(16)}${crypto.randomBytes(7).toString('hex')}.png`;

  try {
    await fs.writeFile(path.join(dir, safeName), file.buffer);
  } catch (err) {
    logger.error(`Failed to write branding logo for tenant "${tenant.slug}"`, err);
    throw new ApiError(500, 'Failed to save logo.');
  }

  const previous = tenant.logo_url;
  await masterDb().execute(
    'UPDATE tenants SET logo_url = ?, logo_updated_at = NOW() WHERE id = ?',
    [safeName, tenant.id]
  );

  // Best-effort: the registry is already updated, so an orphaned old file is
  // clutter, not a failure the admin needs to see.
  if (previous && previous !== safeName) {
    await fs.unlink(path.join(dir, previous)).catch(() => {});
  }

  return { success: true, logo: `data:image/png;base64,${file.buffer.toString('base64')}` };
}

/** DELETE — drop the logo and fall back to the plain org name. */
export async function removeLogo(tenant) {
  assertRegistryTenant(tenant);

  const previous = tenant.logo_url;
  await masterDb().execute(
    'UPDATE tenants SET logo_url = NULL, logo_updated_at = NOW() WHERE id = ?',
    [tenant.id]
  );

  if (previous) {
    const dir = await tenantUploadDir(tenant.slug);
    await fs.unlink(path.join(dir, previous)).catch(() => {});
  }

  return { success: true };
}

export default { getBranding, updateName, updateLogo, removeLogo, MAX_LOGO_BYTES };

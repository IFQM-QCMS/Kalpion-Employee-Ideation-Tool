/**
 * Integration service — the org-admin "Approved Ideas" + "API & Integration"
 * screens. Reads/writes the per-tenant QCMS credentials (in org_settings, the
 * key masked exactly like smtp_pass), lists this tenant's approved ideas, and
 * pushes them to QCMS via qcmsService.
 */
import config from '../config/index.js';
import { getOrgSettings } from './mailerService.js';
import { pushIdeaToQcms } from './qcmsService.js';
import { badRequest } from '../utils/respond.js';
import logger from '../utils/logger.js';

const KEY_MASK = '••••••••';

/**
 * Validate/clean an admin-typed QCMS base URL. Returns '' for a blank value
 * (meaning "fall back to the .env default"), throws for anything that is not a
 * plain http(s) URL — a typo here would silently send ideas nowhere.
 */
function normalizeBaseUrl(raw) {
  const v = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!v) return '';
  let parsed;
  try { parsed = new URL(v); } catch { throw badRequest('Enter a valid QCMS base URL, e.g. https://api.qcms.com/v1.'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw badRequest('The QCMS base URL must start with http:// or https://.');
  }
  return v;
}

// ── Config (get / save) ──────────────────────────────────────────────
export async function getQcmsConfig(db) {
  const s = await getOrgSettings(db);
  // The base URL defaults to the operator's .env value (QCMS_BASE_URL); an org
  // admin may override it for this tenant from the dashboard.
  const override = (s.qcms_base_url || '').trim();
  return {
    success: true,
    config: {
      enabled: s.qcms_enabled === '1',
      base_url: override || config.qcms.baseUrl,
      // What the field falls back to when the admin clears it, plus whether an
      // override is currently in force (the UI shows the default as a placeholder).
      default_base_url: config.qcms.baseUrl,
      base_url_custom: !!override,
      api_key_set: !!(s.qcms_api_key || '').trim(),
      // Never return the raw key; a mask if one is stored, empty otherwise.
      api_key: (s.qcms_api_key || '').trim() ? KEY_MASK : '',
    },
  };
}

export async function saveQcmsConfig(db, body) {
  if (!body || typeof body !== 'object') throw badRequest('No settings provided.');
  const writes = [];

  if (body.enabled !== undefined) writes.push(['qcms_enabled', body.enabled ? '1' : '0']);

  // Base URL: a blank value clears the override so the .env default applies again.
  if (body.base_url !== undefined) writes.push(['qcms_base_url', normalizeBaseUrl(body.base_url)]);

  // The key is written only when a real one is typed. An empty field or the mask
  // means "leave it alone" (same rule as smtp_pass), so saving the toggle can
  // never wipe a stored key. An explicit clear is opt-in.
  if (body.api_key_clear) {
    writes.push(['qcms_api_key', '']);
  } else if (body.api_key !== undefined) {
    const k = String(body.api_key || '').trim();
    if (k && k !== KEY_MASK) writes.push(['qcms_api_key', k]);
  }

  for (const [key, value] of writes) {
    await db.execute(
      `INSERT INTO org_settings (key_name, value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [key, String(value)]
    );
  }
  return getQcmsConfig(db);
}

// ── Approved ideas for this tenant (with QCMS push status) ───────────
export async function listApprovedIdeas(db) {
  const [rows] = await db.query(
    `SELECT i.id, i.idea_code, i.title, i.impact_areas, i.impact_level, i.status,
            i.present_situation, i.proposed_solution, i.is_anonymous,
            i.roi_value, i.tangible_benefit, i.intangible_benefit,
            i.investment_required, i.implementation_duration,
            i.submitted_at, i.updated_at,
            i.qcms_pushed_at, i.qcms_push_status, i.qcms_push_message,
            u.name AS submitter_name, u.department,
            (SELECT GROUP_CONCAT(cu.name SEPARATOR ', ')
               FROM idea_co_suggesters cs JOIN users cu ON cu.id = cs.user_id
              WHERE cs.idea_id = i.id) AS co_suggester_names
       FROM ideas i JOIN users u ON u.id = i.submitter_id
      WHERE i.status = 'Approved'
      ORDER BY i.updated_at DESC`
  );
  return { success: true, ideas: rows };
}

// ── Push ─────────────────────────────────────────────────────────────
async function resolvePushContext(db) {
  const s = await getOrgSettings(db);
  const apiKey = (s.qcms_api_key || '').trim();
  // This tenant's saved override wins; otherwise the operator's .env default.
  const baseUrl = (s.qcms_base_url || '').trim() || config.qcms.baseUrl;
  const enabled = s.qcms_enabled === '1';
  return { apiKey, baseUrl, enabled };
}

async function recordPush(db, ideaId, result) {
  await db.execute(
    'UPDATE ideas SET qcms_pushed_at = NOW(), qcms_push_status = ?, qcms_push_message = ? WHERE id = ?',
    [result.status, String(result.message || '').slice(0, 255), ideaId]
  );
}

/** Load approved ideas by id (or all), mapped-ready (submitter, co-suggesters). */
async function loadApprovedForPush(db, ideaIds) {
  const { ideas } = await listApprovedIdeas(db);
  if (Array.isArray(ideaIds) && ideaIds.length) {
    const wanted = new Set(ideaIds.map((n) => Number(n)));
    return ideas.filter((i) => wanted.has(Number(i.id)));
  }
  return ideas;
}

/**
 * Push one or more approved ideas to QCMS.
 * @param {number[]|null} ideaIds  specific ideas, or null/empty for all approved
 * @param {object} opts  { onlyPending } — skip ideas already imported/duplicate
 */
export async function pushApprovedIdeas(db, ideaIds = null, { onlyPending = false } = {}) {
  const { apiKey, baseUrl, enabled } = await resolvePushContext(db);
  if (!enabled) throw badRequest('QCMS integration is turned off. Enable it and save your API key first.');
  if (!apiKey) throw badRequest('No QCMS API key saved. Paste your key in API & Integration first.');

  let ideas = await loadApprovedForPush(db, ideaIds);
  if (onlyPending) ideas = ideas.filter((i) => i.qcms_push_status !== 'imported' && i.qcms_push_status !== 'duplicate');

  const results = [];
  let imported = 0; let duplicate = 0; let failed = 0;
  for (const idea of ideas) {
    const result = await pushIdeaToQcms({ baseUrl, apiKey, idea });
    await recordPush(db, idea.id, result);
    if (result.status === 'imported') imported++;
    else if (result.status === 'duplicate') duplicate++;
    else failed++;
    results.push({ id: idea.id, idea_code: idea.idea_code, status: result.status, message: result.message });
  }
  logger.info(`qcms push: ${imported} imported, ${duplicate} duplicate, ${failed} failed (${ideas.length} attempted)`);
  return { success: true, attempted: ideas.length, imported, duplicate, failed, results };
}

export default { getQcmsConfig, saveQcmsConfig, listApprovedIdeas, pushApprovedIdeas };

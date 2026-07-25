/**
 * QCMS integration — pushes approved ideas from this Ideation tool into the QCMS
 * (Quality & Continuous Improvement Management System) tool for implementation.
 *
 * We are the SENDER. QCMS exposes POST {base}/ideas with a per-organisation
 * Bearer key (qcms_live_...). This module maps one of our ideas into the QCMS
 * request body (documented in "QCMS Developer Portal & API Documentation") and
 * performs the HTTP call, interpreting the documented responses:
 *   201 → imported   409 → duplicate   401 → bad/disabled key   429 → rate limited
 *
 * The key never reaches the browser: the push runs server-side from here.
 */
import logger from '../utils/logger.js';

// QCMS's fixed category vocabulary. Our categories are free per-org text, so we
// map the common ones and fall back to the QCMS default of "Quality".
const QCMS_CATEGORIES = ['Quality', 'Cost', 'Delivery', 'Environment', 'Morale', 'Safety'];
const CATEGORY_MAP = {
  quality: 'Quality', 'quality improvement': 'Quality',
  cost: 'Cost', 'cost reduction': 'Cost', 'cost saving': 'Cost',
  delivery: 'Delivery', productivity: 'Delivery', 'process efficiency': 'Delivery',
  environment: 'Environment', sustenance: 'Environment', sustainability: 'Environment',
  morale: 'Morale', 'customer satisfaction': 'Morale',
  safety: 'Safety',
};

function mapCategory(impactAreas) {
  const first = String(impactAreas || '').split(',')[0].trim();
  if (!first) return 'Quality';
  if (QCMS_CATEGORIES.includes(first)) return first;
  return CATEGORY_MAP[first.toLowerCase()] || 'Quality';
}

const IMPACT_LEVELS = ['Low', 'Medium', 'High'];

/**
 * Resolve the POST /ideas endpoint from a configured base URL, tolerating either
 * form: the base ("…/api/v1/integrations") or the full endpoint already ending
 * in "/ideas" — so pasting the whole URL never produces "…/ideas/ideas".
 */
export function ideasEndpoint(baseUrl) {
  const trimmed = String(baseUrl || '').trim().replace(/\/+$/, '');
  return /\/ideas$/i.test(trimmed) ? trimmed : `${trimmed}/ideas`;
}

/** First finite number found in a value ("₹ 2,50,000" → 250000), else undefined. */
function toNumber(v) {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const digits = String(v).replace(/[^\d.]/g, '');
  const n = Number(digits);
  return Number.isFinite(n) && digits !== '' ? n : undefined;
}

/**
 * Map one idea row (as returned by listApprovedIdeas) to the QCMS request body.
 * Optional fields are omitted when we have nothing meaningful, so we never send
 * empty strings for numbers.
 * @param {object} idea
 * @returns {object} QCMS payload
 */
export function mapIdeaToQcms(idea) {
  const payload = {
    ideaCode: String(idea.idea_code || ''),
    title: String(idea.title || ''),
    category: mapCategory(idea.impact_areas),
    status: 'Approved',
  };

  const set = (k, v) => { if (v !== undefined && v !== null && v !== '') payload[k] = v; };

  set('presentSituation', idea.present_situation);
  set('proposedSolution', idea.proposed_solution);
  set('department', idea.department);
  set('submittedBy', idea.is_anonymous ? 'Anonymous' : idea.submitter_name);

  const co = Array.isArray(idea.co_suggester_names)
    ? idea.co_suggester_names.filter(Boolean)
    : String(idea.co_suggester_names || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (co.length) payload.coSuggesters = co;

  // Financial "tangible benefit": prefer the numeric ROI value; else pull a
  // number out of the free-text tangible_benefit.
  const tangible = toNumber(idea.roi_value) ?? toNumber(idea.tangible_benefit);
  set('tangibleBenefit', tangible);
  set('intangibleBenefit', idea.intangible_benefit);
  set('investmentRequired', toNumber(idea.investment_required));
  set('implementationTime', idea.implementation_duration);

  const impact = IMPACT_LEVELS.includes(idea.impact_level) ? idea.impact_level : 'Medium';
  payload.impactLevel = impact;

  return payload;
}

/**
 * Push a single idea to QCMS. Never throws for an HTTP/QCMS error — returns a
 * structured result the caller records against the idea.
 * @returns {Promise<{status:'imported'|'duplicate'|'failed', httpStatus:number, message:string, payload:object}>}
 */
export async function pushIdeaToQcms({ baseUrl, apiKey, idea, timeoutMs = 12000 }) {
  const payload = mapIdeaToQcms(idea);
  const url = ideasEndpoint(baseUrl);

  if (!apiKey) {
    return { status: 'failed', httpStatus: 0, message: 'No QCMS API key configured.', payload };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    logger.warn(`qcms push network error for ${payload.ideaCode}: ${e.message}`);
    return {
      status: 'failed', httpStatus: 0, payload,
      message: e.name === 'AbortError' ? 'QCMS did not respond in time.' : `Could not reach QCMS (${e.message}).`,
    };
  }
  clearTimeout(timer);

  // Read the body once as text so we can both parse it AND scan it for a
  // duplicate signal (see below), regardless of shape.
  let raw = '';
  try { raw = await res.text(); } catch { /* */ }
  let body = {};
  try { body = JSON.parse(raw); } catch { /* non-JSON */ }
  const bodyMsg = (body && (body.message || body.error)) || '';

  // Some QCMS builds do NOT return the documented 409 when an idea already
  // exists — they leak the underlying unique-constraint error (a Postgres
  // "duplicate key ... imported_ideas_idea_code_key ... already exists") with a
  // 500. The idea is nonetheless already in QCMS, so we classify any such
  // response as a duplicate rather than a hard failure.
  const DUP_SIGNAL = /duplicate key|already exists|already imported|uniqueviolation|idea_code.{0,20}key/i;

  if (res.status === 201 || res.status === 200) {
    return { status: 'imported', httpStatus: res.status, payload, message: bodyMsg || 'Idea imported successfully.' };
  }
  if (res.status === 409 || DUP_SIGNAL.test(raw)) {
    return { status: 'duplicate', httpStatus: res.status, payload, message: 'Idea already imported.' };
  }
  if (res.status === 401) {
    return { status: 'failed', httpStatus: 401, payload, message: bodyMsg || 'Invalid or disabled API key.' };
  }
  if (res.status === 429) {
    return { status: 'failed', httpStatus: 429, payload, message: bodyMsg || 'QCMS rate limit exceeded (100/min). Try again shortly.' };
  }
  // Keep the QCMS message but cap it — a leaked stack trace would otherwise fill
  // the status column.
  return { status: 'failed', httpStatus: res.status, payload, message: (bodyMsg || `QCMS returned HTTP ${res.status}.`).slice(0, 200) };
}

export default { mapIdeaToQcms, pushIdeaToQcms };

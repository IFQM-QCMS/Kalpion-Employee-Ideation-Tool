/**
 * Org-settings service — Node port of PHP api/settings.php, plus
 * getApprovalConfig() (used by the ideas workflow, mirrors ideas.php).
 *
 * NOTE: PHP memoised getOrgSettings with a request-scoped `static`. Here we read
 * fresh each call (no cross-request/tenant caching), the safe equivalent.
 */
import { getOrgSettings, sendSmtpEmail } from './mailerService.js';
import {
  parseStages, stagesToChain, STAGE_CATALOG, DEFAULT_STAGES, DEFAULT_CHAIN,
  resolveLabels, approverStages, firstStage, finalStage, nextStage, isFinalStage,
  stagesForRole,
} from './approvalStages.js';
import { badRequest, ApiError } from '../utils/respond.js';
import config from '../config/index.js';
import { IDEA_SECTIONS } from './ideaSections.js';
import { platformFileCeilingMb } from './platformSettingsService.js';

/*
 * The ceiling no organisation may exceed.
 *
 * It used to be `config.maxFileMb` and nothing else, so raising it for one
 * customer meant an environment variable and a redeploy. It is now whatever a
 * platform admin has set in the console, still bounded by the environment —
 * the console decides policy, the server decides what it will physically
 * accept.
 */

const SETTINGS_WHITELIST = [
  'review_sla_days', 'escalation_days', 'anonymous_allowed', 'public_board_enabled',
  'challenges_enabled', 'email_enabled', 'smtp_host', 'smtp_port', 'smtp_user',
  'smtp_pass', 'smtp_from', 'smtp_from_name',
  // The approval chain is one ordered list of steps. `approval_mode`,
  // `approval_reviewer_roles`, `approval_final_approver_roles` and
  // `approval_threshold` are deliberately absent: they are the three competing
  // descriptions of this same chain that were removed, and accepting a write to
  // any of them would let a stale client resurrect one.
  'approval_stages',
  /*
   * What this organisation calls each stage.
   *
   * JSON, keyed by stage. Separate from `approval_stages` because the KEY is
   * what is stored on every idea row and in the chain itself: renaming
   * "Team Lead" to "Shift Incharge" must change a label and nothing else, and
   * must not strand an idea that is sitting at team_lead when the rename
   * happens. Validated on write — see normaliseStageLabels below.
   */
  'approval_stage_labels',
  // MOM §13.1 — who may read a full proposed solution. This was a constant in
  // ideaService; the org admin now owns it.
  'solution_visibility', 'idea_tags_enabled', 'patentability_enabled',
  // §14.10 — who may read the AI's reasoning. Voting stays open to everyone.
  'prediction_visibility',
  // Per-organisation attachment ceiling, idea-screen deterrents, and how much
  // of a problem statement an uninvolved colleague may read.
  'max_file_mb', 'idea_screen_protection', 'situation_preview_chars',
  // Which parts of somebody else's idea an ordinary colleague may read.
  'employee_visible_sections',
];

/**
 * Clean a submitted label map before it is stored.
 *
 * Unknown stage keys are dropped rather than kept: they would be invisible in
 * the UI and would sit in the row for ever. Blank names are dropped too, which
 * is how a stage is reset to its built-in name — there is no separate "reset"
 * to implement.
 *
 * Length-capped because this renders inside table cells and a pasted paragraph
 * would break the layout of every queue in the product.
 */
export function normaliseStageLabels(raw) {
  let input = raw;
  if (typeof raw === 'string') {
    try {
      input = JSON.parse(raw);
    } catch {
      return null;   // unparseable — reject the write rather than store junk
    }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;

  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (!STAGE_CATALOG[key]) continue;
    const name = String(value ?? '').trim().slice(0, 60);
    // A name identical to the built-in one is not an override.
    if (name && name !== STAGE_CATALOG[key].label) out[key] = name;
  }
  return JSON.stringify(out);
}

/** Accepted values for solution_visibility, loosest last. */
export const SOLUTION_VISIBILITY_MODES = ['authors_reviewers', 'managers_only', 'everyone'];
export const PREDICTION_VISIBILITY_MODES = ['seniors', 'everyone'];

const SMTP_PASS_MASK = '••••••••';
const isAdmin = (role) => role === 'admin' || role === 'super_admin';

/**
 * The organisation's approval chain: one ordered list of steps, resolved into
 * the reviewer/final role lists the escalation engine consumes.
 *
 * `stages` is returned alongside so the settings screen and the idea timeline
 * can SHOW the sequence rather than reconstruct it. That reconstruction was the
 * source of the old disagreement between preview and behaviour.
 *
 * A stored list with no approver in it falls back to the built-in sequence
 * rather than leaving submitted ideas with nobody able to action them.
 */
/**
 * This tenant's approval chain, read fresh on every request.
 *
 * Deliberately not cached. An administrator changing the chain expects the next
 * idea to follow it, and a cache would mean "the next idea, on whichever server
 * process happens to serve it, some minutes from now". The read is one indexed
 * lookup against the tenant's own org_settings.
 *
 * Everything here comes from the tenant's OWN database, so one organisation's
 * chain is invisible to every other, and applies to all of that organisation's
 * users at once.
 */
export async function getApprovalConfig(db) {
  const settings = await getOrgSettings(db);
  const stages = parseStages(settings.approval_stages);
  const usable = stages.length && approverStages(stages).length ? stages : [...DEFAULT_STAGES];
  const chain = stagesToChain(usable) || DEFAULT_CHAIN;

  return {
    stages: usable,
    // The ordered walk. This is what the engine follows.
    approvers: approverStages(usable),
    first_stage: firstStage(usable),
    final_stage: finalStage(usable),
    labels: resolveLabels(settings.approval_stage_labels),
    // Flattened role sets, kept for read-only callers that only ask "who is
    // involved at all" — never for deciding what comes next.
    reviewer_roles: chain.reviewer_roles,
    final_roles: chain.final_roles,
  };
}

/** The stage after `key` in this tenant's chain, or null when `key` is last. */
export function advanceStage(cfg, key) {
  return nextStage(cfg.stages, key);
}

/** Does approving at `key` close the idea? */
export function closesIdea(cfg, key) {
  return isFinalStage(cfg.stages, key);
}

/** The stages this role may act at. */
export function rolePlaysStages(cfg, role) {
  return stagesForRole(cfg.stages, role);
}

// ── GET all settings (with SMTP-password masking) ──────────────────
export async function getSettings(db, user) {
  const settings = await getOrgSettings(db);

  // The QCMS API key is a secret managed on its own screen (integrationService,
  // masked there). It must never travel through the general settings response.
  delete settings.qcms_api_key;

  if (!isAdmin(user.role)) {
    delete settings.smtp_pass;
  } else if (settings.smtp_pass) {
    settings.smtp_pass_set = true;
    settings.smtp_pass = SMTP_PASS_MASK;
  } else {
    settings.smtp_pass_set = false;
  }

  /*
   * The ceiling travels with the settings so the org admin's field can show the
   * bound it is actually clamped to. Without it the form advertises max="50"
   * from a hard-coded attribute while the server silently trims to whatever the
   * platform allows — the classic case of a screen and a rule disagreeing.
   */
  return { success: true, settings, platform_max_file_mb: await platformFileCeilingMb() };
}

// ── UPDATE whitelisted settings ────────────────────────────────────
export async function updateSettings(db, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) {
    throw badRequest('No settings provided.');
  }

  let updated = 0;
  for (const [key, rawValue] of Object.entries(body)) {
    if (!SETTINGS_WHITELIST.includes(key)) continue;               // skip unknown keys

    /*
     * smtp_pass is written only when the admin actually typed one.
     *
     * This used to skip ONLY the exact mask string, which missed the case that
     * happened on every save: the form's password field is empty unless touched
     * (AdminPage renders it with a placeholder and no value), so saving ANY
     * unrelated setting — an SLA day, a feature flag — sent smtp_pass:'' and
     * wiped the organisation's mail password. Outgoing email then failed
     * silently, with nothing on screen suggesting the save had touched SMTP.
     *
     * Empty now means "leave it alone", which is the only thing an untouched
     * field can honestly mean. Changing the password means typing a new one.
     */
    if (key === 'smtp_pass' && (!String(rawValue ?? '').trim() || rawValue === SMTP_PASS_MASK)) continue;

    let value = rawValue;
    // An unrecognised visibility mode must not silently become "everyone" —
    // that would publish every solution in the org on a typo.
    /*
     * Stage names are normalised before storage: unknown keys dropped, blanks
     * dropped (which is how a stage returns to its built-in name), length
     * capped. Unparseable input is refused rather than stored — a broken JSON
     * blob here would make every stage fall back to its default name with no
     * indication why.
     */
    if (key === 'approval_stage_labels') {
      const cleaned = normaliseStageLabels(value);
      if (cleaned === null) throw badRequest('Stage names could not be read. Please try again.');
      value = cleaned;
    }
    if (key === 'solution_visibility' && !SOLUTION_VISIBILITY_MODES.includes(String(value))) continue;
    if (key === 'prediction_visibility' && !PREDICTION_VISIBILITY_MODES.includes(String(value))) continue;
    // Bounded by the platform maximum: an organisation may lower its own limit
    // but not raise it past what the server is willing to accept.
    if (key === 'max_file_mb') {
      const ceiling = await platformFileCeilingMb();
      value = String(Math.max(1, Math.min(ceiling, parseInt(value, 10) || 10)));
    }
    if (key === 'situation_preview_chars') {
      value = String(Math.max(60, Math.min(600, parseInt(value, 10) || 180)));
    }
    // An unknown section name is dropped rather than stored, so a typo can
    // never open a section by accident - the filter keeps only what the idea
    // service actually knows how to hide.
    if (key === 'employee_visible_sections') {
      const wanted = String(value).split(',').map((x) => x.trim()).filter(Boolean);
      value = IDEA_SECTIONS.filter((x) => wanted.includes(x)).join(',');
    }
    /*
     * Stage keys are validated against the catalog: a stage nobody holds is a
     * step no idea can ever pass, and it would only be discovered by an
     * employee whose submission stopped moving. An unrecognised key is dropped
     * rather than stored.
     */
    if (key === 'approval_stages') {
      const stages = String(value).split(',').map((s) => s.trim()).filter((s) => STAGE_CATALOG[s]);
      const approvers = [...new Set(stages.filter((s) => s !== 'originator'))];
      if (!approvers.length) throw badRequest('The approval chain needs at least one approver stage.');
      value = ['originator', ...approvers].join(',');
    }

    await db.execute(
      `INSERT INTO org_settings (key_name, value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [key, String(value)]
    );
    updated++;
  }

  return { success: true, updated };
}

// ── SEND TEST EMAIL ────────────────────────────────────────────────
export async function sendTestEmail(db, user) {
  const settings = await getOrgSettings(db);
  if (!String(settings.smtp_host || '').trim()) {
    throw badRequest('SMTP host is not configured. Please save SMTP settings first.');
  }

  const [rows] = await db.execute('SELECT email, name FROM users WHERE id = ? LIMIT 1', [user.id]);
  const toEmail = rows[0]?.email || user.email || '';
  const toName = rows[0]?.name || user.name || 'Admin';

  if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    throw badRequest('Your account does not have a valid email address.');
  }

  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`;
  const subject = 'IFQM Ideation – Test Email';
  const body =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="font-family:Arial,sans-serif;padding:20px;color:#1e293b">' +
    '<h2 style="color:#4f46e5">IFQM Ideation Tool – Test Email</h2>' +
    `<p>Hi ${escapeHtml(toName)},</p>` +
    '<p>This is a test email confirming that your SMTP configuration is working correctly.</p>' +
    `<p style="color:#64748b;font-size:12px">Sent at ${stamp} (server time)</p>` +
    '</body></html>';

  try {
    const sent = await sendSmtpEmail(settings, toEmail, toName, subject, body);
    if (sent) return { success: true, message: 'Test email sent to ' + toEmail };
    return { success: false, error: 'Failed to send test email. Check SMTP settings.' };
  } catch (e) {
    // PHP returned HTTP 200 with success:false for SMTP errors here.
    throw new ApiError(200, 'SMTP error: ' + e.message);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])
  );
}

export default {
  getApprovalConfig, advanceStage, closesIdea, rolePlaysStages,
  getSettings, updateSettings, sendTestEmail,
};

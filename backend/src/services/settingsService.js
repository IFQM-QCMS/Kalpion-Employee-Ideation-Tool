/**
 * Org-settings service — Node port of PHP api/settings.php, plus
 * getApprovalConfig() (used by the ideas workflow, mirrors ideas.php).
 *
 * NOTE: PHP memoised getOrgSettings with a request-scoped `static`. Here we read
 * fresh each call (no cross-request/tenant caching), the safe equivalent.
 */
import { getOrgSettings, sendSmtpEmail } from './mailerService.js';
import {
  parseStages, stagesToChain, STAGE_CATALOG,
  DEFAULT_REVIEWER_ROLES as CHAIN_DEFAULT_REVIEWERS,
  DEFAULT_FINAL_ROLES as CHAIN_DEFAULT_FINALS,
} from './approvalStages.js';
import { badRequest, ApiError } from '../utils/respond.js';
import config from '../config/index.js';
import { IDEA_SECTIONS } from './ideaSections.js';

/** The ceiling no organisation may exceed, from the server environment. */
const PLATFORM_MAX_FILE_MB = config.maxFileMb;

const SETTINGS_WHITELIST = [
  'review_sla_days', 'escalation_days', 'anonymous_allowed', 'public_board_enabled',
  'challenges_enabled', 'email_enabled', 'smtp_host', 'smtp_port', 'smtp_user',
  'smtp_pass', 'smtp_from', 'smtp_from_name', 'approval_mode',
  'approval_reviewer_roles', 'approval_final_approver_roles', 'approval_threshold',
  'approval_stages',
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

/** Accepted values for solution_visibility, loosest last. */
export const SOLUTION_VISIBILITY_MODES = ['authors_reviewers', 'managers_only', 'everyone'];
export const PREDICTION_VISIBILITY_MODES = ['seniors', 'everyone'];

const APPROVAL_MODES = ['default', 'custom', 'stages'];

const SMTP_PASS_MASK = '••••••••';
const isAdmin = (role) => role === 'admin' || role === 'super_admin';

/*
 * MOM 29 Jul 2026 §13.11/§13.12 — the built-in chain now ends at Plant Head,
 * not Executive, and super_admin is no longer an approver anywhere. Both lists
 * are imported from approvalStages so that the stage-based and role-based modes
 * cannot drift apart: they described the same chain and used to define it twice.
 */
const DEFAULT_REVIEWER_ROLES = CHAIN_DEFAULT_REVIEWERS;
const DEFAULT_FINAL_ROLES = CHAIN_DEFAULT_FINALS;

// Roles a tenant admin may place in their approval chain. Anything else typed
// into the role lists is dropped on save — a bad role name would silently
// exclude reviewers from the escalation walk. super_admin is absent by design
// (§13.11): it cannot be selected, and any stored chain that still names it is
// filtered out on read.
const VALID_CHAIN_ROLES = [
  'team_lead', 'project_lead', 'manager', 'department_manager', 'senior_manager',
  'plant_head', 'executive', 'admin',
];

export async function getApprovalConfig(db) {
  const settings = await getOrgSettings(db);
  const mode = settings.approval_mode ?? 'default';

  /*
   * Stage mode — the organisation described its chain as an ordered list of
   * named steps (Originator → Immediate Manager → Department Manager → Plant
   * Head). Everything downstream still consumes reviewer_roles/final_roles, so
   * the ordering is resolved into those two lists here and the escalation
   * engine never learns that stages exist.
   *
   * A stage list with no approver in it falls through to the built-in chain
   * rather than leaving submitted ideas with nobody able to action them.
   */
  if (mode === 'stages') {
    const stages = parseStages(settings.approval_stages);
    const chain = stagesToChain(stages);
    if (chain) {
      return {
        mode: 'stages',
        stages,
        reviewer_roles: chain.reviewer_roles,
        final_roles: chain.final_roles,
        threshold: clampThreshold(settings.approval_threshold),
      };
    }
  }

  if (mode !== 'custom') {
    return {
      mode: 'default',
      reviewer_roles: [...DEFAULT_REVIEWER_ROLES],
      final_roles: [...DEFAULT_FINAL_ROLES],
      threshold: parseInt(settings.approval_threshold ?? '100', 10) || 100,
    };
  }

  const parseRoles = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  let reviewerRoles = parseRoles(settings.approval_reviewer_roles);
  let finalRoles = parseRoles(settings.approval_final_approver_roles);
  if (!reviewerRoles.length) reviewerRoles = [...DEFAULT_REVIEWER_ROLES];
  if (!finalRoles.length) finalRoles = [...DEFAULT_FINAL_ROLES];

  return {
    mode: 'custom',
    reviewer_roles: reviewerRoles,
    final_roles: finalRoles,
    threshold: clampThreshold(settings.approval_threshold),
  };
}

const clampThreshold = (v) => Math.max(1, Math.min(100, parseInt(v ?? '100', 10) || 100));

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

  return { success: true, settings };
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
    if (key === 'approval_mode' && !APPROVAL_MODES.includes(value)) continue; // reject invalid mode
    // An unrecognised visibility mode must not silently become "everyone" —
    // that would publish every solution in the org on a typo.
    if (key === 'solution_visibility' && !SOLUTION_VISIBILITY_MODES.includes(String(value))) continue;
    if (key === 'prediction_visibility' && !PREDICTION_VISIBILITY_MODES.includes(String(value))) continue;
    // Bounded by the platform maximum: an organisation may lower its own limit
    // but not raise it past what the server is willing to accept.
    if (key === 'max_file_mb') {
      value = String(Math.max(1, Math.min(PLATFORM_MAX_FILE_MB, parseInt(value, 10) || 10)));
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
    if (key === 'approval_threshold') {
      value = String(Math.max(1, Math.min(100, parseInt(value, 10) || 0)));
    }
    if (key === 'approval_reviewer_roles' || key === 'approval_final_approver_roles') {
      value = String(value).split(',').map((s) => s.trim())
        .filter((r) => VALID_CHAIN_ROLES.includes(r)).join(',');
    }
    /*
     * Stage keys are validated against the catalog for the same reason the role
     * lists are: a stage nobody holds is a step no idea can ever pass, and it
     * would only be discovered by an employee whose submission stopped moving.
     * An unrecognised key is dropped rather than stored.
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

export default { getApprovalConfig, getSettings, updateSettings, sendTestEmail };

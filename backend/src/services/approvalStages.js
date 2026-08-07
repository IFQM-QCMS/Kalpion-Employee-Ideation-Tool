/**
 * Named approval stages — the vocabulary an organisation builds its approval
 * chain from, and the translation of that chain into the reviewer/final role
 * lists the escalation engine already understands.
 *
 * ── Why a stage list and not just two role checkboxes ───────────────────────
 * The chain an organisation describes to its own people is an ORDER —
 * "originator → immediate manager → department manager → plant head" — not two
 * unordered sets of roles. Storing the order is what lets the admin screen add,
 * remove and rearrange the steps, and it is what makes the preview honest.
 *
 * The engine is untouched. `stagesToChain()` derives from the list exactly the
 * two things ideaService asks getApprovalConfig() for:
 *
 *   reviewer_roles  every approver stage except the last — these APPROVE AND
 *                   ESCALATE up the manager tree
 *   final_roles     the last stage — this one CLOSES the idea
 *
 * So the ordering lives here, and reviewAction() keeps walking manager_id
 * upward the way it always has.
 *
 * `originator` is the person who submits. It carries no role and is never an
 * approver; it is in the list so the chain reads top-to-bottom the way an admin
 * would draw it on a whiteboard, and so the first step cannot be mistaken for
 * an approval step.
 */

/**
 * Stage key → the users.role a person must hold to act at that stage.
 *
 * `immediate_manager` maps to plain `manager`: it is the submitter's own line
 * manager, which is a level in the reporting tree rather than a distinct job
 * title. Large organisations keep it; flatter ones delete the stage and ideas
 * go straight to the department manager.
 */
export const STAGE_CATALOG = {
  originator:         { role: null,                 fixed: true },
  immediate_manager:  { role: 'manager' },
  department_manager: { role: 'department_manager' },
  plant_head:         { role: 'plant_head' },
  // Also selectable, so an organisation that already runs the older role-based
  // chain can express it as stages without inventing job titles it does not use.
  team_lead:          { role: 'team_lead' },
  project_lead:       { role: 'project_lead' },
  senior_manager:     { role: 'senior_manager' },
  executive:          { role: 'executive' },
};

export const STAGE_KEYS = Object.keys(STAGE_CATALOG);

/** What a tenant is born with, and what "Reset to defaults" restores. */
export const DEFAULT_STAGES = [
  'originator', 'immediate_manager', 'department_manager', 'plant_head',
];

/**
 * An idea must never be able to dead-end. Whatever chain an organisation
 * builds, the org admin can always close what is sitting in front of them, so
 * this is appended to the final-approver set rather than replacing it.
 *
 * MOM 29 Jul 2026 §13.11 removes `super_admin` from the approval chain. It was
 * here as a second safety net, but a super admin approving ideas is exactly the
 * conflation of platform ownership with business judgement the MOM objects to:
 * whoever holds the org's super-admin credentials is usually IT, not the person
 * qualified to accept a shop-floor improvement. `admin` alone keeps the
 * dead-end guarantee.
 */
const ALWAYS_FINAL = ['admin'];

/**
 * §13.12 — the built-in chain's final authority is the Plant Head, replacing
 * Executive. Organisations running the older role-based `approval_mode` inherit
 * this too, which is the point: the MOM is describing who signs off, not which
 * storage format an org happens to use.
 */
export const DEFAULT_FINAL_ROLES = ['plant_head', 'admin'];
export const DEFAULT_REVIEWER_ROLES = [
  'team_lead', 'project_lead', 'manager', 'department_manager', 'senior_manager',
];

/** Parse the stored CSV into a clean, de-duplicated, originator-first list. */
export function parseStages(raw) {
  const seen = new Set();
  const stages = String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => STAGE_CATALOG[s] && !seen.has(s) && seen.add(s));

  if (!stages.length) return [];
  // The originator is implicit whether or not it was stored, and it is always
  // first — an approver cannot precede the person who submitted.
  return ['originator', ...stages.filter((s) => s !== 'originator')];
}

/** The approver steps, in order, with their roles. Excludes the originator. */
export function approverStages(stages) {
  return stages
    .filter((s) => s !== 'originator' && STAGE_CATALOG[s]?.role)
    .map((s) => ({ stage: s, role: STAGE_CATALOG[s].role }));
}

/**
 * Derive { reviewer_roles, final_roles } from an ordered stage list.
 * Returns null when the list has no approver in it — the caller then falls back
 * to the built-in chain rather than publishing an approval workflow that
 * nobody can action.
 */
export function stagesToChain(stages) {
  const approvers = approverStages(stages);
  if (!approvers.length) return null;

  const roles = [...new Set(approvers.map((a) => a.role))];
  const finalRole = roles[roles.length - 1];
  const reviewerRoles = roles.slice(0, -1);
  const finalRoles = [...new Set([finalRole, ...ALWAYS_FINAL])];

  return { reviewer_roles: reviewerRoles, final_roles: finalRoles };
}

export default { STAGE_CATALOG, STAGE_KEYS, DEFAULT_STAGES, parseStages, approverStages, stagesToChain };

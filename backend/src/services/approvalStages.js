/**
 * Named approval stages — the vocabulary an organisation builds its approval
 * chain from, and the translation of that chain into the reviewer/final role
 * lists the escalation engine already understands.
 *
 * ── One sequence, not three ways of saying the same thing ───────────────────
 * There were three approval "modes": a built-in chain, this ordered stage list,
 * and a pair of free-form role checkbox sets. All three described the same
 * journey, none of them agreed, and only one could be in force at a time — so
 * the settings screen showed an admin three different answers to "who approves
 * my ideas?" and left them to work out which one counted.
 *
 * There is now one representation: an ORDER of named steps, "originator →
 * immediate manager → department manager → plant head". Storing the order is
 * what lets the admin screen add, remove and rearrange the steps, and it is
 * what makes the preview honest — the preview is now rendered from the same
 * list the engine walks, so it cannot advertise a chain that is not run.
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
 * Listed junior → senior, because that is the order an admin builds a chain in
 * and the order the "add a step" menu should offer.
 *
 * Each job title appears EXACTLY ONCE. It previously appeared up to three times
 * on the same screen — once in this catalog, once in the reviewer-role
 * checkboxes and once in the final-approver checkboxes — so an admin choosing
 * "Senior Manager" had to know which of three identically-labelled controls
 * governed their chain. There is now one list and one meaning per title.
 *
 * `immediate_manager` maps to plain `manager`: it is the submitter's own line
 * manager, which is a level in the reporting tree rather than a distinct job
 * title. Large organisations keep it; flatter ones delete the stage and ideas
 * go straight to the department manager.
 */
export const STAGE_CATALOG = {
  originator:         { role: null, fixed: true },
  immediate_manager:  { role: 'manager' },
  team_lead:          { role: 'team_lead' },
  project_lead:       { role: 'project_lead' },
  department_manager: { role: 'department_manager' },
  senior_manager:     { role: 'senior_manager' },
  plant_head:         { role: 'plant_head' },
  executive:          { role: 'executive' },
};

export const STAGE_KEYS = Object.keys(STAGE_CATALOG);

/** What a tenant is born with, and what "Reset to defaults" restores. */
export const DEFAULT_STAGES = [
  'originator', 'immediate_manager', 'department_manager', 'plant_head',
];

/**
 * The chain a tenant falls back to: the built-in sequence, resolved through the
 * same function every other chain goes through.
 *
 * It used to be two hand-written role lists sitting beside DEFAULT_STAGES, and
 * they disagreed — the lists made five roles reviewers while the stage sequence
 * named two, so the preview an admin read and the chain the engine walked were
 * different documents. Deriving removes the possibility.
 *
 * MOM 29 Jul 2026 §13.11 keeps `super_admin` out of the chain entirely: whoever
 * holds the org's super-admin credentials is usually IT, not the person
 * qualified to accept a shop-floor improvement. §13.12 puts final authority
 * with the Plant Head, and org admins hold no approval authority at all.
 */
export const DEFAULT_CHAIN = stagesToChain(DEFAULT_STAGES);

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
  const finalRoles = [...new Set([finalRole])];

  return { reviewer_roles: reviewerRoles, final_roles: finalRoles };
}

export default {
  STAGE_CATALOG, STAGE_KEYS, DEFAULT_STAGES, DEFAULT_CHAIN,
  parseStages, approverStages, stagesToChain,
};

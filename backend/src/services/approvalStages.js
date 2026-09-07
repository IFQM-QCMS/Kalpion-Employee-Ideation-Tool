/*
 * The approval chain: an ORDERED list of named stages, and the rules for walking an idea
 * along it.
 */

/** Stage key the users.role a person must hold to act at that stage. */
export const STAGE_CATALOG = {
  originator:         { role: null, fixed: true, label: 'Originator' },
  team_lead:          { role: 'team_lead',          label: 'Team Lead' },
  immediate_manager:  { role: 'manager',            label: 'Immediate Manager' },
  project_lead:       { role: 'project_lead',       label: 'Project Lead' },
  department_manager: { role: 'department_manager', label: 'Department Manager' },
  senior_manager:     { role: 'senior_manager',     label: 'Senior Manager' },
  plant_head:         { role: 'plant_head',         label: 'Plant Head' },
  executive:          { role: 'executive',          label: 'Executive' },
};

export const STAGE_KEYS = Object.keys(STAGE_CATALOG);

/** What a tenant is born with, and what "Reset to defaults" restores. */
export const DEFAULT_STAGES = [
  'originator', 'team_lead', 'immediate_manager', 'department_manager', 'plant_head',
];

/** Parse the stored CSV into a clean, de-duplicated, originator-first list. */
export function parseStages(raw) {
  const seen = new Set();
  const stages = String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => STAGE_CATALOG[s] && !seen.has(s) && seen.add(s));

  if (!stages.length) return [];
  // The originator is implicit whether or not it was stored, and it is always first - an
  // approver cannot precede the person who submitted.
  return ['originator', ...stages.filter((s) => s !== 'originator')];
}

/** The approver steps, in order, with their roles. Excludes the originator. */
export function approverStages(stages) {
  return stages
    .filter((s) => s !== 'originator' && STAGE_CATALOG[s]?.role)
    .map((s) => ({ stage: s, role: STAGE_CATALOG[s].role }));
}

/** The stage an idea enters review at, or null when nobody approves anything. */
export function firstStage(stages) {
  return approverStages(stages)[0] || null;
}

/** The stage that closes an idea. */
export function finalStage(stages) {
  const a = approverStages(stages);
  return a[a.length - 1] || null;
}

/** The stage after `key`, or null if `key` is the last one. */
export function nextStage(stages, key) {
  const approvers = approverStages(stages);
  if (!approvers.length) return null;

  const i = approvers.findIndex((a) => a.stage === key);
  if (i >= 0) return approvers[i + 1] || null;

  // The stage was removed from the chain. Fall back to catalogue order.
  const removedAt = STAGE_KEYS.indexOf(key);
  if (removedAt >= 0) {
    const after = approvers.find((a) => STAGE_KEYS.indexOf(a.stage) > removedAt);
    if (after) return after;
    // Everything that used to follow it is gone too - it was effectively the last stage, so
    // the idea is finished.
    return null;
  }

  return approvers[0];
}

/** Is this the stage that closes the idea? */
export function isFinalStage(stages, key) {
  const f = finalStage(stages);
  if (!f) return true;                 // no approvers configured at all
  if (f.stage === key) return true;
  // A removed stage is final only if nothing in the chain follows it.
  return approverStages(stages).some((a) => a.stage === key) ? false : nextStage(stages, key) === null;
}

/** The stage(s) a given role may act at, in chain order. */
export function stagesForRole(stages, role) {
  return approverStages(stages).filter((a) => a.role === role).map((a) => a.stage);
}

/** How senior each role is, as one ordered scale. */
export function seniorityRanks(stages) {
  const order = [];
  for (const { role } of approverStages(stages)) {
    if (!order.includes(role)) order.push(role);
  }
  // Everything the catalogue knows about that this chain does not use.
  for (const key of STAGE_KEYS) {
    const role = STAGE_CATALOG[key].role;
    if (role && !order.includes(role)) order.push(role);
  }
  return new Map(order.map((role, i) => [role, i]));
}

/** Where `role` sits on that scale; -1 for a role with no approval standing. */
export function rankOf(ranks, role) {
  return ranks.has(role) ? ranks.get(role) : -1;
}

/** 1-based position of a stage among the approvers, for display. */
export function stagePosition(stages, key) {
  const i = approverStages(stages).findIndex((a) => a.stage === key);
  return i < 0 ? 0 : i + 1;
}

/** Display names for the stages, with a tenant's overrides applied. */
export function resolveLabels(raw) {
  const out = {};
  for (const [key, spec] of Object.entries(STAGE_CATALOG)) out[key] = spec.label;

  if (!raw) return out;
  let custom = raw;
  if (typeof raw === 'string') {
    try {
      custom = JSON.parse(raw);
    } catch {
      return out;
    }
  }
  if (!custom || typeof custom !== 'object') return out;

  for (const [key, name] of Object.entries(custom)) {
    const trimmed = String(name ?? '').trim();
    if (STAGE_CATALOG[key] && trimmed) out[key] = trimmed.slice(0, 60);
  }
  return out;
}

/** Derive { reviewer_roles, final_roles } from an ordered stage list. */
export function stagesToChain(stages) {
  const approvers = approverStages(stages);
  if (!approvers.length) return null;

  const finalRole = approvers[approvers.length - 1].role;
  const reviewerRoles = [...new Set(approvers.slice(0, -1).map((a) => a.role))]
    .filter((r) => r !== finalRole);

  return { reviewer_roles: reviewerRoles, final_roles: [finalRole] };
}

/** The chain a tenant falls back to when it has stored nothing usable. */
export const DEFAULT_CHAIN = stagesToChain(DEFAULT_STAGES);

export default {
  STAGE_CATALOG, STAGE_KEYS, DEFAULT_STAGES, DEFAULT_CHAIN,
  parseStages, approverStages, stagesToChain,
  firstStage, finalStage, nextStage, isFinalStage, stagesForRole, stagePosition,
  seniorityRanks, rankOf,
  resolveLabels,
};

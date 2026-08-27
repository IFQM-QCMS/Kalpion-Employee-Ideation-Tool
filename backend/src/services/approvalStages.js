/**
 * The approval chain: an ORDERED list of named stages, and the rules for
 * walking an idea along it.
 *
 * ── What this replaced, and why it was wrong ────────────────────────────────
 *
 * The chain used to be flattened into two role lists — `reviewer_roles` and
 * `final_roles` — and the engine then walked the REPORTING TREE (manager_id)
 * rather than the list. Approving escalated to your own manager if their role
 * happened to be somewhere in the chain, and if it was not, or you had no
 * manager on file, the idea fell straight through to Approved.
 *
 * So an organisation whose chain read
 *
 *     originator → team lead → immediate manager → department manager → plant head
 *
 * did not get that. A team lead with no manager_id, or whose manager was a
 * department manager, approved the idea outright or skipped two stages. The
 * configured chain described a journey the engine never took, and the failure
 * looked like the setting being ignored rather than a different chain being
 * run. Flattening also lost the order entirely: two stages sharing a role
 * collapsed into one, and `final_roles` was whichever role happened to be last
 * after de-duplication.
 *
 * The list is now the authority. An idea records the stage it is waiting at,
 * approving advances it to the NEXT stage in that list, and only approval at
 * the LAST stage sets the idea Approved. The reporting tree is still the org
 * chart — it is no longer the approval sequence.
 *
 * ── Per tenant, and only that tenant ───────────────────────────────────────
 *
 * The stage list and the labels both live in the tenant's own `org_settings`,
 * which is a table inside that tenant's own database. There is no shared row
 * and no cross-tenant read: changing one organisation's chain cannot affect
 * another's, and it applies to every user of that organisation the moment it
 * is saved, because the engine reads it per request rather than caching it.
 */

/**
 * Stage key → the users.role a person must hold to act at that stage.
 *
 * The KEY is the stable identifier stored in settings and on the idea row; the
 * displayed name is a label, which an organisation can change (see
 * `resolveLabels`). Renaming "Team Lead" to "Shift Incharge" must not rewrite
 * stored data or break an idea mid-flight, which is why the two are separate.
 *
 * Listed junior → senior, because that is the order an admin builds a chain in.
 *
 * `immediate_manager` maps to plain `manager`: it is the submitter's own line
 * manager, a level in the reporting tree rather than a distinct job title.
 */
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

/** The stage an idea enters review at, or null when nobody approves anything. */
export function firstStage(stages) {
  return approverStages(stages)[0] || null;
}

/** The stage that closes an idea. */
export function finalStage(stages) {
  const a = approverStages(stages);
  return a[a.length - 1] || null;
}

/**
 * The stage after `key`, or null if `key` is the last one.
 *
 * ── When the stage is not in the list any more ────────────────────────────
 *
 * An administrator can remove a stage while ideas are sitting at it. Those
 * ideas must not be stranded and must not silently jump to Approved, so the
 * position is recovered from the ORIGINAL ordering: the next stage that is
 * still in the chain and would have come after the missing one.
 *
 * `previousStages` is the chain as it was when the idea reached its stage; in
 * practice the caller passes the catalogue order, which is stable. If nothing
 * can be recovered the idea restarts at the first stage rather than skipping
 * ahead — a repeated approval is recoverable, an approval that never happened
 * is not.
 */
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
    // Everything that used to follow it is gone too — it was effectively the
    // last stage, so the idea is finished.
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

/** 1-based position of a stage among the approvers, for display. */
export function stagePosition(stages, key) {
  const i = approverStages(stages).findIndex((a) => a.stage === key);
  return i < 0 ? 0 : i + 1;
}

/**
 * Display names for the stages, with a tenant's overrides applied.
 *
 * Stored as JSON in org_settings.approval_stage_labels: { stage_key: "name" }.
 * Only the stages an organisation actually renamed appear there; everything
 * else falls back to the catalogue name, so adding a stage to the catalogue
 * later does not require every tenant to be updated.
 *
 * Bad JSON is ignored rather than thrown: a settings row that cannot be parsed
 * must not take down the review queue, and the built-in names are always a
 * correct answer.
 */
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

/**
 * Derive { reviewer_roles, final_roles } from an ordered stage list.
 *
 * Kept because several read-only callers — the review queue's org-wide branch,
 * the settings response, the PDF — still ask "which roles are involved at all".
 * It is NO LONGER what decides the sequence: the ordered list is. Anything that
 * needs to know what comes next must use nextStage().
 */
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
  resolveLabels,
};

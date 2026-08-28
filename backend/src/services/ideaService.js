/**
 * Idea service — Node port of PHP api/ideas.php (idea lifecycle + workflow).
 *
 * Actions ported here: list, my, review, get, submit, draft, review_action,
 * dashboard, assign_reviewers, reviewer_decision, check_duplicate, bulk_review,
 * update_roi, update_implementation.
 *
 * Deferred to Module 4 (Voting), where they belong: board, community_vote
 * (they physically live in ideas.php but are community-voting features).
 *
 * SQL, role scoping, workflow/escalation rules, points, notifications, emails,
 * and status transitions mirror the PHP exactly.
 *
 * Intentional migration difference: PHP wrapped user-provided name fields in
 * htmlspecialchars() (esc) before returning JSON, because the old vanilla-JS
 * frontend injected them via innerHTML. The React frontend escapes on render,
 * so we return raw values — applying esc() here would double-escape in React.
 * XSS protection thus moves from the server to React's automatic escaping.
 */
import config from '../config/index.js';
import { computeAIScoreWithReason } from './aiService.js';
import { getApprovalConfig, advanceStage, rolePlaysStages } from './settingsService.js';
import { getOrgSettings, queueEmail } from './mailerService.js';
import { generateIdeaCode, addNotification, addWorkflow, addPoints } from './coreHelpers.js';
import { badRequest, forbidden, notFound, ApiError } from '../utils/respond.js';
import logger from '../utils/logger.js';
import { IDEA_SECTIONS, employeeSections } from './ideaSections.js';

const POINTS = config.points;

const INDIVIDUAL_ROLES = ['trainee', 'employee'];
// department_manager sits with the other line roles: it sees its own reports'
// ideas. plant_head is org-wide, so it sits with the admin set and sees all of
// them — the same split executive already had.
const TEAM_ROLES = ['team_lead', 'project_lead', 'manager', 'department_manager', 'senior_manager'];
const ADMIN_ROLES = ['plant_head', 'executive', 'admin', 'super_admin'];
const PRIVILEGED_ANON = ['manager', 'department_manager', 'senior_manager', 'plant_head', 'executive', 'admin', 'super_admin'];

/**
 * Roles that may read an idea's full proposed solution. Everyone else — the
 * general employee population browsing All Ideas — sees a one-line summary.
 *
 * The reasoning: the solution IS the intellectual contribution. Publishing it
 * verbatim to the whole organisation the moment it is filed lets anyone restate
 * it as their own before the original is even reviewed, which quietly punishes
 * the people the leaderboard is meant to reward. The headline, impact, score
 * and status all stay public, so the pipeline is still transparent — only the
 * "how" is held back until a reviewer has it.
 */
const PRIVILEGED_SOLUTION = PRIVILEGED_ANON;

/**
 * MOM §14.5 — Time Required is a fixed three-band dropdown.
 * MOM §14.6 — solution category tags.
 * Both are validated against these lists rather than stored as free text, so a
 * typo cannot create a fourth band or a one-off tag that breaks every filter.
 */
export const TIME_REQUIRED_BANDS = ['lt_3m', '3_6m', '6_12m'];
export const SOLUTION_TAGS = ['process_improvement', 'quality', 'cost', 'delivery'];

/** MOM §13.10 — patentability, a separate axis from approval status. */
export const PATENTABILITY_VALUES = [
  'not_assessed', 'not_patentable', 'possible', 'recommended', 'filed',
];

/**
 * MOM §13.1 — solution visibility is now the organisation's choice, not a
 * constant. `everyone` restores the pre-MOM behaviour; `managers_only` is the
 * strictest, hiding the text from peers entirely.
 *
 * Reading the org setting costs one cached settings lookup per request, which
 * the callers already perform for other reasons.
 */
/**
 * MOM §14.10 — who may read the AI's assessment of an idea.
 *
 * Voting itself stays open to everyone; that was never in question. What the
 * minutes flag is the *prediction*: the machine's score reasoning, which reads
 * as a verdict on somebody's idea before a human has looked at it. Shown to the
 * whole floor it discourages people whose first attempt scored badly, which is
 * the opposite of what a suggestion scheme is for.
 *
 * The minutes say "confirm scope", so this is a setting rather than a guess.
 * The default is the cautious reading — managers and above — and an
 * organisation that disagrees can open it up without a code change.
 */
function predictionMode(settings) {
  const v = String(settings?.prediction_visibility ?? 'seniors');
  return ['seniors', 'everyone'].includes(v) ? v : 'seniors';
}

/**
 * Hide the AI reasoning from people not entitled to it. The score itself stays
 * visible — it is a sorting aid and removing it would make the list unreadable.
 * Only the written justification is held back.
 */
export function safeUid(user) {
  if (!user || user.id === undefined || user.id === null) return 0;
  const cleaned = String(user.id).replace(/\D/g, '');
  const num = parseInt(cleaned, 10);
  return Number.isFinite(num) ? num : 0;
}

function redactPrediction(user, idea, mode) {
  if (mode === 'everyone') { idea.prediction_hidden = false; return idea; }
  const uid = safeUid(user);
  if (Number(idea.submitter_id) === uid || PRIVILEGED_SOLUTION.includes(user.role)) {
    idea.prediction_hidden = false;
    return idea;
  }
  idea.ai_reason = null;
  idea.prediction_hidden = true;
  return idea;
}

export function visibilityMode(settings) {
  const v = String(settings?.solution_visibility ?? 'authors_reviewers');
  return ['authors_reviewers', 'managers_only', 'everyone'].includes(v) ? v : 'authors_reviewers';
}

/**
 * First sentence of a solution, or a hard-truncated opening — whichever is
 * shorter. Never returns a fragment that runs to the character limit without
 * an ellipsis, so a summary is always visibly a summary.
 */
export function summariseSolution(text, limit = 140) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const sentenceEnd = clean.search(/[.!?](\s|$)/);
  if (sentenceEnd > 0 && sentenceEnd + 1 <= limit) return clean.slice(0, sentenceEnd + 1);
  if (clean.length <= limit) return clean;
  // Cut on a word boundary so the preview does not end mid-word.
  const cut = clean.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

/**
 * Trim a problem statement down to an extract.
 *
 * The solution was already held back from uninvolved colleagues, but the
 * situation was not - and a well-written situation often contains the whole
 * insight. Somebody who reads "we scrap 40 units a shift because the fixture
 * shifts after 200 cycles" has the idea, whether or not they can see the
 * proposed fix.
 *
 * Cuts on a sentence boundary where one is close enough, otherwise on a word
 * boundary, so an extract is never a fragment ending mid-word.
 */
export function previewText(text, limit = 180) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length <= limit) return clean;
  const window = clean.slice(0, limit);
  const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
  if (lastStop > limit * 0.5) return clean.slice(0, lastStop + 1);
  const lastSpace = window.lastIndexOf(' ');
  return (lastSpace > limit * 0.6 ? window.slice(0, lastSpace) : window).trimEnd() + '…';
}

/*
 * Strip the sections this organisation does not let ordinary colleagues see.
 *
 * Called only for viewers who are already outside the idea. It empties fields
 * rather than deleting them, and records what was withheld in `hidden_sections`
 * so the screen can say "your organisation does not show this" instead of
 * rendering what looks like an idea nobody bothered to fill in.
 */
function applySectionVisibility(idea, allowed) {
  const hidden = IDEA_SECTIONS.filter((x) => !allowed.includes(x));
  if (!hidden.length) { idea.hidden_sections = []; return idea; }

  for (const section of hidden) {
    switch (section) {
      case 'situation':
        idea.present_situation = null;
        idea.situation_summary = null;
        break;
      case 'solution':
        idea.proposed_solution = null;
        idea.solution_summary = null;
        break;
      case 'benefits':
        idea.tangible_benefit = null;
        idea.intangible_benefit = null;
        // These two are benefit text under different column names. Leaving them
        // behind meant the section looked closed on screen while the export
        // still printed it.
        idea.benefits_expected = null;
        idea.support_required = null;
        break;
      case 'business_case':
        idea.investment_required = null;
        idea.feasibility = null;
        idea.implementation_duration = null;
        idea.expected_implementation_date = null;
        idea.time_required = null;
        idea.roi_value = null;
        idea.roi_type = null;
        idea.roi_note = null;
        idea.implementation_status = null;
        idea.implementation_note = null;
        break;
      case 'attachments':
        idea.attachments = [];
        break;
      case 'co_suggesters':
        idea.co_suggesters = [];
        idea.co_suggesters_display = '';
        idea.co1_name = null;
        idea.co2_name = null;
        break;
      case 'timeline':
        idea.workflow = [];
        idea.reviewers = [];
        break;
      // 'comments' is served by its own endpoint; see commentService.
      default:
        break;
    }
  }
  idea.hidden_sections = hidden;
  return idea;
}

/**
 * Is this person inside this idea?
 *
 * Inside means: they wrote it, they are credited on it, they have been asked to
 * decide on it, or they are senior enough that deciding on ideas is their job.
 * Everybody else is a bystander - entitled to know the idea exists and roughly
 * what it is about, and nothing more.
 *
 * The same question drives three separate decisions, so it is answered once:
 * how much text the server sends, which sections it strips, and whether the
 * screen offers a "view full idea" button at all. Answering it three times in
 * three places is how they drift apart.
 *
 * Deliberately does NOT consider solution_visibility. That setting governs how
 * much text a bystander receives; it does not make them a participant.
 */
export function isInsideIdea(user, idea) {
  const uid = Number(user?.id);
  if (!uid) return false;
  if (PRIVILEGED_SOLUTION.includes(user.role)) return true;
  if (Number(idea.submitter_id) === uid) return true;
  if (Number(idea.co_suggester_1_id) === uid || Number(idea.co_suggester_2_id) === uid) return true;
  if (Number(idea.current_reviewer_id) === uid) return true;
  // Populated by get(); absent on list rows, where the four checks above are
  // what the list query can answer.
  if ((idea.reviewers || []).some((r) => Number(r.reviewer_id) === uid)) return true;
  if ((idea.co_suggesters || []).some((c) => Number(c.id) === uid)) return true;
  return false;
}

/**
 * May this viewer read the full solution of this idea?
 * The author and their co-suggesters always can; so can whoever has to judge it.
 */
export function canReadSolution(user, idea, mode = 'authors_reviewers') {
  const uid = Number(user.id);
  // The author always sees their own proposal, in every mode. A setting that
  // could hide someone's own writing from them would be a bug, not a policy.
  if (Number(idea.submitter_id) === uid) return true;
  if (mode === 'everyone') return true;
  if (PRIVILEGED_SOLUTION.includes(user.role)) return true;
  if (mode === 'managers_only') return false;
  if (Number(idea.co_suggester_1_id) === uid || Number(idea.co_suggester_2_id) === uid) return true;
  if (Number(idea.current_reviewer_id) === uid) return true;
  return false;
}

/**
 * Replace the full solution with a summary unless the viewer is entitled to it.
 * Mutates and returns the row. `solution_redacted` lets the UI say why the text
 * is short instead of looking like the field was left empty.
 */
function redactSolution(user, idea, mode = 'authors_reviewers', previewChars = 180) {
  idea.solution_summary = summariseSolution(idea.proposed_solution);
  if (!canReadSolution(user, idea, mode)) {
    idea.proposed_solution = null;
    idea.solution_redacted = true;
    // The situation goes the same way. Whoever may not read the fix may not
    // read the whole problem either - only enough to know what it is about.
    idea.situation_summary = previewText(idea.present_situation, previewChars);
    idea.present_situation = null;
    idea.situation_redacted = true;
  } else {
    idea.solution_redacted = false;
    idea.situation_summary = previewText(idea.present_situation, previewChars);
    idea.situation_redacted = false;
  }
  return idea;
}

// ── LIST ────────────────────────────────────────────────────────────
export async function list(db, user, { status, search, impact, archived, tag, time_required: timeReq } = {}) {
  const where = [];
  const params = [];

  /*
   * Archived ideas are hidden unless explicitly asked for (MOM §13.2). This is
   * a filter, not a delete: the points already awarded, the workflow history and
   * the ROI figures all survive, which is exactly why archiving exists instead
   * of a delete button.
   */
  if (String(archived) === '1' || archived === true) {
    where.push('i.archived_at IS NOT NULL');
  } else if (String(archived) !== 'all') {
    where.push('i.archived_at IS NULL');
  }

  // §14.6 — filter by solution tag. Matched on the CSV with delimiters on both
  // sides so `cost` cannot match `cost_saving`.
  if (tag && SOLUTION_TAGS.includes(tag)) {
    where.push("CONCAT(',', IFNULL(i.solution_tags,''), ',') LIKE ?");
    params.push(`%,${tag},%`);
  }

  if (timeReq && TIME_REQUIRED_BANDS.includes(timeReq)) {
    where.push('i.time_required = ?');
    params.push(timeReq);
  }

  if (INDIVIDUAL_ROLES.includes(user.role)) {
    where.push('(i.submitter_id = ? OR i.co_suggester_1_id = ? OR i.co_suggester_2_id = ?)');
    params.push(user.id, user.id, user.id);
  } else if (TEAM_ROLES.includes(user.role)) {
    where.push('(i.submitter_id IN (SELECT id FROM users WHERE manager_id = ?) OR i.submitter_id = ?)');
    params.push(user.id, user.id);
  }

  if (status) { where.push('i.status = ?'); params.push(status); }
  if (search) { where.push('(i.title LIKE ? OR i.idea_code LIKE ?)'); const s = `%${search}%`; params.push(s, s); }
  if (impact) { where.push('i.impact_level = ?'); params.push(impact); }

  const uid = Number(user.id);
  const paramsList = [uid, ...params];
  const sql =
    `SELECT i.*, u.name AS submitter_name, u.department, u.avatar_initials,
            c1.name AS co1_name, c2.name AS co2_name,
            (SELECT COUNT(*) FROM idea_votes WHERE idea_id=i.id) AS vote_count,
            (SELECT ROUND(AVG(rating),1) FROM idea_votes WHERE idea_id=i.id) AS avg_rating,
            (SELECT vote_type FROM idea_community_votes WHERE idea_id=i.id AND user_id=?) AS user_community_vote
     FROM ideas i
     JOIN users u ON u.id = i.submitter_id
     LEFT JOIN users c1 ON c1.id = i.co_suggester_1_id
     LEFT JOIN users c2 ON c2.id = i.co_suggester_2_id` +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY i.updated_at DESC LIMIT 100';

  const [ideas] = await db.execute(sql, paramsList);

  const canSeeAnon = PRIVILEGED_ANON.includes(user.role);
  const settings = await getOrgSettings(db);
  const mode = visibilityMode(settings);
  const predMode = predictionMode(settings);
  const previewChars = parseInt(settings.situation_preview_chars, 10) || 180;
  const listSections = employeeSections(settings);
  for (const idea of ideas) {
    if (!canSeeAnon && idea.is_anonymous) {
      idea.submitter_name = 'Anonymous';
      idea.avatar_initials = '?';
      idea.department = '—';
    }
    // The browse list never carries a full solution over the wire, even for
    // people entitled to read one — they get it from the detail endpoint. A
    // hundred rows of verbatim proposals sitting in the browser is exactly the
    // leak this is meant to close, and it is invisible to anyone reading only
    // the rendered table.
    // Whether this person is a participant in this idea, not merely allowed to
    // read some of it. The screens use it to decide whether to offer a full
    // view at all, rather than offering one that opens a mostly-empty overlay.
    idea.viewer_inside = isInsideIdea(user, idea);
    redactSolution(user, idea, mode, previewChars);
    // The browse list shows a one-line gist. If the organisation does not let
    // ordinary colleagues read even that, the column has to be empty for them.
    if (idea.solution_redacted && !listSections.includes('solution')) {
      idea.solution_summary = null;
      idea.solution_hidden_by_policy = true;
    }
    redactPrediction(user, idea, predMode);
    // Neither full text ever travels with a browse list, for anybody.
    idea.proposed_solution = null;
    idea.present_situation = null;
  }
  return { success: true, ideas };
}

// ── MY ──────────────────────────────────────────────────────────────
export async function my(db, user) {
  const uid = Number(user.id);
  const [ideas] = await db.execute(
    `SELECT i.*, c1.name AS co1_name, c2.name AS co2_name,
            (SELECT COUNT(*) FROM idea_votes WHERE idea_id=i.id) AS vote_count,
            (SELECT ROUND(AVG(rating),1) FROM idea_votes WHERE idea_id=i.id) AS avg_rating,
            (SELECT vote_type FROM idea_community_votes WHERE idea_id=i.id AND user_id=?) AS user_community_vote
     FROM ideas i
     LEFT JOIN users c1 ON c1.id = i.co_suggester_1_id
     LEFT JOIN users c2 ON c2.id = i.co_suggester_2_id
     WHERE i.submitter_id = ? OR i.co_suggester_1_id = ? OR i.co_suggester_2_id = ?
     ORDER BY i.updated_at DESC`,
    [uid, uid, uid, uid]
  );
  return { success: true, ideas };
}

/**
 * Move ideas that are waiting on somebody who does not exist.
 *
 * ── Why this is needed even though submit and approve both skip ──────────
 *
 * Those two only run when somebody acts. An idea can become unactionable
 * without anybody acting at all:
 *
 *   • the only holder of its stage leaves and is deactivated;
 *   • an administrator edits the chain and the idea's stage is now filled by
 *     nobody;
 *   • a migration placed it at a stage that was correct under the old chain.
 *
 * The last one is not hypothetical — it is how six ideas came to be sitting at
 * `immediate_manager` in a tenant with no manager, invisible to every queue in
 * the product and unable to move, because moving requires an approval and
 * approving requires somebody who can.
 *
 * ── Where it searches from ─────────────────────────────────────────────────
 *
 * An idea that has never been approved by anyone restarts from the beginning of
 * the chain: it has not passed those stages, it was merely placed past them, so
 * beginning again is a correction rather than a repetition.
 *
 * An idea that HAS approvals searches forward only. Sending it back would ask
 * people to approve something they already approved, and would let a chain edit
 * silently undo decisions that were properly made.
 *
 * Nothing is ever approved by this. An idea with nowhere to go stays where it
 * is and the administrators are told.
 */
export async function repairStrandedIdeas(db) {
  const cfg = await getApprovalConfig(db);
  if (!cfg.approvers.length) return { checked: 0, moved: 0, stranded: 0 };

  const [rows] = await db.execute(
    `SELECT i.id, i.idea_code, i.title, i.submitter_id, i.current_stage,
            (SELECT COUNT(*) FROM idea_workflow w
              WHERE w.idea_id = i.id AND w.action = 'Approved') AS approvals
       FROM ideas i
      WHERE i.status IN ('Submitted','Under Review')
        AND COALESCE(i.workflow_type,'hierarchical') = 'hierarchical'`
  );
  if (!rows.length) return { checked: 0, moved: 0, stranded: 0 };

  // One lookup for the whole pass rather than one per idea.
  const roles = [...new Set(cfg.approvers.map((a) => a.role))];
  const [holders] = await db.query(
    `SELECT role, COUNT(*) n FROM users
      WHERE status = 'active' AND role IN (?) GROUP BY role`, [roles]);
  const held = Object.fromEntries(holders.map((h) => [h.role, Number(h.n)]));

  const actionable = (stage, submitterId) => {
    const spec = cfg.approvers.find((a) => a.stage === stage);
    if (!spec) return false;
    /*
     * One holder who happens to be the author is the same as none: nobody may
     * approve their own idea. Counting rather than querying per idea would get
     * this wrong, so the single-holder case is checked exactly.
     */
    return (held[spec.role] || 0) > 0;
  };

  let moved = 0;
  let stranded = 0;

  for (const idea of rows) {
    if (idea.current_stage && actionable(idea.current_stage, idea.submitter_id)) continue;

    const from = Number(idea.approvals) > 0 && idea.current_stage
      ? idea.current_stage
      : cfg.approvers[0].stage;

    const resolved = await resolveActionableStage(db, cfg, from, idea.submitter_id);

    if (resolved.stranded || !resolved.stage) {
      stranded++;
      continue;
    }
    if (resolved.stage === idea.current_stage) continue;

    const position = cfg.approvers.findIndex((a) => a.stage === resolved.stage) + 1;
    await db.execute(
      `UPDATE ideas SET current_stage = ?, current_reviewer_id = ?, escalation_level = ?, updated_at = NOW()
        WHERE id = ?`,
      [resolved.stage, resolved.assignee ? resolved.assignee.id : null, position, idea.id]
    );

    const was = idea.current_stage ? (cfg.labels[idea.current_stage] || idea.current_stage) : 'no stage';
    const now = cfg.labels[resolved.stage] || resolved.stage;
    logger.info(`idea ${idea.idea_code}: moved from ${was} to ${now} — nobody could act at ${was}`);
    moved++;
  }

  if (moved || stranded) {
    logger.info(`approval repair: ${moved} idea(s) moved, ${stranded} still with nobody to act`);
  }
  return { checked: rows.length, moved, stranded };
}

// ── REVIEW QUEUE ────────────────────────────────────────────────────
/**
 * The chain, in a shape the browser can render without knowing the rules.
 *
 * The queue used to return ideas and nothing else, so the screen could show
 * that an idea was "Under Review" but not what it was waiting FOR, who had it,
 * or what approving would do next. A reviewer pressing Approve could not tell
 * whether they were sending it onward or closing it — which is the single most
 * consequential thing about the button they are pressing.
 *
 * Sent per request rather than cached in the client, because an administrator
 * can change the chain at any moment and a stale copy would describe a journey
 * the server is no longer taking.
 */
function chainSummary(cfg, role) {
  const steps = cfg.approvers.map((a, i) => ({
    stage: a.stage,
    label: cfg.labels[a.stage] || a.stage,
    role: a.role,
    position: i + 1,
    is_final: i === cfg.approvers.length - 1,
    is_mine: a.role === role,
  }));
  return { total: steps.length, steps };
}

export async function review(db, user) {
  const uid = Number(user.id);
  const cfg = await getApprovalConfig(db);

  /*
   * ── What is waiting on me ───────────────────────────────────────────────
   *
   * The stages my role plays in THIS organisation's chain, and the ideas
   * sitting at one of them.
   *
   * This used to match on `current_reviewer_id = me OR (unassigned AND I am the
   * submitter's manager)`, which had two consequences. An idea assigned to one
   * holder of a role was invisible to every other holder of the same role, so a
   * reviewer on leave stopped the chain; and an unassigned idea was offered to
   * the submitter's manager whatever role that manager held, which is the
   * reporting tree deciding the approval sequence again.
   *
   * Matching on the stage fixes both. Anybody holding the role the idea is
   * waiting on can act, and nobody else sees it.
   */
  const myStages = rolePlaysStages(cfg, user.role);

  if (myStages.length) {
    const placeholders = myStages.map(() => '?').join(',');
    const sql =
      `SELECT DISTINCT i.*, u.name AS submitter_name, u.department, u.avatar_initials,
              ir.decision AS my_reviewer_decision,
              (SELECT COUNT(*) FROM idea_votes WHERE idea_id=i.id) AS vote_count,
              (SELECT ROUND(AVG(rating),1) FROM idea_votes WHERE idea_id=i.id) AS avg_rating,
              (SELECT COUNT(*) FROM idea_reviewers WHERE idea_id=i.id) AS reviewer_count,
              (SELECT COUNT(*) FROM idea_reviewers WHERE idea_id=i.id AND decision='approved') AS approved_count,
              (SELECT COUNT(*) FROM idea_reviewers WHERE idea_id=i.id AND decision='rejected') AS rejected_count,
              (SELECT vote_type FROM idea_community_votes WHERE idea_id=i.id AND user_id=?) AS user_community_vote
       FROM ideas i
       JOIN users u ON u.id = i.submitter_id
       LEFT JOIN idea_reviewers ir ON ir.idea_id = i.id AND ir.reviewer_id = ?
       WHERE i.status IN ('Submitted','Under Review')
         AND i.submitter_id <> ?
         AND ((COALESCE(i.workflow_type,'hierarchical') = 'hierarchical'
               AND i.current_stage IN (${placeholders}))
              OR (i.workflow_type = 'multi_reviewer' AND ir.decision = 'pending'))
       ORDER BY i.review_due_date ASC, i.ai_score DESC, i.submitted_at ASC`;
    const [ideas] = await db.execute(sql, [uid, uid, uid, ...myStages]);
    return { success: true, ideas, chain: chainSummary(cfg, user.role) };
  }

  /*
   * The org-wide queue, for the people whose remit actually is org-wide.
   *
   * This used to be a bare `else`, so any role that was not in reviewer_roles
   * landed here — including roles the organisation had deliberately left out of
   * its chain. A team lead excluded from a manager-and-above chain did not get
   * an empty queue; they got EVERY idea in the organisation, which is both more
   * than they should see and the reason they were able to act on them.
   *
   * Someone outside the chain now gets an empty queue, which is the honest
   * answer: there is nothing waiting on them.
   */
  const orgWideRoles = [...new Set([...ADMIN_ROLES, ...cfg.final_roles])];
  if (!orgWideRoles.includes(user.role)) {
    return { success: true, ideas: [] };
  }

  const [ideas] = await db.execute(
    `SELECT DISTINCT i.*, u.name AS submitter_name, u.department, u.avatar_initials,
            (SELECT COUNT(*) FROM idea_votes WHERE idea_id=i.id) AS vote_count,
            (SELECT ROUND(AVG(rating),1) FROM idea_votes WHERE idea_id=i.id) AS avg_rating,
            (SELECT COUNT(*) FROM idea_reviewers WHERE idea_id=i.id) AS reviewer_count,
            (SELECT COUNT(*) FROM idea_reviewers WHERE idea_id=i.id AND decision='approved') AS approved_count,
            (SELECT COUNT(*) FROM idea_reviewers WHERE idea_id=i.id AND decision='rejected') AS rejected_count,
            (SELECT vote_type FROM idea_community_votes WHERE idea_id=i.id AND user_id=?) AS user_community_vote
     FROM ideas i
     JOIN users u ON u.id = i.submitter_id
     WHERE i.status IN ('Submitted','Under Review')
     ORDER BY i.review_due_date ASC, i.ai_score DESC, i.submitted_at ASC`,
    [uid]
  );
  return { success: true, ideas };
}

// ── GET single ──────────────────────────────────────────────────────
export async function get(db, user, id) {
  id = Number(id) || 0;
  const uid = Number(user.id);

  const [rows] = await db.execute(
    `SELECT i.*, u.name AS submitter_name, u.department, u.business_unit,
            u.avatar_initials, u.email AS submitter_email,
            c1.name AS co1_name, c2.name AS co2_name,
            m.name AS manager_name,
            (SELECT COUNT(*) FROM idea_votes WHERE idea_id=i.id) AS vote_count,
            (SELECT ROUND(AVG(rating),1) FROM idea_votes WHERE idea_id=i.id) AS avg_rating,
            (SELECT vote_type FROM idea_community_votes WHERE idea_id=i.id AND user_id=?) AS user_community_vote
     FROM ideas i
     JOIN  users u  ON u.id  = i.submitter_id
     LEFT JOIN users c1 ON c1.id = i.co_suggester_1_id
     LEFT JOIN users c2 ON c2.id = i.co_suggester_2_id
     LEFT JOIN users m  ON m.id  = u.manager_id
     WHERE i.id = ?`,
    [uid, id]
  );
  const idea = rows[0];
  if (!idea) throw notFound('Idea not found');

  const [att] = await db.execute('SELECT * FROM idea_attachments WHERE idea_id = ?', [id]);
  idea.attachments = att;

  // Full co-suggester list (beyond the two legacy columns).
  const [cosug] = await db.execute(
    `SELECT cs.user_id AS id, u.name, u.employee_id
       FROM idea_co_suggesters cs JOIN users u ON u.id = cs.user_id
      WHERE cs.idea_id = ? ORDER BY cs.id`,
    [id]
  );
  idea.co_suggesters = cosug;
  idea.co_suggesters_display = cosug.map((c) => c.name).join(', ');

  const [wf] = await db.execute(
    `SELECT w.*, u.name AS actor_name, u.role AS actor_role
     FROM idea_workflow w JOIN users u ON u.id = w.actor_id
     WHERE w.idea_id = ? ORDER BY w.created_at ASC`,
    [id]
  );
  idea.workflow = wf;

  try {
    const [rv] = await db.execute(
      `SELECT ir.*, u.name AS reviewer_name, u.role AS reviewer_role,
              u.avatar_initials, u.department
       FROM idea_reviewers ir
       JOIN users u ON u.id = ir.reviewer_id
       WHERE ir.idea_id = ? ORDER BY ir.assigned_at ASC`,
      [id]
    );
    idea.reviewers = rv;
  } catch {
    idea.reviewers = [];
  }

  // Hold back the full proposal from colleagues who are neither its authors nor
  // its judges. Assigned reviewers count even when they are not the *current*
  // reviewer — in a multi-reviewer workflow every one of them has to read it.
  const detailSettings = await getOrgSettings(db);
  const mode = visibilityMode(detailSettings);
  const detailPreview = parseInt(detailSettings.situation_preview_chars, 10) || 180;
  const isAssignedReviewer = (idea.reviewers || []).some((r) => Number(r.reviewer_id) === uid);
  const isCoSuggester = (idea.co_suggesters || []).some((c) => Number(c.id) === uid);
  // An assigned reviewer or co-suggester reads the full text in every mode
  // except managers_only, which is the whole point of that mode.
  idea.viewer_inside = isInsideIdea(user, idea);
  if ((isAssignedReviewer || isCoSuggester) && mode !== 'managers_only') {
    idea.solution_summary = summariseSolution(idea.proposed_solution);
    idea.situation_summary = previewText(idea.present_situation, detailPreview);
    idea.solution_redacted = false;
    idea.situation_redacted = false;
    idea.hidden_sections = [];
  } else {
    redactSolution(user, idea, mode, detailPreview);
    // Somebody who could not be given the full text is by definition outside
    // this idea, so the organisation's section rules apply to them.
    if (idea.solution_redacted) {
      applySectionVisibility(idea, employeeSections(detailSettings));
    } else {
      idea.hidden_sections = [];
    }
  }
  redactPrediction(user, idea, predictionMode(detailSettings));

  /*
   * MOM §13.13 — "Under review by ___" as one readable line, rather than making
   * the viewer reconstruct it from the workflow timeline. Multi-reviewer ideas
   * name everyone still outstanding; hierarchical ones name the single current
   * reviewer. A closed idea reports its outcome instead.
   */
  idea.review_stage = (() => {
    if (['Approved', 'Rejected', 'Implemented'].includes(idea.status)) {
      return { state: 'closed', status: idea.status, names: [] };
    }
    if (idea.status === 'Draft') return { state: 'draft', names: [] };
    const pending = (idea.reviewers || []).filter((r) => !r.decision || r.decision === 'pending');
    if (pending.length) {
      return { state: 'pending', names: pending.map((r) => r.reviewer_name).filter(Boolean) };
    }
    const current = (idea.reviewers || []).find((r) => Number(r.reviewer_id) === Number(idea.current_reviewer_id));
    const name = current?.reviewer_name || idea.current_reviewer_name || null;
    return { state: name ? 'pending' : 'unassigned', names: name ? [name] : [] };
  })();

  // Mask anonymous submitter for non-privileged roles (own idea always visible)
  const canSeeAnon = PRIVILEGED_ANON.includes(user.role);
  if (!canSeeAnon && idea.is_anonymous && Number(idea.submitter_id) !== uid) {
    idea.submitter_name = 'Anonymous';
    idea.submitter_email = null;
    idea.avatar_initials = '?';
    idea.department = '—';
    idea.business_unit = '—';
    idea.manager_name = null;

    // The header fields are not the only place the author's name appears. The
    // approval timeline carries an actor name on every entry — starting with
    // the submitter's own "Submitted" row — and the co-suggester list names the
    // people who raised it with them. Masking the header alone still told any
    // colleague exactly who filed the anonymous report.
    idea.workflow = (idea.workflow || []).map((w) => (
      Number(w.actor_id) === Number(idea.submitter_id)
        ? { ...w, actor_name: 'Anonymous', actor_role: null }
        : w
    ));
    idea.co_suggesters = [];
    idea.co_suggesters_display = '';
    idea.co1_name = null;
    idea.co2_name = null;
  }

  return { success: true, idea };
}

// ── SUBMIT / SAVE DRAFT ─────────────────────────────────────────────
export async function submitOrDraft(db, user, action, b) {
  const title = String(b.title ?? '').trim();
  const sit = String(b.present_situation ?? '').trim();
  const sol = String(b.proposed_solution ?? '').trim();
  const impacts = String(b.impact_areas ?? '').trim();
  const impLvl = b.impact_level ?? 'Medium';
  const tangible = String(b.tangible_benefit ?? '').trim();
  const intang = String(b.intangible_benefit ?? '').trim();
  // Co-suggesters: accept a full array (co_suggester_ids) OR the two legacy
  // fields. The first two are mirrored into the legacy ideas.co_suggester_*_id
  // columns (so existing read paths keep working); the complete list is written
  // to the idea_co_suggesters junction after the row is saved. Self-references
  // and duplicates are dropped.
  const rawCoIds = Array.isArray(b.co_suggester_ids)
    ? b.co_suggester_ids
    : [b.co_suggester_1_id, b.co_suggester_2_id];
  const coIds = [...new Set(rawCoIds.map((v) => Number(v)).filter((n) => n && n !== Number(user.id)))];
  const co1 = coIds[0] ?? null;
  const co2 = coIds[1] ?? null;
  const editId = b.id ? Number(b.id) : null;
  const isAnon = b.is_anonymous ? 1 : 0;
  const challengeId = b.challenge_id ? Number(b.challenge_id) : null;
  const templateType = String(b.template_type ?? '').trim() || null;

  /*
   * MOM §14.5 / §14.6. Both validated against a fixed list rather than stored as
   * typed: an unrecognised value becomes NULL instead of creating a fourth time
   * band or a one-off tag that every filter would then miss.
   */
  const timeRequired = TIME_REQUIRED_BANDS.includes(String(b.time_required ?? ''))
    ? String(b.time_required) : null;
  // Anyone may raise the flag - the submitter who thinks their idea is novel,
  // or a senior reviewing it. It records a claim; the organisation's own
  // assessment lives in `patentability` and is not touched here.
  const patentableFlag = (b.patentable_flag === true || b.patentable_flag === 1
    || b.patentable_flag === '1') ? 1 : 0;
  const solutionTags = [...new Set(
    (Array.isArray(b.solution_tags) ? b.solution_tags : String(b.solution_tags ?? '').split(','))
      .map((x) => String(x).trim())
      .filter((x) => SOLUTION_TAGS.includes(x))
  )].join(',') || null;

  /*
   * Business case. Every field is optional — a half-formed idea is still worth
   * capturing, and the reviewer can ask for the rest. Blank stays NULL rather
   * than becoming an empty string so "not answered" is distinguishable from
   * "answered with nothing" on the detail screen and in exports.
   */
  const investment = String(b.investment_required ?? '').trim().slice(0, 255) || null;
  const feasibilityIn = String(b.feasibility ?? '').trim();
  const feasibility = ['Low', 'Medium', 'High'].includes(feasibilityIn) ? feasibilityIn : null;
  const implDuration = String(b.implementation_duration ?? '').trim().slice(0, 120) || null;
  // A malformed date would be written as 0000-00-00 (or rejected outright in
  // strict mode); anything that is not a plain YYYY-MM-DD is simply not a date.
  const expectedDateIn = String(b.expected_implementation_date ?? '').trim();
  const expectedDate = /^\d{4}-\d{2}-\d{2}$/.test(expectedDateIn) ? expectedDateIn : null;
  const benefitsExpected = String(b.benefits_expected ?? '').trim() || null;
  const supportRequired = String(b.support_required ?? '').trim() || null;

  /*
   * The title column is VARCHAR(255) and only its PRESENCE was checked, so a
   * longer one travelled all the way to MySQL and came back as "Data too long
   * for column 'title'". That surfaced as a 500 — an internal error for what is
   * an ordinary validation failure, and a message the person typing could do
   * nothing with. Rejected here instead, saying what to do about it.
   *
   * Deliberately not truncated. `investment_required` above is sliced because
   * losing the tail of a free-text note is harmless; silently cutting somebody's
   * title changes what their idea is called without telling them.
   */
  if (title.length > 255) {
    throw badRequest(
      `The title is too long (${title.length} characters, limit 255). `
      + 'Keep it to one line - the detail belongs in the present situation and proposed solution.'
    );
  }
  if (!title || !sit || !sol) {
    throw badRequest('Title, present situation and proposed solution are required.');
  }

  let ai = { score: 50, reason: 'Evaluated by system.' };
  try {
    ai = await computeAIScoreWithReason({
      title, present_situation: sit, proposed_solution: sol,
      impact_areas: impacts, impact_level: impLvl,
      tangible_benefit: tangible, intangible_benefit: intang,
      co_suggester_1_id: co1, co_suggester_2_id: co2,
    });
  } catch {
    ai = { score: 50, reason: 'Evaluated by system.' };
  }
  const aiScore = ai.score;
  const aiReason = ai.reason;

  const status = action === 'submit' ? 'Submitted' : 'Draft';
  const submittedAt = action === 'submit' ? nowDateTime() : null;

  let reviewDueDate = null;
  let currentReviewerId = null;
  let currentStage = null;
  // Carried out of the block so the workflow note can be written after the row
  // exists — a skipped stage is only meaningful next to the idea it skipped.
  let submitStageNote = null;
  if (action === 'submit') {
    let slaDays = 7;
    try {
      const [srows] = await db.execute(
        "SELECT value FROM org_settings WHERE key_name='review_sla_days' LIMIT 1"
      );
      if (srows.length) slaDays = Math.max(1, parseInt(srows[0].value, 10) || 1);
    } catch { /* keep default */ }
    reviewDueDate = addDays(slaDays);

    /*
     * ── The idea enters the chain at stage one ────────────────────────────
     *
     * This used to set current_reviewer_id to the submitter's own manager and
     * nothing else, which is how the whole approval sequence came to be driven
     * by the reporting tree: the first reviewer was whoever the submitter
     * reported to, whatever role they held and wherever that sat in the
     * configured chain.
     *
     * The chain decides now. The idea starts at the first approver stage, and
     * a person is chosen because they HOLD THAT STAGE'S ROLE — preferring the
     * submitter's own manager when the manager happens to hold it, since an
     * idea is better read by somebody who knows the work.
     *
     * A stage with nobody in it leaves current_reviewer_id NULL. That is not a
     * failure: the review queue offers ideas to everyone holding the stage
     * role, so the idea is still actionable the moment somebody is given it.
     */
    const cfg = await getApprovalConfig(db);

    /*
     * Enter the chain at the first stage somebody can actually act on.
     *
     * Not simply the first stage. A chain routinely names roles an
     * organisation has not filled — on this platform, five of six tenants had
     * nobody in ANY approval role — and an idea parked at a stage with no
     * holder is invisible to every queue in the product. Skipping is recorded
     * on the idea below, so the trail says which step was passed and why.
     */
    if (cfg.first_stage) {
      const resolved = await resolveActionableStage(db, cfg, cfg.first_stage.stage, user.id);
      currentStage = resolved.stage;
      currentReviewerId = resolved.assignee ? resolved.assignee.id : null;
      submitStageNote = resolved;
    }
  }

  let wasAlreadySubmitted = false;
  if (editId && action === 'submit') {
    const [chk] = await db.execute('SELECT status FROM ideas WHERE id=? AND submitter_id=?', [editId, user.id]);
    const prev = chk[0]?.status;
    wasAlreadySubmitted = prev !== undefined && prev !== 'Draft';
  }

  let ideaId;
  if (editId) {
    await db.execute(
      `UPDATE ideas SET
        title=?,present_situation=?,proposed_solution=?,
        impact_areas=?,impact_level=?,tangible_benefit=?,intangible_benefit=?,
        investment_required=?,feasibility=?,implementation_duration=?,
        expected_implementation_date=?,benefits_expected=?,support_required=?,
        co_suggester_1_id=?,co_suggester_2_id=?,
        is_anonymous=?,challenge_id=?,template_type=?,
        time_required=?,solution_tags=?,
        patentable_flag=?,patentable_flagged_by=?,
        status=?,submitted_at=COALESCE(submitted_at,?),
        review_due_date=COALESCE(review_due_date,?),
        current_reviewer_id=COALESCE(current_reviewer_id,?),
        current_stage=COALESCE(current_stage,?),
        ai_score=?,ai_reason=?,
        updated_at=NOW()
       WHERE id=? AND submitter_id=?`,
      [title, sit, sol, impacts, impLvl, tangible, intang,
        investment, feasibility, implDuration, expectedDate, benefitsExpected, supportRequired,
        co1, co2, isAnon, challengeId, templateType,
        timeRequired, solutionTags,
        patentableFlag, patentableFlag ? user.id : null,
        status, submittedAt, reviewDueDate, currentReviewerId, currentStage,
        aiScore, aiReason,
        editId, user.id]
    );
    ideaId = editId;
  } else {
    let result;
    for (let attempt = 1; ; attempt++) {
      const code = await generateIdeaCode(db);
      try {
        [result] = await db.execute(
          `INSERT INTO ideas (
              idea_code,title,present_situation,proposed_solution,
              impact_areas,impact_level,tangible_benefit,intangible_benefit,
              investment_required,feasibility,implementation_duration,
              expected_implementation_date,benefits_expected,support_required,
              co_suggester_1_id,co_suggester_2_id,is_anonymous,challenge_id,template_type,
              time_required,solution_tags,patentable_flag,patentable_flagged_by,
              status,submitter_id,submitted_at,review_due_date,current_reviewer_id,current_stage,
              ai_score,ai_reason)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [code, title, sit, sol, impacts, impLvl, tangible, intang,
            investment, feasibility, implDuration, expectedDate, benefitsExpected, supportRequired,
            co1, co2, isAnon, challengeId, templateType,
            timeRequired, solutionTags,
            patentableFlag, patentableFlag ? user.id : null,
            status, user.id, submittedAt, reviewDueDate, currentReviewerId, currentStage,
            aiScore, aiReason]
        );
        break;
      } catch (err) {
        const clash = err?.code === 'ER_DUP_ENTRY' && /idea_code/i.test(err.message || '');
        if (!clash || attempt >= 8) throw err;
      }
    }
    ideaId = result.insertId;
  }

  // Sync the co-suggester junction with the full list (idempotent per save).
  try {
    await db.execute('DELETE FROM idea_co_suggesters WHERE idea_id=?', [ideaId]);
    for (const uid of coIds) {
      await db.execute('INSERT IGNORE INTO idea_co_suggesters (idea_id, user_id) VALUES (?,?)', [ideaId, uid]);
    }
  } catch {}

  if (action === 'submit' && !wasAlreadySubmitted) {
    /*
     * If entering the chain meant passing stages nobody holds, that goes on the
     * SUBMITTED entry rather than a row of its own.
     *
     * idea_workflow.actor_id is NOT NULL and every reader inner-joins users on
     * it, so a system row with no actor cannot be stored and would not be shown
     * if it could. Folding it in also puts the skip at the moment it happened,
     * attributed to the action that caused it.
     */
    let submitNote = null;
    if (submitStageNote && submitStageNote.skipped.length) {
      const cfgLabels = (await getApprovalConfig(db)).labels;
      const names = submitStageNote.skipped.map((k) => cfgLabels[k] || k).join(', ');
      const plural = submitStageNote.skipped.length > 1;
      submitNote = `[Skipped ${names} — nobody in this organisation holds ${plural ? 'those roles' : 'that role'}]`;

      const [cr] = await db.execute('SELECT idea_code FROM ideas WHERE id=?', [ideaId]);
      await reportChainGap(db, { id: ideaId, idea_code: cr[0]?.idea_code || `#${ideaId}` },
        `A new idea skipped ${names} because nobody holds ${plural ? 'those roles' : 'that role'}. `
        + 'Assign the role, or remove the stage from the approval path.');
    } else if (submitStageNote && submitStageNote.stranded) {
      const [cr] = await db.execute('SELECT idea_code FROM ideas WHERE id=?', [ideaId]);
      submitNote = '[No one in this organisation holds any role in the approval path]';
      await reportChainGap(db, { id: ideaId, idea_code: cr[0]?.idea_code || `#${ideaId}` },
        'A new idea was submitted, but nobody in this organisation holds any role in the '
        + 'approval path, so it cannot be reviewed. Assign the roles, or change the path.');
    }

    try { await addWorkflow(db, ideaId, user.id, 'Submitted', submitNote); } catch {}
    try { await addPoints(db, user.id, POINTS.submit); } catch {}

    if (user.manager_id) {
      try {
        await addNotification(
          db, user.manager_id, 'New Idea Submitted',
          `${user.name} submitted a new idea. Please review it in your queue.`, ideaId
        );
      } catch {}
      try {
        const [mrows] = await db.execute('SELECT email, name FROM users WHERE id=?', [user.manager_id]);
        const mgr = mrows[0];
        if (mgr && mgr.email) {
          await queueEmail(db, mgr.email, mgr.name,
            'New Idea Requires Your Review',
            `Dear ${mgr.name},\n\n${user.name} has submitted a new idea for your review.\n\nPlease log in to action it from your review queue.`);
        }
      } catch {}
    }
  }

  const [crows] = await db.execute('SELECT idea_code FROM ideas WHERE id=?', [ideaId]);

  /*
   * Tell the person who submitted it that it arrived.
   *
   * Only them: an acknowledgement is addressed to one reader and nobody else
   * needs a copy. The manager already has their own notice above, and sending
   * this to a wider list would turn every submission into inbox noise for
   * people who cannot act on it.
   *
   * Sent only on a real submission, never on a saved draft and never on the
   * re-save of something already submitted, or somebody editing their idea
   * three times would be thanked three times for the same thing.
   */
  if (action === 'submit' && !wasAlreadySubmitted && user.email) {
    try {
      const code = crows[0].idea_code;
      await queueEmail(
        db, user.email, user.name,
        `Idea ${code} received`,
        `Dear ${user.name},\n\n`
        + `Your idea has been submitted successfully and is now with your reviewer.\n\n`
        + `Reference: ${code}\n`
        + `Title: ${title}\n\n`
        + `You can follow its progress under "My Ideas" - the timeline there shows every `
        + `step it passes through, and you will be told when a decision is made.\n\n`
        + `Thank you for taking the time to write it up.`
      );
    } catch (e) {
      // A confirmation that could not be sent must never fail the submission it
      // is confirming. The idea is saved; the email is a courtesy.
      logger.warn(`idea ${ideaId}: submitter acknowledgement not queued — ${e.message}`);
    }
  }

  return {
    success: true,
    idea_id: ideaId,
    idea_code: crows[0].idea_code,
    ai_score: aiScore,
    points_added: (action === 'submit' && !wasAlreadySubmitted) ? POINTS.submit : 0,
  };
}

// ── REVIEW ACTION (approve / reject / implement + escalation) ───────
/**
 * Serialise everything that decides one idea's fate.
 *
 * The duplicate-action guard below reads, then writes. Two clicks that land in
 * the same millisecond — a double-tapped Approve button, or a retry from a
 * flaky connection — both read "no recent action" and both wrote one, so an
 * idea could be approved five times over with five audit entries. A named lock
 * held for the length of the decision makes the read-then-write atomic across
 * every request and every application instance (it lives in MySQL, not in this
 * process). It must be taken and released on the SAME connection, hence the
 * dedicated one rather than the pool.
 */
async function withIdeaDecisionLock(db, ideaId, fn) {
  const conn = await db.getConnection();
  const lockName = `ifqm_idea_decision_${ideaId}`;
  let held = false;
  try {
    const [rows] = await conn.query('SELECT GET_LOCK(?, 10) AS got', [lockName]);
    held = Number(rows[0]?.got) === 1;
    if (!held) throw new ApiError(409, 'This idea is being updated by someone else. Please try again.');
    return await fn();
  } finally {
    if (held) await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    conn.release();
  }
}

export async function reviewAction(db, user, b) {
  const ideaId = Number(b.idea_id) || 0;
  const decision = b.decision ?? '';
  const comment = String(b.comment ?? '').trim();

  if (!ideaId || !['Approved', 'Rejected', 'Implemented', 'Under Review'].includes(decision)) {
    throw badRequest('Invalid request.');
  }
  return withIdeaDecisionLock(db, ideaId, () => reviewActionLocked(db, user, ideaId, decision, comment));
}

/**
 * The first stage from `startStage` onwards that somebody can actually act on.
 *
 * "Somebody" excludes the submitter: a team lead who submits an idea cannot be
 * the team lead who approves it, so a stage whose only holder is the author is
 * as empty as one with nobody in it.
 *
 * @returns {{stage, role, assignee, skipped: string[], stranded: boolean}}
 *   stranded — no stage in the rest of the chain has anybody who can act. The
 *   caller leaves the idea where it is and tells the administrators.
 */
async function resolveActionableStage(db, cfg, startStage, submitterId) {
  const approvers = cfg.approvers;
  let i = approvers.findIndex((a) => a.stage === startStage);
  if (i < 0) i = 0;

  const skipped = [];
  for (; i < approvers.length; i++) {
    const { stage, role } = approvers[i];

    /*
     * Prefer the submitter's own line manager when they hold the role — an
     * idea is better read by somebody who knows the work — but any holder will
     * do, because the queue offers it to all of them.
     */
    const [rows] = await db.execute(
      `SELECT id, name, email FROM users
        WHERE role = ? AND status = 'active' AND id <> ?
        ORDER BY (id = (SELECT manager_id FROM users WHERE id = ?)) DESC, id ASC
        LIMIT 1`,
      [role, submitterId, submitterId]
    );

    if (rows.length) {
      return { stage, role, assignee: rows[0], skipped, stranded: false };
    }
    skipped.push(stage);
  }

  // Nothing in the rest of the chain can act.
  const fallback = approvers[approvers.findIndex((a) => a.stage === startStage)] || approvers[0] || null;
  return {
    stage: fallback ? fallback.stage : null,
    role: fallback ? fallback.role : null,
    assignee: null,
    skipped: [],
    stranded: true,
  };
}

/**
 * Say, once, that the chain has a hole in it — to the only people who can mend
 * it. Org admins cannot approve ideas, so this is not a request to act on the
 * idea; it is a request to fix the configuration.
 */
async function reportChainGap(db, idea, message) {
  try {
    const [admins] = await db.execute(
      "SELECT id FROM users WHERE role IN ('admin','super_admin') AND status='active'");
    for (const a of admins) {
      await addNotification(db, a.id, 'Approval path needs attention', message, idea.id ?? null);
    }
    logger.warn(`idea ${idea.idea_code ?? idea.id}: ${message}`);
  } catch (e) {
    logger.warn(`could not report approval-chain gap: ${e.message}`);
  }
}

/**
 * Tell the submitter their idea advanced a stage.
 *
 * ── Why this is worth a notification ──────────────────────────────────────
 *
 * Under the old engine an idea was usually decided by the first person who
 * touched it, so there was nothing to report between "submitted" and
 * "approved". Now it can sit through four approvals, and without this the
 * submitter sees an idea marked "Under Review" for a fortnight with no sign
 * that anything is happening — which is exactly how a suggestion scheme stops
 * being used.
 *
 * It says the position, not just the name: "2 of 4" tells somebody how much
 * further there is to go, which the stage name alone does not.
 *
 * Best-effort. A notification that fails must never roll back an approval that
 * succeeded — the decision is the thing that matters, and it is already
 * committed by the time this runs.
 */
async function notifySubmitterProgress(db, idea, fromLabel, toLabel, position, total) {
  try {
    await addNotification(db, idea.submitter_id, 'Your idea moved forward',
      `Idea ${idea.idea_code} — "${idea.title}" — was approved at ${fromLabel} `
      + `and is now with ${toLabel} (step ${position} of ${total}).`,
      idea.id);
  } catch (e) {
    logger.warn(`idea ${idea.idea_code}: could not notify submitter of progress — ${e.message}`);
  }
}

async function reviewActionLocked(db, user, ideaId, decision, comment) {
  if (user.role === 'admin') {
    throw forbidden('Org Admins are strictly prohibited from approving or acting on submitted ideas.');
  }
  const [irows] = await db.execute('SELECT * FROM ideas WHERE id=?', [ideaId]);
  const idea = irows[0];
  if (!idea) throw notFound('Idea not found.');

  if (Number(idea.submitter_id) === Number(user.id)) {
    throw forbidden('You cannot review or approve your own idea.');
  }

  const wfAction = ({ Approved: 'Approved', Rejected: 'Rejected', Implemented: 'Implemented' })[decision] || 'Reviewed';

  // Idempotency guard — no duplicate identical workflow entry within 10s
  const [dup] = await db.execute(
    'SELECT COUNT(*) AS c FROM idea_workflow WHERE idea_id=? AND actor_id=? AND action=? AND created_at > NOW() - INTERVAL 10 SECOND',
    [ideaId, user.id, wfAction]
  );
  if (Number(dup[0].c) > 0) {
    throw new ApiError(429, 'Duplicate action detected. Please wait a moment before retrying.');
  }

  const cfg = await getApprovalConfig(db);

  /*
   * ── Where is this idea, and may this person act on it? ──────────────────
   *
   * The chain is an ordered list of stages and the idea records which one it
   * is waiting at. Both questions are answered from that, not from the
   * reporting tree.
   *
   * What this replaced: approving looked up the approver's OWN manager_id and
   * escalated to them if their role happened to appear somewhere in the chain,
   * falling through to Approved otherwise. So a team lead with no manager on
   * file approved outright, and one whose manager was a department manager
   * skipped a stage. The configured chain described a journey the engine never
   * took.
   */
  const stageKey = idea.current_stage || cfg.first_stage?.stage || null;
  const stageSpec = cfg.approvers.find((a) => a.stage === stageKey);
  const stageRole = stageSpec ? stageSpec.role : null;
  const label = (k) => cfg.labels[k] || k;

  const chainRoles = [...new Set(cfg.approvers.map((a) => a.role))];
  if (!chainRoles.includes(user.role)) {
    const names = cfg.approvers.map((a) => label(a.stage)).join(' → ') || 'nobody';
    throw forbidden(
      'Your role is not part of this organisation\'s approval chain, so you cannot '
      + `approve or reject ideas. The chain is: ${names}.`
    );
  }

  const isCommittee = (idea.workflow_type ?? 'hierarchical') === 'multi_reviewer';

  /*
   * "Implemented" is not a step in the approval chain.
   *
   * It was offered in the same dropdown as Approve and Reject, and because it
   * is not 'Approved' it slipped past every stage check and wrote the status
   * straight onto the row — so any reviewer at any stage could take an idea
   * from Submitted to Implemented in one action, past the entire chain and past
   * the people whose job it was to decide.
   *
   * Implementation is what happens AFTER an approval, and it has its own route
   * with its own role guard. The invariant is asserted here because this is the
   * function that was being used to dodge it.
   */
  if (decision === 'Implemented' && idea.status !== 'Approved') {
    throw forbidden(
      'An idea has to be approved before it can be marked implemented. '
      + 'This one is still at the ' + (label(stageKey) || 'review') + ' stage.'
    );
  }

  /*
   * ── Approving out of turn ───────────────────────────────────────────────
   *
   * Only the role the idea is currently waiting on may APPROVE it. A plant
   * head cannot reach down and approve something still sitting with the team
   * lead — that is precisely the skipping this work exists to stop, and it
   * would also rob the intermediate approvers of a decision the chain says is
   * theirs.
   *
   * REJECTING is deliberately open to anyone in the chain. Sending an idea up
   * three more stages to collect approvals before somebody says no wastes
   * everybody's time, and a rejection is visible and reversible by
   * resubmission in a way a wrongly-granted approval is not.
   */
  if (decision === 'Approved' && !isCommittee) {
    if (!stageRole) {
      throw new ApiError(409,
        'This idea is not waiting at any approval stage. Its chain may have changed; '
        + 'ask an administrator to check the approval path.');
    }
    if (user.role !== stageRole) {
      throw forbidden(
        `This idea is waiting for ${label(stageKey)} approval. `
        + 'It will reach you when the stages before yours have approved it.'
      );
    }
  }

  /*
   * ── Approve: advance one stage, or close ────────────────────────────────
   */
  if (decision === 'Approved' && !isCommittee) {
    const next = advanceStage(cfg, stageKey);

    if (next) {
      /*
       * Move to the next stage somebody can act on, skipping any that nobody
       * holds. Assignment prefers the submitter's own line of report, but the
       * queue does not depend on it — ideas are offered to every holder of the
       * stage's role, so an unassigned stage is still actionable.
       */
      const resolved = await resolveActionableStage(db, cfg, next.stage, idea.submitter_id);

      if (resolved.stranded) {
        /*
         * Nothing further in the chain can act. The idea stays where it is
         * rather than being approved: an approval nobody gave must never be
         * recorded, and "there was no one to ask" is not consent.
         */
        await addWorkflow(db, ideaId, user.id, 'Approved',
          `${comment ? comment + ' ' : ''}[Approved at ${label(stageKey)} — no one holds any later stage; awaiting configuration]`.trim());
        await reportChainGap(db, idea,
          `Idea ${idea.idea_code} was approved at ${label(stageKey)}, but nobody in this organisation `
          + 'holds any of the later roles in the approval path. Assign those roles, or shorten the path, '
          + 'and the idea will continue.');
        return {
          success: true, decision: 'Waiting', stage: stageKey,
          stage_label: label(stageKey), escalated_to: null, points_awarded: 0,
          detail: 'No later stage has anybody who can act on it.',
        };
      }

      const nextStageKey = resolved.stage;
      const assignee = resolved.assignee;
      const position = cfg.approvers.findIndex((a) => a.stage === nextStageKey) + 1;

      // Appended to this approval's own entry — see the note at submit.
      let skipNote = '';
      if (resolved.skipped.length) {
        const names = resolved.skipped.map(label).join(', ');
        const plural = resolved.skipped.length > 1;
        skipNote = ` [Skipped ${names} — nobody holds ${plural ? 'those roles' : 'that role'}]`;
        await reportChainGap(db, idea,
          `Idea ${idea.idea_code} skipped ${names} because nobody holds ${plural ? 'those roles' : 'that role'}. `
          + `Assign ${plural ? 'them' : 'it'}, or remove the stage from the approval path.`);
      }

      await db.execute(
        `UPDATE ideas
            SET status = 'Under Review', current_stage = ?, current_reviewer_id = ?,
                escalation_level = ?, updated_at = NOW()
          WHERE id = ?`,
        [nextStageKey, assignee ? assignee.id : null, position, ideaId]
      );

      await addWorkflow(db, ideaId, user.id, 'Approved',
        `${comment ? comment + ' ' : ''}[Approved at ${label(stageKey)} — now with ${label(nextStageKey)}]${skipNote}`.trim());

      if (assignee) {
        await addNotification(db, assignee.id, 'Idea Awaiting Your Approval',
          `Idea ${idea.idea_code} — "${idea.title}" — was approved at ${label(stageKey)} and is now with you as ${label(nextStageKey)}.`,
          ideaId);
        if (assignee.email) {
          await queueEmail(db, assignee.email, assignee.name,
            `Action Required: Idea ${idea.idea_code} awaiting your approval`,
            `Dear ${assignee.name},\n\nIdea "${idea.title}" (${idea.idea_code}) was approved at the ${label(stageKey)} stage and now needs your approval as ${label(nextStageKey)}.\n\nPlease log in to take action.`);
        }
      }

      await notifySubmitterProgress(db, idea, label(stageKey), label(nextStageKey), position, cfg.approvers.length);
      return {
        success: true,
        decision: 'Escalated',
        stage: nextStageKey,
        stage_label: label(nextStageKey),
        escalated_to: assignee ? assignee.name : null,
        skipped_stages: resolved.skipped,
        points_awarded: 0,
      };
    }

    // No next stage — this was the last one, so the idea is approved outright.
    await db.execute(
      "UPDATE ideas SET current_stage = NULL, current_reviewer_id = NULL WHERE id = ?", [ideaId]);
  }

  /*
   * Anything that closes the idea — a final approval, any rejection, an
   * implementation — takes it off the chain. Leaving a stage key on a closed
   * idea would put it back in somebody's queue.
   */
  if (decision !== 'Approved' || !isCommittee) {
    await db.execute(
      'UPDATE ideas SET current_stage = NULL, current_reviewer_id = NULL WHERE id = ?', [ideaId]);
  }

  await db.execute('UPDATE ideas SET status=?,updated_at=NOW() WHERE id=?', [decision, ideaId]);

  const [codeRows] = await db.execute('SELECT idea_code FROM ideas WHERE id=?', [ideaId]);
  const ideaCode = codeRows[0]?.idea_code || `#${ideaId}`;

  await addWorkflow(db, ideaId, user.id, wfAction, comment || null);

  const pts = ({ Approved: POINTS.approved, Implemented: POINTS.implemented })[decision] || 0;
  if (pts > 0) {
    await addPoints(db, idea.submitter_id, pts);
    await db.execute('UPDATE ideas SET points_awarded = points_awarded + ? WHERE id=?', [pts, ideaId]);
  }

  const msg = {
    Approved: `Your idea ${ideaCode} was Approved.${pts > 0 ? ` +${pts} points awarded.` : ''}`,
    Rejected: `Your idea ${ideaCode} was Rejected.${comment ? ` Feedback: ${comment}` : ''}`,
    Implemented: `Your idea ${ideaCode} is now Implemented.${pts > 0 ? ` +${pts} points awarded.` : ''}`,
  }[decision] || `Your idea ${ideaCode} is Under Review.`;
  await addNotification(db, idea.submitter_id, `Idea ${decision}`, msg, ideaId);

  const [subRows] = await db.execute('SELECT email, name FROM users WHERE id=?', [idea.submitter_id]);
  const sub = subRows[0];
  if (sub && sub.email) {
    await queueEmail(db, sub.email, sub.name, `Your Idea ${ideaCode} — ${decision}`, msg);
  }

  return { success: true, decision, points_awarded: pts };
}

// ── DASHBOARD ───────────────────────────────────────────────────────
export async function dashboard(db, user) {
  const uid = safeUid(user);
  const role = user?.role || 'employee';

  const counts = { Submitted: 0, 'Under Review': 0, Approved: 0, Implemented: 0, Rejected: 0 };
  let statusRows = [];
  try {
    if (INDIVIDUAL_ROLES.includes(role)) {
      [statusRows] = await db.execute('SELECT status, COUNT(*) AS c FROM ideas WHERE submitter_id=? GROUP BY status', [uid]);
    } else {
      [statusRows] = await db.query("SELECT status, COUNT(*) AS c FROM ideas WHERE status != 'Draft' GROUP BY status");
    }
  } catch (e) {
    statusRows = [];
  }
  let total = 0;
  for (const r of statusRows) {
    total += Number(r.c || 0);
    if (r.status in counts) counts[r.status] = Number(r.c || 0);
  }

  let pendingReviews = 0;
  let overdueReviews = 0;
  if ([...TEAM_ROLES, ...ADMIN_ROLES].includes(role)) {
    try {
      if (TEAM_ROLES.includes(role)) {
        const [pr] = await db.execute(
          `SELECT COUNT(*) AS c FROM ideas i JOIN users u ON u.id=i.submitter_id
           WHERE i.status IN ('Submitted','Under Review')
           AND (i.current_reviewer_id=? OR (i.current_reviewer_id IS NULL AND u.manager_id=?))`,
          [uid, uid]
        );
        pendingReviews = Number(pr[0]?.c || 0);
        const [od] = await db.execute(
          `SELECT COUNT(*) AS c FROM ideas i JOIN users u ON u.id=i.submitter_id
           WHERE i.status IN ('Submitted','Under Review')
           AND i.review_due_date IS NOT NULL AND i.review_due_date < CURDATE()
           AND (i.current_reviewer_id=? OR (i.current_reviewer_id IS NULL AND u.manager_id=?))`,
          [uid, uid]
        );
        overdueReviews = Number(od[0]?.c || 0);
      } else {
        const [pr] = await db.query("SELECT COUNT(*) AS c FROM ideas WHERE status IN ('Submitted','Under Review')");
        pendingReviews = Number(pr[0]?.c || 0);
        const [od] = await db.query(
          "SELECT COUNT(*) AS c FROM ideas WHERE status IN ('Submitted','Under Review') AND review_due_date IS NOT NULL AND review_due_date < CURDATE()"
        );
        overdueReviews = Number(od[0]?.c || 0);
      }
    } catch {}
  }

  let recent = [];
  try {
    const [rRows] = await db.query(
      `SELECT w.*, COALESCE(u.name, 'System') AS actor_name, i.idea_code, i.title
       FROM idea_workflow w
       LEFT JOIN users u ON u.id = w.actor_id
       LEFT JOIN ideas i ON i.id = w.idea_id
       ORDER BY w.created_at DESC LIMIT 10`
    );
    recent = rRows || [];
  } catch {}

  let userPoints = Number(user?.points || 0);
  try {
    const [pts] = await db.execute('SELECT points FROM users WHERE id=?', [uid]);
    if (pts && pts[0]) userPoints = Number(pts[0].points ?? userPoints);
  } catch {}

  let monthly = [];
  try {
    const [m] = INDIVIDUAL_ROLES.includes(role)
      ? await db.execute(
        `SELECT DATE_FORMAT(submitted_at,'%Y-%m') AS month, COUNT(*) AS count
           FROM ideas WHERE submitted_at IS NOT NULL AND submitter_id = ?
           GROUP BY month ORDER BY month DESC LIMIT 12`, [uid])
      : await db.query(
        `SELECT DATE_FORMAT(submitted_at,'%Y-%m') AS month, COUNT(*) AS count
           FROM ideas WHERE submitted_at IS NOT NULL
           GROUP BY month ORDER BY month DESC LIMIT 12`);
    monthly = (m || []).map((r) => ({ month: r.month, count: Number(r.count || 0) })).reverse();
  } catch {}

  return {
    success: true,
    total,
    counts,
    pendingReviews,
    pending_reviews: pendingReviews,
    overdueReviews,
    overdue_reviews: overdueReviews,
    userPoints,
    user_points: userPoints,
    recent,
    monthly,
  };
}

// ── ASSIGN REVIEWERS (→ multi_reviewer workflow) ────────────────────
export async function assignReviewers(db, user, b) {
  if (user.role === 'admin') {
    throw forbidden('Org Admins are strictly prohibited from routing ideas.');
  }
  const ideaId = Number(b.idea_id) || 0;
  let reviewerIds = (b.reviewer_ids ?? []).map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x));

  if (!ideaId || !reviewerIds.length) throw badRequest('idea_id and reviewer_ids required.');

  const [irows] = await db.execute('SELECT * FROM ideas WHERE id=?', [ideaId]);
  const idea = irows[0];
  if (!idea) throw notFound('Idea not found.');

  // Submitter cannot be a reviewer; de-dupe
  reviewerIds = [...new Set(reviewerIds.filter((rid) => rid !== Number(idea.submitter_id)))];
  if (!reviewerIds.length) throw badRequest('No valid reviewers — submitter cannot review own idea.');

  await db.execute('DELETE FROM idea_reviewers WHERE idea_id=?', [ideaId]);
  await db.execute(
    "UPDATE ideas SET workflow_type='multi_reviewer', status='Under Review', updated_at=NOW() WHERE id=?",
    [ideaId]
  );

  for (const rid of reviewerIds) {
    await db.execute('INSERT INTO idea_reviewers (idea_id, reviewer_id) VALUES (?, ?)', [ideaId, rid]);
    await addNotification(db, rid, 'Review Assigned',
      `You have been assigned to review idea ${idea.idea_code}: ${idea.title}.`, ideaId);
  }

  await addWorkflow(db, ideaId, user.id, 'Reviewed',
    `Routed to committee (${reviewerIds.length} reviewers — all must approve)`);
  await addNotification(db, idea.submitter_id, 'Idea Under Committee Review',
    `Your idea ${idea.idea_code} has been routed to a review committee.`, ideaId);

  return { success: true, reviewer_count: reviewerIds.length };
}

// ── REVIEWER INDIVIDUAL DECISION ────────────────────────────────────
export async function reviewerDecision(db, user, b) {
  const ideaId = Number(b.idea_id) || 0;
  const decision = String(b.decision ?? '').toLowerCase();
  const comment = String(b.comment ?? '').trim();

  if (!ideaId || !['approved', 'rejected'].includes(decision)) {
    throw badRequest('Invalid idea_id or decision.');
  }

  const [revRows] = await db.execute('SELECT * FROM idea_reviewers WHERE idea_id=? AND reviewer_id=? LIMIT 1', [ideaId, user.id]);
  const rev = revRows[0];
  if (!rev) throw forbidden('You are not an assigned reviewer for this idea.');
  if (rev.decision !== 'pending') throw new ApiError(409, 'You have already submitted your decision.');

  await db.execute(
    'UPDATE idea_reviewers SET decision=?, comment=?, decided_at=NOW() WHERE idea_id=? AND reviewer_id=?',
    [decision, comment || null, ideaId, user.id]
  );
  await addWorkflow(db, ideaId, user.id, decision === 'approved' ? 'Approved' : 'Rejected', comment || null);

  const [irows] = await db.execute('SELECT * FROM ideas WHERE id=?', [ideaId]);
  const idea = irows[0];

  const [decRows] = await db.execute('SELECT decision FROM idea_reviewers WHERE idea_id=?', [ideaId]);
  const allDecisions = decRows.map((r) => r.decision);
  const total = allDecisions.length;
  const approved = allDecisions.filter((d) => d === 'approved').length;
  const rejected = allDecisions.filter((d) => d === 'rejected').length;
  const pending = allDecisions.filter((d) => d === 'pending').length;

  /*
   * A committee decides unanimously: one rejection ends it, and it is approved
   * once everyone has approved.
   *
   * This replaces a configurable percentage. The percentage was a second,
   * competing description of "who has to agree" — an idea could satisfy the
   * named approval chain and still be rejected by an unrelated number, and the
   * number itself was read from the org config in one mode and from a snapshot
   * on the idea row in the others, so two committees running the same day could
   * be judged by different rules. Unanimity needs no configuration and is what
   * every organisation on the platform had set in practice.
   */
  let newStatus = null;
  let pts = 0;
  if (rejected > 0) {
    newStatus = 'Rejected';
  } else if (pending === 0 && total > 0) {
    newStatus = 'Approved';
    pts = POINTS.approved;
  }

  if (newStatus) {
    await db.execute('UPDATE ideas SET status=?, updated_at=NOW() WHERE id=?', [newStatus, ideaId]);
    if (pts > 0) {
      await addPoints(db, idea.submitter_id, pts);
      await db.execute('UPDATE ideas SET points_awarded = points_awarded + ? WHERE id=?', [pts, ideaId]);
    }
    const ideaCode = idea.idea_code || `#${ideaId}`;
    const summary = `${approved}/${total} approved`;
    const msg = newStatus === 'Approved'
      ? `Your idea ${ideaCode} was Approved by committee (${summary}).${pts > 0 ? ` +${pts} points awarded.` : ''}`
      : `Your idea ${ideaCode} was Rejected by committee (${summary}).`;
    await addNotification(db, idea.submitter_id, `Idea ${newStatus}`, msg, ideaId);
  }

  return { success: true, new_status: newStatus, approved, rejected, pending, total };
}

// ── DUPLICATE DETECTION ─────────────────────────────────────────────
export async function checkDuplicate(db, title) {
  title = String(title ?? '').trim();
  if (title.length < 5) return { success: true, duplicates: [] };

  const words = title.replace(/\s+/g, ' ').toLowerCase().split(' ').filter((w) => w.length > 3);
  if (!words.length) return { success: true, duplicates: [] };

  const like = `%${words.slice(0, 4).join('%')}%`;
  const [rows] = await db.execute(
    "SELECT id, idea_code, title, status FROM ideas WHERE title LIKE ? AND status != 'Draft' LIMIT 5",
    [like]
  );
  return { success: true, duplicates: rows };
}

// ── BULK REVIEW ─────────────────────────────────────────────────────
export async function bulkReview(db, user, b) {
  if (user.role === 'admin') {
    throw forbidden('Org Admins are strictly prohibited from approving or reviewing ideas.');
  }
  const ideaIds = (b.idea_ids ?? []).map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x));
  const decision = b.decision ?? '';
  const comment = String(b.comment ?? '').trim();

  if (!ideaIds.length || !['Approved', 'Rejected'].includes(decision)) {
    throw badRequest('idea_ids array and valid decision (Approved/Rejected) required.');
  }

  /*
   * ── Bulk goes through the same door as one-at-a-time ────────────────────
   *
   * This used to write `status = decision` straight onto every row. That
   * bypassed the approval chain completely: a team lead selecting twenty ideas
   * and clicking "Approve all" marked all twenty Approved outright — past every
   * remaining stage, and eligible to be pushed to QCMS, which is gated on
   * exactly that status.
   *
   * It was also the quieter of the two ways to skip the chain, because the
   * single-idea path at least walked the reporting tree. There is no reason for
   * bulk to have its own rules; it is the same decision, taken repeatedly. So
   * it calls reviewAction() per idea and inherits every check — out-of-turn
   * approval, own-idea, the advance, the notifications.
   *
   * One idea failing does not abandon the rest. A selection usually contains a
   * mix, and refusing the whole batch because one of them was the reviewer's
   * own idea would be worse than skipping that one and saying so.
   */
  let processed = 0;
  const skipped = [];
  for (const ideaId of ideaIds) {
    try {
      await reviewAction(db, user, { idea_id: ideaId, decision, comment });
      processed++;
    } catch (e) {
      skipped.push({ idea_id: ideaId, reason: e?.message || 'could not be actioned' });
    }
  }

  return { success: true, processed, skipped_count: skipped.length, skipped };
}

// ── UPDATE ROI ──────────────────────────────────────────────────────
export async function updateRoi(db, user, b) {
  const ideaId = Number(b.idea_id) || 0;
  const roiValue = (b.roi_value !== undefined && b.roi_value !== '') ? Number(b.roi_value) : null;
  const roiType = b.roi_type ?? null;
  const roiDesc = String(b.roi_description ?? '').trim() || null;

  const validTypes = ['cost_saving', 'time_saving', 'quality_improvement', 'revenue_increase', 'other'];
  if (!ideaId) throw badRequest('idea_id required.');
  if (roiType && !validTypes.includes(roiType)) throw badRequest('Invalid roi_type.');

  await db.execute(
    'UPDATE ideas SET roi_value=?, roi_type=?, roi_description=?, updated_at=NOW() WHERE id=?',
    [roiValue, roiType || null, roiDesc, ideaId]
  );

  await addWorkflow(db, ideaId, user.id, 'ROI Updated',
    (roiType ? ucwords(roiType.replace(/_/g, ' ')) : '') +
    (roiValue !== null ? ': ' + numberFormat(roiValue, 2) : ''));

  return { success: true };
}

// ── UPDATE IMPLEMENTATION TRACKING ──────────────────────────────────
export async function updateImplementation(db, user, b) {
  const ideaId = Number(b.idea_id) || 0;
  const ownerId = b.implementation_owner_id ? Number(b.implementation_owner_id) : null;
  const targetDate = b.implementation_target_date ? b.implementation_target_date : null;
  const implStatus = b.implementation_status ?? null;

  const validStatuses = ['not_started', 'in_progress', 'completed', 'on_hold'];
  if (!ideaId) throw badRequest('idea_id required.');
  if (implStatus && !validStatuses.includes(implStatus)) throw badRequest('Invalid implementation_status.');

  await db.execute(
    'UPDATE ideas SET implementation_owner_id=?, implementation_target_date=?, implementation_status=?, updated_at=NOW() WHERE id=?',
    [ownerId, targetDate, implStatus || null, ideaId]
  );

  await addWorkflow(db, ideaId, user.id, 'Implementation Updated',
    implStatus ? 'Status: ' + ucwords(implStatus.replace(/_/g, ' ')) : null);

  return { success: true };
}

// ── small utils ─────────────────────────────────────────────────────
// Local-time formatters (PHP date() uses server-local time; avoid the UTC
// off-by-one that toISOString() could cause on DATE values near midnight).
const p2 = (n) => String(n).padStart(2, '0');
function nowDateTime() {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}
function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
function ucwords(s) {
  return String(s).replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}
function numberFormat(n, decimals = 2) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export default {
  list, my, review, get, submitOrDraft, reviewAction, dashboard,
  assignReviewers, reviewerDecision, checkDuplicate, bulkReview, updateRoi, updateImplementation,
  repairStrandedIdeas,
};

// ── ARCHIVE / PATENTABILITY (MOM §13.2, §13.10) ─────────────────────
/**
 * Only the org's own admins may archive. It is not destructive — the row, its
 * points, its workflow history and its ROI figures all stay — but it removes an
 * idea from everyone else's working lists, which is a decision that belongs to
 * whoever runs the programme rather than to any reviewer.
 */
const ORG_ADMIN_ROLES = ['admin', 'super_admin'];

function assertOrgAdmin(user, what) {
  if (!ORG_ADMIN_ROLES.includes(user.role)) {
    throw forbidden(`Only an organisation admin can ${what}.`);
  }
}

/**
 * Archive or restore an idea.
 *
 * Deliberately reversible and deliberately logged: an idea vanishing from the
 * list with no trace of who removed it is indistinguishable from a bug, and the
 * submitter is entitled to an answer.
 */
export async function setArchived(db, user, b) {
  assertOrgAdmin(user, 'archive ideas');
  const ideaId = Number(b.idea_id) || 0;
  if (!ideaId) throw badRequest('idea_id required.');
  const archive = !(b.archived === false || b.archived === 0 || b.archived === '0');

  const [[idea]] = await db.execute('SELECT id, idea_code, archived_at FROM ideas WHERE id=?', [ideaId]);
  if (!idea) throw notFound('Idea not found');

  if (archive) {
    if (idea.archived_at) return { success: true, archived: true, message: 'Already archived.' };
    await db.execute('UPDATE ideas SET archived_at=NOW(), archived_by=?, updated_at=NOW() WHERE id=?', [user.id, ideaId]);
  } else {
    if (!idea.archived_at) return { success: true, archived: false, message: 'Not archived.' };
    await db.execute('UPDATE ideas SET archived_at=NULL, archived_by=NULL, updated_at=NOW() WHERE id=?', [ideaId]);
  }

  await addWorkflow(db, ideaId, user.id, archive ? 'Archived' : 'Restored',
    String(b.note ?? '').trim() || null);

  return {
    success: true,
    archived: archive,
    message: archive ? 'Idea archived.' : 'Idea restored.',
  };
}

/**
 * Record a patentability decision.
 *
 * Separate from `status` on purpose (MOM §13.10): an idea can be approved and
 * unpatentable, or rejected on cost grounds and still worth a provisional
 * filing. Folding it into the status enum would lose exactly those cases.
 */
export async function setPatentability(db, user, b) {
  assertOrgAdmin(user, 'record a patentability decision');
  const ideaId = Number(b.idea_id) || 0;
  const value = String(b.patentability ?? '');
  if (!ideaId) throw badRequest('idea_id required.');
  if (!PATENTABILITY_VALUES.includes(value)) throw badRequest('Invalid patentability value.');

  const note = String(b.patentability_note ?? '').trim().slice(0, 2000) || null;
  const [res] = await db.execute(
    'UPDATE ideas SET patentability=?, patentability_note=?, updated_at=NOW() WHERE id=?',
    [value, note, ideaId]
  );
  if (!res.affectedRows) throw notFound('Idea not found');

  await addWorkflow(db, ideaId, user.id, 'Patentability', `${value}${note ? ` — ${note}` : ''}`);
  return { success: true, patentability: value, message: 'Patentability recorded.' };
}

/*
 * The submitter's own "this may be patentable" tick, and the same tick from
 * anybody senior enough to review. It is a flag raised by a person, separate
 * from `patentability`, which is the organisation's formal assessment and stays
 * an admin-only field.
 */
export async function setPatentableFlag(db, user, b) {
  const ideaId = Number(b.idea_id) || 0;
  if (!ideaId) throw badRequest('idea_id required.');
  const flag = !(b.patentable === false || b.patentable === 0 || b.patentable === '0');

  const [[idea]] = await db.execute(
    'SELECT id, submitter_id, patentable_flag FROM ideas WHERE id=?', [ideaId]
  );
  if (!idea) throw notFound('Idea not found');

  // Either your own idea, or you are senior enough to be reviewing ideas at all.
  const isAuthor = Number(idea.submitter_id) === Number(user.id);
  if (!isAuthor && !PRIVILEGED_SOLUTION.includes(user.role)) {
    throw forbidden('You can only flag your own ideas as patentable.');
  }
  if (Number(idea.patentable_flag ? 1 : 0) === (flag ? 1 : 0)) {
    return { success: true, patentable: flag, message: 'No change.' };
  }

  await db.execute(
    'UPDATE ideas SET patentable_flag=?, patentable_flagged_by=?, updated_at=NOW() WHERE id=?',
    [flag ? 1 : 0, flag ? user.id : null, ideaId]
  );
  await addWorkflow(db, ideaId, user.id, 'Patentable',
    flag ? 'Marked as possibly patentable.' : 'Patentable mark removed.');

  return {
    success: true,
    patentable: flag,
    message: flag ? 'Marked as possibly patentable.' : 'Patentable mark removed.',
  };
}

/*
 * Bulk archive — MOM follow-up. Filtering an old idea out of a view does not
 * archive it, so an administrator asking to "clear out last year" had to open
 * every idea one at a time. This archives a whole selection in one statement.
 *
 * Two ways to choose what to archive:
 *   ids            an explicit list, from tick boxes on the screen
 *   before_date    everything submitted before that date
 * Draft ideas are never touched: they belong to their author and are not yet
 * part of the organisation's record.
 */
export async function bulkArchive(db, user, b) {
  assertOrgAdmin(user, 'archive ideas');
  const archive = !(b.archived === false || b.archived === 0 || b.archived === '0');
  const ids = Array.isArray(b.ids)
    ? [...new Set(b.ids.map((n) => Number(n)).filter((n) => n > 0))].slice(0, 2000)
    : [];
  const beforeDate = String(b.before_date ?? '').trim();

  if (!ids.length && !beforeDate) {
    throw badRequest('Choose the ideas to archive, or a date to archive before.');
  }
  if (beforeDate && !/^\d{4}-\d{2}-\d{2}$/.test(beforeDate)) {
    throw badRequest('before_date must be in YYYY-MM-DD form.');
  }

  const where = ["status <> 'Draft'"];
  const params = [];
  if (ids.length) {
    where.push(`id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  if (beforeDate) {
    where.push('submitted_at < ?');
    params.push(`${beforeDate} 00:00:00`);
  }
  // Archiving skips what is already archived, and restoring skips what is not,
  // so re-running the same request is harmless.
  where.push(archive ? 'archived_at IS NULL' : 'archived_at IS NOT NULL');

  const [rows] = await db.execute(
    `SELECT id FROM ideas WHERE ${where.join(' AND ')} LIMIT 2000`, params
  );
  if (!rows.length) {
    return { success: true, affected: 0, message: 'Nothing to change.' };
  }

  const targetIds = rows.map((r) => r.id);
  const holes = targetIds.map(() => '?').join(',');
  if (archive) {
    await db.execute(
      `UPDATE ideas SET archived_at=NOW(), archived_by=?, updated_at=NOW() WHERE id IN (${holes})`,
      [user.id, ...targetIds]
    );
  } else {
    await db.execute(
      `UPDATE ideas SET archived_at=NULL, archived_by=NULL, updated_at=NOW() WHERE id IN (${holes})`,
      targetIds
    );
  }

  // One timeline entry per idea, so the change is visible from the idea itself
  // and not only from the audit trail.
  for (const id of targetIds) {
    await addWorkflow(db, id, user.id, archive ? 'Archived' : 'Restored',
      archive ? 'Archived in bulk.' : 'Restored in bulk.');
  }

  return {
    success: true,
    affected: targetIds.length,
    archived: archive,
    message: `${targetIds.length} idea(s) ${archive ? 'archived' : 'restored'}.`,
  };
}

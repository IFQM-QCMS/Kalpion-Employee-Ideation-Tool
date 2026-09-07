/** Idea service - Node port of PHP api/ideas.php (idea lifecycle + workflow). */
import config from '../config/index.js';
import { computeAIScoreWithReason } from './aiService.js';
import { getApprovalConfig, advanceStage, rolePlaysStages } from './settingsService.js';
import { seniorityRanks, rankOf } from './approvalStages.js';
import { getOrgSettings, queueEmail } from './mailerService.js';
import { generateIdeaCode, addNotification, addWorkflow, addPoints } from './coreHelpers.js';
import { badRequest, forbidden, notFound, ApiError } from '../utils/respond.js';
import logger from '../utils/logger.js';
import { IDEA_SECTIONS, employeeSections } from './ideaSections.js';

const POINTS = config.points;

const INDIVIDUAL_ROLES = ['trainee', 'employee'];
// department_manager sits with the other line roles: it sees its own reports' ideas.
// plant_head is org-wide, so it sits with the admin set and sees all of them - the same
// split executive already had.
const TEAM_ROLES = ['team_lead', 'project_lead', 'manager', 'department_manager', 'senior_manager'];
const ADMIN_ROLES = ['plant_head', 'executive', 'admin', 'super_admin'];
const PRIVILEGED_ANON = ['manager', 'department_manager', 'senior_manager', 'plant_head', 'executive', 'admin', 'super_admin'];

/** Roles that may read an idea's full proposed solution. */
const PRIVILEGED_SOLUTION = PRIVILEGED_ANON;

/** MOM §14.5 - Time Required is a fixed three-band dropdown. */
export const TIME_REQUIRED_BANDS = ['lt_3m', '3_6m', '6_12m'];
export const SOLUTION_TAGS = ['process_improvement', 'quality', 'cost', 'delivery'];

/** MOM §13.10 - patentability, a separate axis from approval status. */
export const PATENTABILITY_VALUES = [
  'not_assessed', 'not_patentable', 'possible', 'recommended', 'filed',
];

/*
 * MOM §13.1 - solution visibility is now the organisation's choice, not a constant.
 * `everyone` restores the pre-MOM behaviour; `managers_only` is the strictest, hiding the
 * text from peers entirely.
 */
/** MOM §14.10 - who may read the AI's assessment of an idea. */
function predictionMode(settings) {
  const v = String(settings?.prediction_visibility ?? 'seniors');
  return ['seniors', 'everyone'].includes(v) ? v : 'seniors';
}

/** Hide the AI reasoning from people not entitled to it. */
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

/** First sentence of a solution, or a hard-truncated opening - whichever is shorter. */
export function summariseSolution(text, limit = 140) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const sentenceEnd = clean.search(/[.!?](\s|$)/);
  if (sentenceEnd > 0 && sentenceEnd + 1 <= limit) return clean.slice(0, sentenceEnd + 1);
  if (clean.length <= limit) return clean;
  // Cut on a word boundary so the preview does not end mid-word.
  const cut = clean.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '...';
}

/** Trim a problem statement down to an extract. */
export function previewText(text, limit = 180) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length <= limit) return clean;
  const window = clean.slice(0, limit);
  const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
  if (lastStop > limit * 0.5) return clean.slice(0, lastStop + 1);
  const lastSpace = window.lastIndexOf(' ');
  return (lastSpace > limit * 0.6 ? window.slice(0, lastSpace) : window).trimEnd() + '...';
}

// Strip the sections this organisation does not let ordinary colleagues see.
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
        // These two are benefit text under different column names.
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

/** Is this person inside this idea? */
export function isInsideIdea(user, idea) {
  const uid = Number(user?.id);
  if (!uid) return false;
  if (PRIVILEGED_SOLUTION.includes(user.role)) return true;
  if (Number(idea.submitter_id) === uid) return true;
  if (Number(idea.co_suggester_1_id) === uid || Number(idea.co_suggester_2_id) === uid) return true;
  if (Number(idea.current_reviewer_id) === uid) return true;
  // Populated by get(); absent on list rows, where the four checks above are what the list
  // query can answer.
  if ((idea.reviewers || []).some((r) => Number(r.reviewer_id) === uid)) return true;
  if ((idea.co_suggesters || []).some((c) => Number(c.id) === uid)) return true;
  return false;
}

/** May this viewer read the full solution of this idea? */
export function canReadSolution(user, idea, mode = 'authors_reviewers') {
  const uid = Number(user.id);
  // The author always sees their own proposal, in every mode. A setting that could hide
  // someone's own writing from them would be a bug, not a policy.
  if (Number(idea.submitter_id) === uid) return true;
  if (mode === 'everyone') return true;
  if (PRIVILEGED_SOLUTION.includes(user.role)) return true;
  if (mode === 'managers_only') return false;
  if (Number(idea.co_suggester_1_id) === uid || Number(idea.co_suggester_2_id) === uid) return true;
  if (Number(idea.current_reviewer_id) === uid) return true;
  return false;
}

/** Replace the full solution with a summary unless the viewer is entitled to it. */
function redactSolution(user, idea, mode = 'authors_reviewers', previewChars = 180) {
  idea.solution_summary = summariseSolution(idea.proposed_solution);
  if (!canReadSolution(user, idea, mode)) {
    idea.proposed_solution = null;
    idea.solution_redacted = true;
    // The situation goes the same way. Whoever may not read the fix may not read the whole
    // problem either - only enough to know what it is about.
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

// LIST
export async function list(db, user, { status, search, impact, archived, tag, time_required: timeReq } = {}) {
  const where = [];
  const params = [];

  // Archived ideas are hidden unless explicitly asked for (MOM §13.2).
  if (String(archived) === '1' || archived === true) {
    where.push('i.archived_at IS NOT NULL');
  } else if (String(archived) !== 'all') {
    where.push('i.archived_at IS NULL');
  }

  // §14.6 - filter by solution tag. Matched on the CSV with delimiters on both sides so
  // `cost` cannot match `cost_saving`.
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
      idea.department = '-';
    }
    // The browse list never carries a full solution over the wire, even for people entitled to
    // read one - they get it from the detail endpoint.
    idea.viewer_inside = isInsideIdea(user, idea);
    redactSolution(user, idea, mode, previewChars);
    // The browse list shows a one-line gist. If the organisation does not let ordinary
    // colleagues read even that, the column has to be empty for them.
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

// MY
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

/** Move ideas that are waiting on somebody who does not exist. */
export async function repairStrandedIdeas(db) {
  const cfg = await getApprovalConfig(db);
  if (!cfg.approvers.length) return { checked: 0, moved: 0, stranded: 0 };

  const [rows] = await db.execute(
    `SELECT i.id, i.idea_code, i.title, i.submitter_id, i.current_stage, i.current_reviewer_id,
            rv.status AS reviewer_status,
            (SELECT COUNT(*) FROM idea_workflow w
              WHERE w.idea_id = i.id AND w.action = 'Approved') AS approvals
       FROM ideas i
       LEFT JOIN users rv ON rv.id = i.current_reviewer_id
      WHERE i.status IN ('Submitted','Under Review')
        AND COALESCE(i.workflow_type,'hierarchical') = 'hierarchical'`
  );
  if (!rows.length) return { checked: 0, moved: 0, stranded: 0 };

  let moved = 0;
  let stranded = 0;

  for (const idea of rows) {
    // Is this idea in a state somebody can act on?
    const stageSpec = cfg.approvers.find((a) => a.stage === idea.current_stage);
    const stageExists = !!stageSpec;
    const assigneeAlive = idea.current_reviewer_id
      && idea.reviewer_status === 'active'
      && Number(idea.current_reviewer_id) !== Number(idea.submitter_id);

    if (stageExists && assigneeAlive) {
      // Everything above asks whether SOMEBODY can act.
      const own = await lineHolderFor(db, idea.submitter_id, stageSpec.role);
      if (!own || Number(own.id) === Number(idea.current_reviewer_id)) continue;

      await db.execute(
        'UPDATE ideas SET current_reviewer_id = ?, updated_at = NOW() WHERE id = ?',
        [own.id, idea.id]
      );
      try {
        await addNotification(db, own.id, 'Idea Awaiting Your Approval',
          `Idea ${idea.idea_code} - "${idea.title}" - is now with you as `
          + `${cfg.labels[idea.current_stage] || idea.current_stage}.`, idea.id);
      } catch { /* best effort: the routing is the thing that matters */ }
      logger.info(`idea ${idea.idea_code}: moved to ${own.name} - the submitter's own `
        + `${cfg.labels[idea.current_stage] || idea.current_stage}`);
      moved++;
      continue;
    }

    // Where to resume from.
    const from = Number(idea.approvals) > 0 && idea.current_stage
      ? idea.current_stage
      : cfg.approvers[0].stage;

    const resolved = await resolveActionableStage(db, cfg, from, idea.submitter_id);

    if (resolved.stranded || !resolved.stage) {
      // Still nobody. Park it at the stage that is BLOCKING, so the next pass asks the right
      // question - "can anybody act at plant_head yet?" - rather than looking at a stage that
      // has already finished with it and concluding all is well.
      if (resolved.stage && resolved.stage !== idea.current_stage) {
        const pos = cfg.approvers.findIndex((a) => a.stage === resolved.stage) + 1;
        await db.execute(
          `UPDATE ideas SET current_stage = ?, current_reviewer_id = NULL,
                  escalation_level = ?, updated_at = NOW()
            WHERE id = ?`,
          [resolved.stage, pos, idea.id]
        );
      }
      stranded++;
      continue;
    }

    const nextAssignee = resolved.assignee ? resolved.assignee.id : null;
    if (resolved.stage === idea.current_stage
        && Number(nextAssignee) === Number(idea.current_reviewer_id)) continue;

    const position = cfg.approvers.findIndex((a) => a.stage === resolved.stage) + 1;
    await db.execute(
      `UPDATE ideas SET current_stage = ?, current_reviewer_id = ?, escalation_level = ?, updated_at = NOW()
        WHERE id = ?`,
      [resolved.stage, nextAssignee, position, idea.id]
    );

    // Tell the new owner. A silent reassignment is an idea that arrives in somebody's queue
    // with no reason to look at it - and the person it moved FROM is usually gone, so nobody
    // else is going to mention it.
    if (resolved.assignee) {
      try {
        await addNotification(db, resolved.assignee.id, 'Idea Awaiting Your Approval',
          `Idea ${idea.idea_code} - "${idea.title}" - is now with you as `
          + `${cfg.labels[resolved.stage] || resolved.stage}.`, idea.id);
      } catch { /* best effort: the routing is the thing that matters */ }
    }

    const was = idea.current_stage ? (cfg.labels[idea.current_stage] || idea.current_stage) : 'no stage';
    const now = cfg.labels[resolved.stage] || resolved.stage;
    const why = !stageExists ? `${was} is no longer in the chain`
      : !idea.current_reviewer_id ? `nobody was assigned at ${was}`
      : `the ${was} it was with is no longer active`;
    logger.info(`idea ${idea.idea_code}: re-routed to ${now}`
      + `${resolved.assignee ? ` (${resolved.assignee.name})` : ''} - ${why}`);
    moved++;
  }

  if (moved || stranded) {
    logger.info(`approval repair: ${moved} idea(s) moved, ${stranded} still with nobody to act`);
  }
  return { checked: rows.length, moved, stranded };
}

// REVIEW QUEUE
/** The chain, in a shape the browser can render without knowing the rules. */
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

  // Two conditions, and both are needed.
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
               AND i.current_stage IN (${placeholders})
               AND (i.current_reviewer_id = ? OR i.current_reviewer_id IS NULL))
              OR (i.workflow_type = 'multi_reviewer' AND ir.decision = 'pending'))
       ORDER BY i.review_due_date ASC, i.ai_score DESC, i.submitted_at ASC`;
    const [ideas] = await db.execute(sql, [uid, uid, uid, ...myStages, uid]);
    return { success: true, ideas, chain: chainSummary(cfg, user.role) };
  }

  // The org-wide queue, for the people whose remit actually is org-wide.
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

// GET single
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

  // The trail, with the stage each action was taken at.
  const [wf] = await db.execute(
    `SELECT w.*, u.name AS actor_name, u.role AS actor_role, u.employee_id AS actor_employee_id
     FROM idea_workflow w JOIN users u ON u.id = w.actor_id
     WHERE w.idea_id = ? ORDER BY w.created_at ASC, w.id ASC`,
    [id]
  );
  idea.workflow = wf;

  // This organisation's chain, travelling with the idea.
  try {
    const cfg = await getApprovalConfig(db);
    idea.approval_chain = {
      labels: cfg.labels,
      steps: cfg.approvers.map((a, i) => ({
        stage: a.stage,
        label: cfg.labels[a.stage] || a.stage,
        role: a.role,
        position: i + 1,
      })),
      total: cfg.approvers.length,
    };
  } catch {
    // A settings read that fails must not take the idea down with it. The PDF falls back to
    // the actor's role, which is worse but is not nothing.
    idea.approval_chain = null;
  }

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

  // Hold back the full proposal from colleagues who are neither its authors nor its judges.
  const detailSettings = await getOrgSettings(db);
  const mode = visibilityMode(detailSettings);
  const detailPreview = parseInt(detailSettings.situation_preview_chars, 10) || 180;
  const isAssignedReviewer = (idea.reviewers || []).some((r) => Number(r.reviewer_id) === uid);
  const isCoSuggester = (idea.co_suggesters || []).some((c) => Number(c.id) === uid);
  // An assigned reviewer or co-suggester reads the full text in every mode except
  // managers_only, which is the whole point of that mode.
  idea.viewer_inside = isInsideIdea(user, idea);
  if ((isAssignedReviewer || isCoSuggester) && mode !== 'managers_only') {
    idea.solution_summary = summariseSolution(idea.proposed_solution);
    idea.situation_summary = previewText(idea.present_situation, detailPreview);
    idea.solution_redacted = false;
    idea.situation_redacted = false;
    idea.hidden_sections = [];
  } else {
    redactSolution(user, idea, mode, detailPreview);
    // Somebody who could not be given the full text is by definition outside this idea, so the
    // organisation's section rules apply to them.
    if (idea.solution_redacted) {
      applySectionVisibility(idea, employeeSections(detailSettings));
    } else {
      idea.hidden_sections = [];
    }
  }
  redactPrediction(user, idea, predictionMode(detailSettings));

  // MOM §13.13 - "Under review by ___" as one readable line, rather than making the viewer
  // reconstruct it from the workflow timeline.
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
    idea.department = '-';
    idea.business_unit = '-';
    idea.manager_name = null;

    // The header fields are not the only place the author's name appears.
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

// SUBMIT / SAVE DRAFT
export async function submitOrDraft(db, user, action, b) {
  const title = String(b.title ?? '').trim();
  const sit = String(b.present_situation ?? '').trim();
  const sol = String(b.proposed_solution ?? '').trim();
  const impacts = String(b.impact_areas ?? '').trim();
  const impLvl = b.impact_level ?? 'Medium';
  const tangible = String(b.tangible_benefit ?? '').trim();
  const intang = String(b.intangible_benefit ?? '').trim();
  // Co-suggesters: accept a full array (co_suggester_ids) OR the two legacy fields.
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

  // MOM §14.5 / §14.6. Both validated against a fixed list rather than stored as typed: an
  // unrecognised value becomes NULL instead of creating a fourth time band or a one-off tag
  // that every filter would then miss.
  const timeRequired = TIME_REQUIRED_BANDS.includes(String(b.time_required ?? ''))
    ? String(b.time_required) : null;
  // Anyone may raise the flag - the submitter who thinks their idea is novel, or a senior
  // reviewing it.
  const patentableFlag = (b.patentable_flag === true || b.patentable_flag === 1
    || b.patentable_flag === '1') ? 1 : 0;
  const solutionTags = [...new Set(
    (Array.isArray(b.solution_tags) ? b.solution_tags : String(b.solution_tags ?? '').split(','))
      .map((x) => String(x).trim())
      .filter((x) => SOLUTION_TAGS.includes(x))
  )].join(',') || null;

  // Business case. Every field is optional - a half-formed idea is still worth capturing,
  // and the reviewer can ask for the rest.
  const investment = String(b.investment_required ?? '').trim().slice(0, 255) || null;
  const feasibilityIn = String(b.feasibility ?? '').trim();
  const feasibility = ['Low', 'Medium', 'High'].includes(feasibilityIn) ? feasibilityIn : null;
  const implDuration = String(b.implementation_duration ?? '').trim().slice(0, 120) || null;
  // A malformed date would be written as 0000-00-00 (or rejected outright in strict mode);
  // anything that is not a plain YYYY-MM-DD is simply not a date.
  const expectedDateIn = String(b.expected_implementation_date ?? '').trim();
  const expectedDate = /^\d{4}-\d{2}-\d{2}$/.test(expectedDateIn) ? expectedDateIn : null;
  const benefitsExpected = String(b.benefits_expected ?? '').trim() || null;
  const supportRequired = String(b.support_required ?? '').trim() || null;

  // The title column is VARCHAR(255) and only its PRESENCE was checked, so a longer one
  // travelled all the way to MySQL and came back as "Data too long for column 'title'".
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
  // Carried out of the block so the workflow note can be written after the row exists - a
  // skipped stage is only meaningful next to the idea it skipped.
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

    // This used to set current_reviewer_id to the submitter's own manager and nothing else,
    // which is how the whole approval sequence came to be driven by the reporting tree: the
    // first reviewer was whoever the submitter reported to, whatever role they held and
    // wherever that sat in the configured chain.
    const cfg = await getApprovalConfig(db);

    // Enter the chain at the first stage somebody can actually act on.
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
    // If entering the chain meant passing stages nobody holds, that goes on the SUBMITTED
    // entry rather than a row of its own.
    let submitNote = null;
    if (submitStageNote && submitStageNote.skipped.length) {
      const cfgLabels = (await getApprovalConfig(db)).labels;
      const names = submitStageNote.skipped.map((k) => cfgLabels[k] || k).join(', ');
      const plural = submitStageNote.skipped.length > 1;
      submitNote = `[Skipped ${names} - nobody in this organisation holds ${plural ? 'those roles' : 'that role'}]`;

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

    // 'originator' is a real stage in the chain, and it is the submitter's.
    try { await addWorkflow(db, ideaId, user.id, 'Submitted', submitNote, 'originator'); } catch {}
    try { await addPoints(db, user.id, POINTS.submit); } catch {}

    // Tell the person the idea was actually ROUTED to.
    if (currentReviewerId) {
      try {
        await addNotification(
          db, currentReviewerId, 'New Idea Submitted',
          `${user.name} submitted a new idea. Please review it in your queue.`, ideaId
        );
      } catch {}
      try {
        const [mrows] = await db.execute(
          'SELECT email, name FROM users WHERE id=?', [currentReviewerId]);
        const rv = mrows[0];
        if (rv && rv.email) {
          await queueEmail(db, rv.email, rv.name,
            'New Idea Requires Your Review',
            `Dear ${rv.name},\n\n${user.name} has submitted a new idea for your review.\n\n`
            + 'Please log in to action it from your review queue.');
        }
      } catch {}
    }
  }

  const [crows] = await db.execute('SELECT idea_code FROM ideas WHERE id=?', [ideaId]);

  // Tell the person who submitted it that it arrived.
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
      // A confirmation that could not be sent must never fail the submission it is confirming.
      // The idea is saved; the email is a courtesy.
      logger.warn(`idea ${ideaId}: submitter acknowledgement not queued - ${e.message}`);
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

// REVIEW ACTION (approve / reject / implement + escalation)
/** Serialise everything that decides one idea's fate. */
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

/** The first stage from `startStage` onwards that somebody can actually act on. */
/*
 * Walk the submitter's reporting line upward and return the first person on it who holds
 * `role`.
 */
async function lineHolderFor(db, submitterId, role) {
  const seen = new Set([Number(submitterId)]);
  let currentId = Number(submitterId);

  for (let hop = 0; hop < 20; hop++) {
    const [rows] = await db.execute(
      `SELECT u.id, u.name, u.email, u.role, u.status, u.manager_id
         FROM users u WHERE u.id = (SELECT manager_id FROM users WHERE id = ?)`,
      [currentId]
    );
    const boss = rows[0];
    if (!boss) return null;                    // top of the tree
    if (seen.has(Number(boss.id))) return null; // a cycle in the org chart
    seen.add(Number(boss.id));

    // An inactive manager is stepped over rather than treated as the end of the line: somebody
    // on long leave should not stop their whole team's ideas, and the person above them is the
    // natural stand-in.
    if (boss.role === role && boss.status === 'active' && Number(boss.id) !== Number(submitterId)) {
      return { id: boss.id, name: boss.name, email: boss.email };
    }
    currentId = boss.id;
  }
  return null;
}

/*
 * The first stage from `startStage` onwards that somebody can actually act on, and the
 * specific person it belongs to.
 */
async function resolveActionableStage(db, cfg, startStage, submitterId) {
  const approvers = cfg.approvers;
  let i = approvers.findIndex((a) => a.stage === startStage);
  if (i < 0) i = 0;

  const skipped = [];
  let blockedAt = null;   // the first stage that had nobody - where the idea waits

  for (; i < approvers.length; i++) {
    const { stage, role } = approvers[i];

    // 1. The submitter's own line of report.
    const own = await lineHolderFor(db, submitterId, role);
    if (own) {
      return { stage, role, assignee: own, skipped, stranded: false, offLine: false };
    }

    // 2. and 3. Everybody else who holds the role.
    const [rows] = await db.execute(
      `SELECT id, name, email FROM users
        WHERE role = ? AND status = 'active' AND id <> ?
        ORDER BY id ASC`,
      [role, submitterId]
    );

    if (rows.length === 1) {
      // Unambiguous. "The" plant head is the plant head whether or not anybody filled in a
      // manager_id.
      return { stage, role, assignee: rows[0], skipped, stranded: false, offLine: false };
    }
    if (rows.length > 1) {
      // Several, and the data cannot say which is the author's. Open to all of them, and flagged
      // so somebody fixes the org chart.
      return { stage, role, assignee: null, skipped, stranded: false, offLine: true };
    }

    if (!blockedAt) blockedAt = stage;
    skipped.push(stage);
  }

  // Nothing in the rest of the chain can act.
  return {
    stage: blockedAt || (approvers[approvers.length - 1]?.stage ?? null),
    role: blockedAt ? cfg.approvers.find((a) => a.stage === blockedAt).role : null,
    assignee: null,
    skipped: [],
    stranded: true,
    offLine: false,
  };
}

/** Say, once, that the chain has a hole in it - to the only people who can mend it. */
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

/** Tell the submitter their idea advanced a stage. */
async function notifySubmitterProgress(db, idea, step) {
  const {
    approverName, fromLabel, toLabel, withName, position, total,
  } = step;
  try {
    // Named on both ends, not just titled.
    const by = approverName ? `${approverName} (${fromLabel})` : fromLabel;
    const withWhom = withName ? `${withName}, your ${toLabel}` : toLabel;

    await addNotification(db, idea.submitter_id, 'Your idea moved forward',
      `Idea ${idea.idea_code} - "${idea.title}" - was approved by ${by} `
      + `and is now being reviewed by ${withWhom} (step ${position} of ${total}).`,
      idea.id);

    // And by email, not only in the app.
    const [subRows] = await db.execute(
      'SELECT email, name FROM users WHERE id = ?', [idea.submitter_id]);
    const sub = subRows[0];
    if (sub?.email) {
      await queueEmail(db, sub.email, sub.name,
        `Your idea ${idea.idea_code} has moved forward`,
        `Dear ${sub.name},\n\n`
        + `Good news - your idea "${idea.title}" (${idea.idea_code}) has been approved by ${by}.\n\n`
        + `It is now being reviewed by ${withWhom}. That is step ${position} of ${total} `
        + `in your organisation's approval path.\n\n`
        + 'We will let you know as soon as it moves again.');
    }
  } catch (e) {
    logger.warn(`idea ${idea.idea_code}: could not notify submitter of progress - ${e.message}`);
  }
}

async function reviewActionLocked(db, user, ideaId, decision, comment) {
  // Both administrator roles. super_admin was not named here, so the one account that can
  // promote people to admin could also approve ideas.
  if (user.role === 'admin' || user.role === 'super_admin') {
    throw forbidden('Org Admins are strictly prohibited from approving or acting on submitted ideas.');
  }
  const [irows] = await db.execute('SELECT * FROM ideas WHERE id=?', [ideaId]);
  const idea = irows[0];
  if (!idea) throw notFound('Idea not found.');

  if (Number(idea.submitter_id) === Number(user.id)) {
    throw forbidden('You cannot review or approve your own idea.');
  }

  const wfAction = ({ Approved: 'Approved', Rejected: 'Rejected', Implemented: 'Implemented' })[decision] || 'Reviewed';

  // Idempotency guard - no duplicate identical workflow entry within 10s
  const [dup] = await db.execute(
    'SELECT COUNT(*) AS c FROM idea_workflow WHERE idea_id=? AND actor_id=? AND action=? AND created_at > NOW() - INTERVAL 10 SECOND',
    [ideaId, user.id, wfAction]
  );
  if (Number(dup[0].c) > 0) {
    throw new ApiError(429, 'Duplicate action detected. Please wait a moment before retrying.');
  }

  const cfg = await getApprovalConfig(db);

  // Where is this idea, and may this person act on it?
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

  // "Implemented" is not a step in the approval chain.
  if (decision === 'Implemented' && idea.status !== 'Approved') {
    throw forbidden(
      'An idea has to be approved before it can be marked implemented. '
      + 'This one is still at the ' + (label(stageKey) || 'review') + ' stage.'
    );
  }

  // Only the role the idea is currently waiting on may APPROVE it.
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

    // Holding the right role is not enough - it has to be YOUR idea to decide.
    const assignedTo = idea.current_reviewer_id;
    if (assignedTo && Number(assignedTo) !== Number(user.id)) {
      const [owner] = await db.execute('SELECT name FROM users WHERE id = ?', [assignedTo]);
      throw forbidden(
        `This idea is with ${owner[0]?.name || 'another ' + label(stageKey)} for `
        + `${label(stageKey)} approval - they are the submitter's ${label(stageKey)}. `
        + 'Ideas go to the approver in the reporting line of whoever wrote them.'
      );
    }
  }

  // Approve: advance one stage, or close.
  if (decision === 'Approved' && !isCommittee) {
    const next = advanceStage(cfg, stageKey);

    if (next) {
      // Move to the next stage somebody can act on, skipping any that nobody holds, and route it
      // to the approver in the SUBMITTER's own line - not to whoever happens to hold the role.
      const resolved = await resolveActionableStage(db, cfg, next.stage, idea.submitter_id);

      if (resolved.stranded) {
        // Nothing further in the chain can act.
        const blockedAt = resolved.stage || stageKey;
        const position = cfg.approvers.findIndex((a) => a.stage === blockedAt) + 1;
        await db.execute(
          `UPDATE ideas
              SET status = 'Under Review', current_stage = ?, current_reviewer_id = NULL,
                  escalation_level = ?, updated_at = NOW()
            WHERE id = ?`,
          [blockedAt, position, ideaId]
        );

        await addWorkflow(db, ideaId, user.id, 'Approved',
          `${comment ? comment + ' ' : ''}[Approved at ${label(stageKey)} - waiting for ${label(blockedAt)}, which nobody holds]`.trim(),
          stageKey);
        await reportChainGap(db, idea,
          `Idea ${idea.idea_code} was approved at ${label(stageKey)} and is now waiting for `
          + `${label(blockedAt)}, which nobody in this organisation holds. Assign that role and the `
          + 'idea will move on by itself; it is held, not lost.');
        return {
          success: true, decision: 'Waiting', stage: blockedAt,
          stage_label: label(blockedAt), escalated_to: null, points_awarded: 0,
          detail: `Waiting for ${label(blockedAt)} - nobody holds that role yet.`,
        };
      }

      const nextStageKey = resolved.stage;
      const assignee = resolved.assignee;
      const position = cfg.approvers.findIndex((a) => a.stage === nextStageKey) + 1;

      // Appended to this approval's own entry - see the note at submit.
      let skipNote = '';
      if (resolved.skipped.length) {
        const names = resolved.skipped.map(label).join(', ');
        const plural = resolved.skipped.length > 1;
        skipNote = ` [Skipped ${names} - nobody holds ${plural ? 'those roles' : 'that role'}]`;
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

      // The stage is recorded on the entry, not inferred later from the actor's role - see
      // addWorkflow.
      const withWhom = assignee ? `${assignee.name} as ${label(nextStageKey)}` : label(nextStageKey);
      await addWorkflow(db, ideaId, user.id, 'Approved',
        `${comment ? comment + ' ' : ''}[Approved at ${label(stageKey)} - now with ${withWhom}]${skipNote}`.trim(),
        stageKey);

      if (assignee) {
        await addNotification(db, assignee.id, 'Idea Awaiting Your Approval',
          `Idea ${idea.idea_code} - "${idea.title}" - was approved at ${label(stageKey)} and is now with you as ${label(nextStageKey)}.`,
          ideaId);
        if (assignee.email) {
          await queueEmail(db, assignee.email, assignee.name,
            `Action Required: Idea ${idea.idea_code} awaiting your approval`,
            `Dear ${assignee.name},\n\nIdea "${idea.title}" (${idea.idea_code}) was approved at the ${label(stageKey)} stage and now needs your approval as ${label(nextStageKey)}.\n\nPlease log in to take action.`);
        }
      }

      // If we had to pick somebody outside the submitter's reporting line, say so.
      if (resolved.offLine) {
        await reportChainGap(db, idea,
          `Idea ${idea.idea_code} is open to every ${label(nextStageKey)} rather than to one `
          + 'person, because nobody in the reporting line of whoever submitted it holds that role '
          + 'and more than one person does. Set the Manager field on the people involved and ideas '
          + 'will go to their own approver.');
      }

      await notifySubmitterProgress(db, idea, {
        approverName: user.name,
        fromLabel: label(stageKey),
        toLabel: label(nextStageKey),
        withName: assignee ? assignee.name : null,
        position,
        total: cfg.approvers.length,
      });
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

    // No next stage - this was the last one, so the idea is approved outright.
    await db.execute(
      "UPDATE ideas SET current_stage = NULL, current_reviewer_id = NULL WHERE id = ?", [ideaId]);
  }

  // Anything that closes the idea - a final approval, any rejection, an implementation -
  // takes it off the chain.
  if (decision !== 'Approved' || !isCommittee) {
    await db.execute(
      'UPDATE ideas SET current_stage = NULL, current_reviewer_id = NULL WHERE id = ?', [ideaId]);
  }

  await db.execute('UPDATE ideas SET status=?,updated_at=NOW() WHERE id=?', [decision, ideaId]);

  const [codeRows] = await db.execute('SELECT idea_code FROM ideas WHERE id=?', [ideaId]);
  const ideaCode = codeRows[0]?.idea_code || `#${ideaId}`;

  // stageKey is where this person was standing when they decided - the final stage for a
  // closing approval, or wherever in the chain a rejection came from.
  await addWorkflow(db, ideaId, user.id, wfAction, comment || null, stageKey);

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

  const [subRows] = await db.execute(
    'SELECT email, name, points FROM users WHERE id=?', [idea.submitter_id]);
  const sub = subRows[0];
  if (sub && sub.email) {
    // The end of the road gets its own letter.
    if (decision === 'Approved') {
      const finalLabel = label(stageKey) || 'the final approver';
      const total = Number(sub.points ?? 0);
      await queueEmail(db, sub.email, sub.name,
        `Congratulations - your idea ${ideaCode} has been approved`,
        `Dear ${sub.name},\n\n`
        + `Congratulations. Your idea "${idea.title}" (${ideaCode}) has been approved by `
        + `${user.name} (${finalLabel}) - the last step in your organisation's approval path.\n\n`
        + 'It is now ready to be sent to the quality system and taken forward for '
        + 'implementation.\n\n'
        + (pts > 0
          ? `You have earned ${pts} points for this approval, taking you to ${total} points `
            + 'in total for submitting it and seeing it through.\n\n'
          : '')
        + (comment ? `Comments from the approver: ${comment}\n\n` : '')
        + 'Thank you for taking the trouble to write it up.');
    } else {
      await queueEmail(db, sub.email, sub.name, `Your Idea ${ideaCode} - ${decision}`, msg);
    }
  }

  return { success: true, decision, points_awarded: pts };
}

// DASHBOARD
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
        // The same rule as the review queue, deliberately.
        const cfg = await getApprovalConfig(db);
        const myStages = rolePlaysStages(cfg, role);
        const stageIn = myStages.length ? myStages.map(() => '?').join(',') : null;

        const waitingOnMe = stageIn
          ? `i.status IN ('Submitted','Under Review')
               AND i.submitter_id <> ?
               AND COALESCE(i.workflow_type,'hierarchical') = 'hierarchical'
               AND i.current_stage IN (${stageIn})
               AND (i.current_reviewer_id = ? OR i.current_reviewer_id IS NULL)`
          : '1 = 0';
        const args = stageIn ? [uid, ...myStages, uid] : [];

        const [pr] = await db.execute(
          `SELECT COUNT(*) AS c FROM ideas i WHERE ${waitingOnMe}`, args);
        pendingReviews = Number(pr[0]?.c || 0);
        const [od] = await db.execute(
          `SELECT COUNT(*) AS c FROM ideas i
            WHERE ${waitingOnMe}
              AND i.review_due_date IS NOT NULL AND i.review_due_date < CURDATE()`,
          args);
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

// ASSIGN REVIEWERS ( multi_reviewer workflow)
export async function assignReviewers(db, user, b) {
  // Both administrator roles. super_admin was not named here, so the one account that can
  // promote people to admin could also approve ideas.
  if (user.role === 'admin' || user.role === 'super_admin') {
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
  if (!reviewerIds.length) throw badRequest('No valid reviewers - submitter cannot review own idea.');

  // This endpoint took any user id at all, and routing to a committee takes the idea OFF the
  // sequential chain (workflow_type becomes multi_reviewer).
  const cfg = await getApprovalConfig(db);
  const ranks = seniorityRanks(cfg.stages);
  const myRank = rankOf(ranks, user.role);

  const [candidates] = await db.query(
    'SELECT id, name, role, status FROM users WHERE id IN (?)', [reviewerIds]);

  const tooJunior = [];
  const notApprovers = [];
  for (const c of candidates) {
    if (c.status !== 'active') {
      throw badRequest(`${c.name} is not an active account and cannot be given a review.`);
    }
    const theirRank = rankOf(ranks, c.role);
    // -1 is "holds no role in any approval path" - an employee, a trainee, or an
    // administrator, who is barred from deciding anything anyway.
    if (theirRank < 0) notApprovers.push(c.name);
    else if (theirRank < myRank) tooJunior.push(c.name);
  }

  if (notApprovers.length) {
    throw badRequest(
      `${notApprovers.join(', ')} ${notApprovers.length > 1 ? 'hold' : 'holds'} no role in this `
      + 'organisation\'s approval path, so the idea cannot be routed to them. '
      + `The path is: ${cfg.approvers.map((a) => cfg.labels[a.stage] || a.stage).join(' → ')}.`);
  }
  if (tooJunior.length) {
    throw forbidden(
      `An idea can only be routed to people at or above your own level in the approval `
      + `path, and ${tooJunior.join(', ')} ${tooJunior.length > 1 ? 'are' : 'is'} below you. `
      + 'Routing downward would take the idea off the chain and let it be decided '
      + 'without the stages above you ever seeing it.');
  }

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
    `Routed to committee (${reviewerIds.length} reviewers - all must approve)`);
  await addNotification(db, idea.submitter_id, 'Idea Under Committee Review',
    `Your idea ${idea.idea_code} has been routed to a review committee.`, ideaId);

  return { success: true, reviewer_count: reviewerIds.length };
}

// REVIEWER INDIVIDUAL DECISION
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

  // A committee decides unanimously: one rejection ends it, and it is approved once everyone
  // has approved.
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

// DUPLICATE DETECTION
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

// BULK REVIEW
export async function bulkReview(db, user, b) {
  // Both administrator roles. super_admin was not named here, so the one account that can
  // promote people to admin could also approve ideas.
  if (user.role === 'admin' || user.role === 'super_admin') {
    throw forbidden('Org Admins are strictly prohibited from approving or reviewing ideas.');
  }
  const ideaIds = (b.idea_ids ?? []).map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x));
  const decision = b.decision ?? '';
  const comment = String(b.comment ?? '').trim();

  if (!ideaIds.length || !['Approved', 'Rejected'].includes(decision)) {
    throw badRequest('idea_ids array and valid decision (Approved/Rejected) required.');
  }

  // This used to write `status = decision` straight onto every row.
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

// UPDATE ROI
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

// UPDATE IMPLEMENTATION TRACKING
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

// small utils Local-time formatters (PHP date() uses server-local time; avoid the UTC
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

// ARCHIVE / PATENTABILITY (MOM §13.2, §13.10)
/** Only the org's own admins may archive. */
const ORG_ADMIN_ROLES = ['admin', 'super_admin'];

function assertOrgAdmin(user, what) {
  if (!ORG_ADMIN_ROLES.includes(user.role)) {
    throw forbidden(`Only an organisation admin can ${what}.`);
  }
}

/** Archive or restore an idea. */
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

/** Record a patentability decision. */
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

  await addWorkflow(db, ideaId, user.id, 'Patentability', `${value}${note ? ` - ${note}` : ''}`);
  return { success: true, patentability: value, message: 'Patentability recorded.' };
}

// The submitter's own "this may be patentable" tick, and the same tick from anybody senior
// enough to review.
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

// Bulk archive - MOM follow-up.
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
  // Archiving skips what is already archived, and restoring skips what is not, so re-running
  // the same request is harmless.
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

  // One timeline entry per idea, so the change is visible from the idea itself and not only
  // from the audit trail.
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

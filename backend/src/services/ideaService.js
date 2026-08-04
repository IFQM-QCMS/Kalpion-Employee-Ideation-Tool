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
import { getApprovalConfig } from './settingsService.js';
import { getOrgSettings, queueEmail } from './mailerService.js';
import { generateIdeaCode, addNotification, addWorkflow, addPoints } from './coreHelpers.js';
import { badRequest, forbidden, notFound, ApiError } from '../utils/respond.js';

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
 * May this viewer read the full solution of this idea?
 * The author and their co-suggesters always can; so can whoever has to judge it.
 */
function canReadSolution(user, idea) {
  const uid = Number(user.id);
  if (PRIVILEGED_SOLUTION.includes(user.role)) return true;
  if (Number(idea.submitter_id) === uid) return true;
  if (Number(idea.co_suggester_1_id) === uid || Number(idea.co_suggester_2_id) === uid) return true;
  if (Number(idea.current_reviewer_id) === uid) return true;
  return false;
}

/**
 * Replace the full solution with a summary unless the viewer is entitled to it.
 * Mutates and returns the row. `solution_redacted` lets the UI say why the text
 * is short instead of looking like the field was left empty.
 */
function redactSolution(user, idea) {
  idea.solution_summary = summariseSolution(idea.proposed_solution);
  if (!canReadSolution(user, idea)) {
    idea.proposed_solution = null;
    idea.solution_redacted = true;
  } else {
    idea.solution_redacted = false;
  }
  return idea;
}

// ── LIST ────────────────────────────────────────────────────────────
export async function list(db, user, { status, search, impact } = {}) {
  const where = [];
  const params = [];

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
    redactSolution(user, idea);
    idea.proposed_solution = null;
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

// ── REVIEW QUEUE ────────────────────────────────────────────────────
export async function review(db, user) {
  const uid = Number(user.id);
  const cfg = await getApprovalConfig(db);

  if (cfg.reviewer_roles.includes(user.role)) {
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
         AND (i.workflow_type = 'hierarchical'
              AND (i.current_reviewer_id = ? OR (i.current_reviewer_id IS NULL AND u.manager_id = ?))
              OR i.workflow_type = 'multi_reviewer' AND ir.decision = 'pending')
       ORDER BY i.review_due_date ASC, i.ai_score DESC, i.submitted_at ASC`;
    const [ideas] = await db.execute(sql, [uid, uid, uid, uid]);
    return { success: true, ideas };
  }

  // Admin / exec / super_admin — see all non-draft ideas in the queue
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
  const isAssignedReviewer = (idea.reviewers || []).some((r) => Number(r.reviewer_id) === uid);
  const isCoSuggester = (idea.co_suggesters || []).some((c) => Number(c.id) === uid);
  if (isAssignedReviewer || isCoSuggester) {
    idea.solution_summary = summariseSolution(idea.proposed_solution);
    idea.solution_redacted = false;
  } else {
    redactSolution(user, idea);
  }

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

  if (!title || !sit || !sol) {
    throw badRequest('Title, present situation and proposed solution are required.');
  }

  const ai = await computeAIScoreWithReason({
    title, present_situation: sit, proposed_solution: sol,
    impact_areas: impacts, impact_level: impLvl,
    tangible_benefit: tangible, intangible_benefit: intang,
    co_suggester_1_id: co1, co_suggester_2_id: co2,
  });
  const aiScore = ai.score;
  const aiReason = ai.reason;

  const status = action === 'submit' ? 'Submitted' : 'Draft';
  const submittedAt = action === 'submit' ? nowDateTime() : null;

  let reviewDueDate = null;
  let currentReviewerId = null;
  if (action === 'submit') {
    let slaDays = 7;
    try {
      const [srows] = await db.execute(
        "SELECT value FROM org_settings WHERE key_name='review_sla_days' LIMIT 1"
      );
      if (srows.length) slaDays = Math.max(1, parseInt(srows[0].value, 10) || 1);
    } catch { /* keep default */ }
    reviewDueDate = addDays(slaDays);
    currentReviewerId = user.manager_id ?? null;
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
        status=?,submitted_at=COALESCE(submitted_at,?),
        review_due_date=COALESCE(review_due_date,?),
        current_reviewer_id=COALESCE(current_reviewer_id,?),
        ai_score=?,ai_reason=?,
        updated_at=NOW()
       WHERE id=? AND submitter_id=?`,
      [title, sit, sol, impacts, impLvl, tangible, intang,
        investment, feasibility, implDuration, expectedDate, benefitsExpected, supportRequired,
        co1, co2, isAnon, challengeId, templateType,
        status, submittedAt, reviewDueDate, currentReviewerId,
        aiScore, aiReason,
        editId, user.id]
    );
    ideaId = editId;
  } else {
    // Two people submitting at the same instant read the same "next" code, so
    // one INSERT loses the UNIQUE race and used to surface as a 500 on a
    // perfectly valid submission. Re-read the sequence and retry instead — the
    // collision is rare, self-correcting, and must never reach the submitter.
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
              status,submitter_id,submitted_at,review_due_date,current_reviewer_id,
              ai_score,ai_reason)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [code, title, sit, sol, impacts, impLvl, tangible, intang,
            investment, feasibility, implDuration, expectedDate, benefitsExpected, supportRequired,
            co1, co2, isAnon, challengeId, templateType,
            status, user.id, submittedAt, reviewDueDate, currentReviewerId,
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
  await db.execute('DELETE FROM idea_co_suggesters WHERE idea_id=?', [ideaId]);
  for (const uid of coIds) {
    await db.execute('INSERT IGNORE INTO idea_co_suggesters (idea_id, user_id) VALUES (?,?)', [ideaId, uid]);
  }

  if (action === 'submit' && !wasAlreadySubmitted) {
    await addWorkflow(db, ideaId, user.id, 'Submitted');
    await addPoints(db, user.id, POINTS.submit);

    if (user.manager_id) {
      await addNotification(
        db, user.manager_id, 'New Idea Submitted',
        `${user.name} submitted a new idea. Please review it in your queue.`, ideaId
      );
      const [mrows] = await db.execute('SELECT email, name FROM users WHERE id=?', [user.manager_id]);
      const mgr = mrows[0];
      if (mgr && mgr.email) {
        await queueEmail(db, mgr.email, mgr.name,
          'New Idea Requires Your Review',
          `Dear ${mgr.name},\n\n${user.name} has submitted a new idea for your review.\n\nPlease log in to action it from your review queue.`);
      }
    }
  }

  const [crows] = await db.execute('SELECT idea_code FROM ideas WHERE id=?', [ideaId]);

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

async function reviewActionLocked(db, user, ideaId, decision, comment) {
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
  const escalationRoles = cfg.reviewer_roles;
  const finalApproverRoles = cfg.final_roles;

  if (decision === 'Approved'
    && (idea.workflow_type ?? 'hierarchical') !== 'multi_reviewer'
    && escalationRoles.includes(user.role)
  ) {
    const [mrows] = await db.execute(
      `SELECT u2.id, u2.name, u2.role, u2.email
       FROM users u1 JOIN users u2 ON u2.id = u1.manager_id
       WHERE u1.id = ? LIMIT 1`,
      [user.id]
    );
    const nextReviewer = mrows[0];
    const reviewerPool = [...escalationRoles, ...finalApproverRoles];

    if (nextReviewer && reviewerPool.includes(nextReviewer.role)) {
      const lvl = Number(idea.escalation_level ?? 0) + 1;
      await db.execute(
        "UPDATE ideas SET status='Under Review', current_reviewer_id=?, escalation_level=?, updated_at=NOW() WHERE id=?",
        [nextReviewer.id, lvl, ideaId]
      );
      await addWorkflow(db, ideaId, user.id, 'Approved',
        `${comment ? comment + ' ' : ''}[L${lvl} Approved — escalated to ${nextReviewer.name}]`.trim());
      await addNotification(db, nextReviewer.id, 'Idea Escalated for Review',
        `Idea ${idea.idea_code} — "${idea.title}" — approved at level ${lvl} and escalated to you for final decision.`,
        ideaId);
      if (nextReviewer.email) {
        await queueEmail(db, nextReviewer.email, nextReviewer.name,
          `Action Required: Idea ${idea.idea_code} Escalated to You`,
          `Dear ${nextReviewer.name},\n\nIdea "${idea.title}" (${idea.idea_code}) has been approved at level ${lvl} and escalated to you for final decision.\n\nPlease log in to take action.`);
      }
      return { success: true, decision: 'Escalated', escalated_to: nextReviewer.name, points_awarded: 0 };
    }
    // No higher reviewer — fall through to final Approved
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
  const uid = user.id;
  const role = user.role;

  // One grouped query for the whole status breakdown instead of 1 total + 5
  // per-status COUNTs (6 round-trips → 1). Individuals see their own ideas
  // (total includes their drafts, matching the previous behaviour); everyone
  // else sees all non-draft ideas.
  const counts = { Submitted: 0, 'Under Review': 0, Approved: 0, Implemented: 0, Rejected: 0 };
  let statusRows;
  if (INDIVIDUAL_ROLES.includes(role)) {
    [statusRows] = await db.execute('SELECT status, COUNT(*) AS c FROM ideas WHERE submitter_id=? GROUP BY status', [uid]);
  } else {
    [statusRows] = await db.query("SELECT status, COUNT(*) AS c FROM ideas WHERE status != 'Draft' GROUP BY status");
  }
  let total = 0;
  for (const r of statusRows) {
    total += Number(r.c);
    if (r.status in counts) counts[r.status] = Number(r.c);
  }

  let pendingReviews = 0;
  let overdueReviews = 0;
  if ([...TEAM_ROLES, ...ADMIN_ROLES].includes(role)) {
    if (TEAM_ROLES.includes(role)) {
      const [pr] = await db.execute(
        `SELECT COUNT(*) AS c FROM ideas i JOIN users u ON u.id=i.submitter_id
         WHERE i.status IN ('Submitted','Under Review')
         AND (i.current_reviewer_id=? OR (i.current_reviewer_id IS NULL AND u.manager_id=?))`,
        [uid, uid]
      );
      pendingReviews = Number(pr[0].c);
      const [od] = await db.execute(
        `SELECT COUNT(*) AS c FROM ideas i JOIN users u ON u.id=i.submitter_id
         WHERE i.status IN ('Submitted','Under Review')
         AND i.review_due_date IS NOT NULL AND i.review_due_date < CURDATE()
         AND (i.current_reviewer_id=? OR (i.current_reviewer_id IS NULL AND u.manager_id=?))`,
        [uid, uid]
      );
      overdueReviews = Number(od[0].c);
    } else {
      const [pr] = await db.query("SELECT COUNT(*) AS c FROM ideas WHERE status IN ('Submitted','Under Review')");
      pendingReviews = Number(pr[0].c);
      const [od] = await db.query(
        "SELECT COUNT(*) AS c FROM ideas WHERE status IN ('Submitted','Under Review') AND review_due_date IS NOT NULL AND review_due_date < CURDATE()"
      );
      overdueReviews = Number(od[0].c);
    }
  }

  const [recent] = await db.query(
    `SELECT w.*, u.name AS actor_name, i.idea_code, i.title
     FROM idea_workflow w
     JOIN users u ON u.id = w.actor_id
     JOIN ideas i ON i.id = w.idea_id
     ORDER BY w.created_at DESC LIMIT 10`
  );

  const [pts] = await db.execute('SELECT points FROM users WHERE id=?', [uid]);
  const userPoints = Number(pts[0]?.points ?? user.points);

  // Monthly submission activity (last 12 months) — for the org-wide dashboards
  // (admin / super_admin etc.). Individuals get their own submissions.
  let monthly = [];
  {
    const [m] = INDIVIDUAL_ROLES.includes(role)
      ? await db.execute(
        `SELECT DATE_FORMAT(submitted_at,'%Y-%m') AS month, COUNT(*) AS count
           FROM ideas WHERE submitted_at IS NOT NULL AND submitter_id = ?
           GROUP BY month ORDER BY month DESC LIMIT 12`, [uid])
      : await db.query(
        `SELECT DATE_FORMAT(submitted_at,'%Y-%m') AS month, COUNT(*) AS count
           FROM ideas WHERE submitted_at IS NOT NULL
           GROUP BY month ORDER BY month DESC LIMIT 12`);
    monthly = m.map((r) => ({ month: r.month, count: Number(r.count) })).reverse();
  }

  return {
    success: true,
    total,
    counts,
    recent,
    monthly,
    user_points: userPoints,
    pending_reviews: pendingReviews,
    overdue_reviews: overdueReviews,
  };
}

// ── ASSIGN REVIEWERS (→ multi_reviewer workflow) ────────────────────
export async function assignReviewers(db, user, b) {
  const ideaId = Number(b.idea_id) || 0;
  let reviewerIds = (b.reviewer_ids ?? []).map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x));
  const threshold = Math.max(1, Math.min(100, parseInt(b.threshold ?? 100, 10) || 100));

  if (!ideaId || !reviewerIds.length) throw badRequest('idea_id and reviewer_ids required.');

  const [irows] = await db.execute('SELECT * FROM ideas WHERE id=?', [ideaId]);
  const idea = irows[0];
  if (!idea) throw notFound('Idea not found.');

  // Submitter cannot be a reviewer; de-dupe
  reviewerIds = [...new Set(reviewerIds.filter((rid) => rid !== Number(idea.submitter_id)))];
  if (!reviewerIds.length) throw badRequest('No valid reviewers — submitter cannot review own idea.');

  await db.execute('DELETE FROM idea_reviewers WHERE idea_id=?', [ideaId]);
  await db.execute(
    "UPDATE ideas SET workflow_type='multi_reviewer', approval_threshold=?, status='Under Review', updated_at=NOW() WHERE id=?",
    [threshold, ideaId]
  );

  for (const rid of reviewerIds) {
    await db.execute('INSERT INTO idea_reviewers (idea_id, reviewer_id) VALUES (?, ?)', [ideaId, rid]);
    await addNotification(db, rid, 'Review Assigned',
      `You have been assigned to review idea ${idea.idea_code}: ${idea.title}.`, ideaId);
  }

  await addWorkflow(db, ideaId, user.id, 'Reviewed',
    `Routed to committee (${reviewerIds.length} reviewers, threshold: ${threshold}%)`);
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

  const cfg = await getApprovalConfig(db);
  const threshold = cfg.mode === 'custom' ? cfg.threshold : parseInt(idea.approval_threshold ?? 100, 10);

  let newStatus = null;
  let pts = 0;
  if (threshold === 100 && rejected > 0) {
    newStatus = 'Rejected';
  } else if (pending === 0) {
    const rate = total > 0 ? (approved / total) * 100 : 0;
    if (rate >= threshold) { newStatus = 'Approved'; pts = POINTS.approved; }
    else { newStatus = 'Rejected'; }
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
  const ideaIds = (b.idea_ids ?? []).map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x));
  const decision = b.decision ?? '';
  const comment = String(b.comment ?? '').trim();

  if (!ideaIds.length || !['Approved', 'Rejected'].includes(decision)) {
    throw badRequest('idea_ids array and valid decision (Approved/Rejected) required.');
  }

  let processed = 0;
  for (const ideaId of ideaIds) {
    const [irows] = await db.execute("SELECT * FROM ideas WHERE id=? AND status IN ('Submitted','Under Review')", [ideaId]);
    const idea = irows[0];
    if (!idea || Number(idea.submitter_id) === Number(user.id)) continue;

    await db.execute('UPDATE ideas SET status=?, updated_at=NOW() WHERE id=?', [decision, ideaId]);
    await addWorkflow(db, ideaId, user.id, decision, comment || null);

    const pts = decision === 'Approved' ? POINTS.approved : 0;
    if (pts > 0) {
      await addPoints(db, idea.submitter_id, pts);
      await db.execute('UPDATE ideas SET points_awarded = points_awarded + ? WHERE id=?', [pts, ideaId]);
    }

    const msg = decision === 'Approved'
      ? `Your idea ${idea.idea_code} was Approved (bulk). +${pts} points awarded.`
      : `Your idea ${idea.idea_code} was Rejected (bulk).${comment ? ` Feedback: ${comment}` : ''}`;
    await addNotification(db, idea.submitter_id, `Idea ${decision}`, msg, ideaId);
    processed++;
  }

  return { success: true, processed };
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
};

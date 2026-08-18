/**
 * Voting service — Node port of PHP api/votes.php plus the two community-voting
 * actions that physically lived in api/ideas.php (board, community_vote).
 *
 * Ported actions:
 *   votes.php : vote (5-star), upvote, downvote, community_stats, poll_all, stats
 *   ideas.php : board, community_vote
 *
 * Two deliberately-different community endpoints are preserved exactly as PHP
 * had them:
 *   • upvote/downvote (votes.php) — also maintains the ideas.upvotes/downvotes
 *     counter columns and returns a community-adjusted score.
 *   • community_vote (ideas.php)  — toggles the vote then RECOUNTS from
 *     idea_community_votes; does not touch the counter columns.
 */
import { badRequest, forbidden, notFound } from '../utils/respond.js';
import { summariseSolution, previewText, canReadSolution, visibilityMode, isInsideIdea } from './ideaService.js';
import { employeeSections } from './ideaSections.js';
import { getOrgSettings } from './mailerService.js';

const num = (v) => Number(v ?? 0);
const PRIVILEGED_ANON = ['manager', 'department_manager', 'senior_manager', 'plant_head', 'executive', 'admin', 'super_admin'];
const VOTABLE_STATUSES = ['Submitted', 'Under Review', 'Approved', 'Implemented'];

// ── Shared stat helpers (mirror the PHP functions) ─────────────────
export async function voteStats(db, ideaId, userId) {
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS vote_count,
            ROUND(AVG(rating), 1) AS avg_rating,
            MAX(CASE WHEN user_id = ? THEN rating ELSE NULL END) AS user_rating
     FROM idea_votes WHERE idea_id = ?`,
    [userId, ideaId]
  );
  const row = rows[0] || {};
  const vc = num(row.vote_count);
  return {
    vote_count: vc,
    avg_rating: vc > 0 ? num(row.avg_rating) : 0.0,
    user_rating: row.user_rating !== null && row.user_rating !== undefined ? num(row.user_rating) : null,
  };
}

export async function communityVoteStats(db, ideaId, userId) {
  const [rows] = await db.execute(
    `SELECT
        SUM(CASE WHEN vote_type='up'   THEN 1 ELSE 0 END) AS upvotes,
        SUM(CASE WHEN vote_type='down' THEN 1 ELSE 0 END) AS downvotes,
        MAX(CASE WHEN user_id=?        THEN vote_type ELSE NULL END) AS user_vote
     FROM idea_community_votes WHERE idea_id=?`,
    [userId, ideaId]
  );
  const row = rows[0] || {};
  return {
    upvotes: num(row.upvotes),
    downvotes: num(row.downvotes),
    user_vote: row.user_vote ?? null,
  };
}

export function communityAdjustedScore(aiScore, upvotes, downvotes) {
  const net = upvotes - downvotes;
  const adjustment = Math.max(-20, Math.min(20, net * 3));
  return Math.max(0, Math.min(100, aiScore + adjustment));
}

// ── vote (5-star rating) ───────────────────────────────────────────
export async function rate(db, user, b) {
  const ideaId = num(b.idea_id);
  const rating = num(b.rating);
  if (!ideaId || rating < 1 || rating > 5) {
    throw badRequest('Invalid request — idea_id and rating (1–5) required.');
  }

  const [irows] = await db.execute('SELECT submitter_id FROM ideas WHERE id = ?', [ideaId]);
  const idea = irows[0];
  if (!idea) throw notFound('Idea not found.');
  if (num(idea.submitter_id) === num(user.id)) throw forbidden('You cannot vote on your own idea.');

  await db.execute(
    `INSERT INTO idea_votes (idea_id, user_id, rating)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE rating = ?, updated_at = NOW()`,
    [ideaId, user.id, rating, rating]
  );

  return { success: true, ...(await voteStats(db, ideaId, user.id)) };
}

// ── upvote / downvote (maintains counter columns) ──────────────────
export async function upDownVote(db, user, action, b) {
  const ideaId = num(b.idea_id);
  const voteType = action === 'upvote' ? 'up' : 'down';
  if (!ideaId) throw badRequest('Invalid idea_id.');

  const [irows] = await db.execute('SELECT submitter_id, ai_score FROM ideas WHERE id=?', [ideaId]);
  const idea = irows[0];
  if (!idea) throw notFound('Idea not found.');
  if (num(idea.submitter_id) === num(user.id)) throw forbidden('You cannot vote on your own idea.');

  const [chk] = await db.execute('SELECT vote_type FROM idea_community_votes WHERE idea_id=? AND user_id=?', [ideaId, user.id]);
  const existing = chk[0] ? chk[0].vote_type : null;

  if (existing === null) {
    await db.execute('INSERT INTO idea_community_votes (idea_id, user_id, vote_type) VALUES (?,?,?)', [ideaId, user.id, voteType]);
    const col = voteType === 'up' ? 'upvotes' : 'downvotes';
    await db.execute(`UPDATE ideas SET ${col} = ${col} + 1 WHERE id=?`, [ideaId]);
  } else if (existing === voteType) {
    await db.execute('DELETE FROM idea_community_votes WHERE idea_id=? AND user_id=?', [ideaId, user.id]);
    const col = voteType === 'up' ? 'upvotes' : 'downvotes';
    await db.execute(`UPDATE ideas SET ${col} = GREATEST(0, ${col} - 1) WHERE id=?`, [ideaId]);
  } else {
    await db.execute('UPDATE idea_community_votes SET vote_type=? WHERE idea_id=? AND user_id=?', [voteType, ideaId, user.id]);
    const oldCol = existing === 'up' ? 'upvotes' : 'downvotes';
    const newCol = voteType === 'up' ? 'upvotes' : 'downvotes';
    await db.execute(`UPDATE ideas SET ${oldCol}=GREATEST(0,${oldCol}-1), ${newCol}=${newCol}+1 WHERE id=?`, [ideaId]);
  }

  const stats = await communityVoteStats(db, ideaId, user.id);
  const communityScr = communityAdjustedScore(num(idea.ai_score), stats.upvotes, stats.downvotes);
  return { success: true, community_score: communityScr, ...stats };
}

// ── community_vote (ideas.php — recounts, no column update) ─────────
export async function communityVote(db, user, b) {
  const ideaId = num(b.idea_id);
  const voteType = b.vote_type ?? '';
  if (!ideaId || !['up', 'down'].includes(voteType)) {
    throw badRequest('idea_id and vote_type (up/down) required.');
  }

  const [irows] = await db.execute('SELECT id, submitter_id, status FROM ideas WHERE id=? LIMIT 1', [ideaId]);
  const idea = irows[0];
  if (!idea || !VOTABLE_STATUSES.includes(idea.status)) {
    throw notFound('Idea not available for voting.');
  }
  if (num(idea.submitter_id) === num(user.id)) throw forbidden('You cannot vote on your own idea.');

  const [exRows] = await db.execute('SELECT vote_type FROM idea_community_votes WHERE idea_id=? AND user_id=? LIMIT 1', [ideaId, user.id]);
  const current = exRows[0] ? exRows[0].vote_type : null;

  let newVote;
  if (current === voteType) {
    await db.execute('DELETE FROM idea_community_votes WHERE idea_id=? AND user_id=?', [ideaId, user.id]);
    newVote = null;
  } else if (current) {
    await db.execute('UPDATE idea_community_votes SET vote_type=? WHERE idea_id=? AND user_id=?', [voteType, ideaId, user.id]);
    newVote = voteType;
  } else {
    await db.execute('INSERT INTO idea_community_votes (idea_id, user_id, vote_type) VALUES (?, ?, ?)', [ideaId, user.id, voteType]);
    newVote = voteType;
  }

  const [up] = await db.execute("SELECT COUNT(*) AS c FROM idea_community_votes WHERE idea_id=? AND vote_type='up'", [ideaId]);
  const [dn] = await db.execute("SELECT COUNT(*) AS c FROM idea_community_votes WHERE idea_id=? AND vote_type='down'", [ideaId]);
  const upvotes = num(up[0].c);
  const downvotes = num(dn[0].c);

  await db.execute('UPDATE ideas SET upvotes=?, downvotes=? WHERE id=?', [upvotes, downvotes, ideaId]);

  const [aiRows] = await db.execute('SELECT ai_score FROM ideas WHERE id=?', [ideaId]);
  const aiScore = num(aiRows[0]?.ai_score);

  return {
    success: true,
    upvotes,
    downvotes,
    user_vote: newVote,
    community_score: communityAdjustedScore(aiScore, upvotes, downvotes),
  };
}

// ── community_stats (GET) ──────────────────────────────────────────
export async function communityStats(db, user, ideaId) {
  ideaId = num(ideaId);
  if (!ideaId) throw badRequest('Missing idea_id.');
  const [ai] = await db.execute('SELECT ai_score FROM ideas WHERE id=?', [ideaId]);
  const aiScore = num(ai[0]?.ai_score);
  const stats = await communityVoteStats(db, ideaId, user.id);
  return { success: true, community_score: communityAdjustedScore(aiScore, stats.upvotes, stats.downvotes), ...stats };
}

// ── poll_all (GET) ─────────────────────────────────────────────────
export async function pollAll(db) {
  const [rows] = await db.query(
    `SELECT icv.idea_id,
            SUM(CASE WHEN icv.vote_type='up'   THEN 1 ELSE 0 END) AS upvotes,
            SUM(CASE WHEN icv.vote_type='down' THEN 1 ELSE 0 END) AS downvotes,
            i.ai_score
     FROM idea_community_votes icv
     JOIN ideas i ON i.id = icv.idea_id
     GROUP BY icv.idea_id, i.ai_score`
  );
  const result = {};
  for (const r of rows) {
    const upv = num(r.upvotes);
    const dn = num(r.downvotes);
    result[num(r.idea_id)] = {
      upvotes: upv,
      downvotes: dn,
      community_score: communityAdjustedScore(num(r.ai_score), upv, dn),
    };
  }
  return { success: true, votes: result, ts: Math.floor(Date.now() / 1000) };
}

// ── stats (GET) ────────────────────────────────────────────────────
export async function stats(db, user, ideaId) {
  ideaId = num(ideaId);
  if (!ideaId) throw badRequest('Missing idea_id.');
  return { success: true, ...(await voteStats(db, ideaId, user.id)) };
}

// ── board (ideas.php — community board listing) ────────────────────
export async function board(db, user, sort) {
  const uid = num(user.id);
  const orderBy = ({ recent: 'i.created_at DESC', score: 'i.ai_score DESC' })[sort] || 'upvotes DESC';

  const [ideas] = await db.execute(
    `SELECT i.id, i.idea_code, i.title, i.present_situation, i.proposed_solution,
            i.impact_level, i.status, i.created_at, i.is_anonymous, i.ai_score,
            i.submitter_id, i.co_suggester_1_id, i.co_suggester_2_id, i.current_reviewer_id,
            -- Whether an approved idea has actually reached the QC tool. This
            -- list names its columns rather than using i.*, so the board would
            -- otherwise be the one screen where the "In QC" mark never appeared.
            i.qcms_push_status,
            u.name AS submitter_name, u.avatar_initials, u.department,
            (SELECT COUNT(*) FROM idea_community_votes WHERE idea_id=i.id AND vote_type='up')   AS upvotes,
            (SELECT COUNT(*) FROM idea_community_votes WHERE idea_id=i.id AND vote_type='down') AS downvotes,
            (SELECT vote_type FROM idea_community_votes WHERE idea_id=i.id AND user_id=?)  AS user_vote
     FROM ideas i
     JOIN users u ON u.id = i.submitter_id
     WHERE i.status IN ('Submitted','Under Review','Approved','Implemented')
       AND i.archived_at IS NULL
     ORDER BY ${orderBy}, i.created_at DESC
     LIMIT 100`,
    [uid]
  );

  const canSeeAnon = PRIVILEGED_ANON.includes(user.role);
  const boardSettings = await getOrgSettings(db);
  const mode = visibilityMode(boardSettings);
  const previewChars = parseInt(boardSettings.situation_preview_chars, 10) || 180;
  const sections = employeeSections(boardSettings);
  for (const idea of ideas) {
    if (idea.is_anonymous && !canSeeAnon) {
      idea.submitter_name = 'Anonymous';
      idea.avatar_initials = '?';
      idea.department = '—';
    }

    /*
     * The board is a LIST, and the same rule applies to it as to All Ideas
     * (MOM §11.4, §13.1): a browse view never carries the full proposal over
     * the wire, for anybody.
     *
     * This was missed when the redaction went in — the board is served by
     * votingService rather than ideaService, so it kept selecting
     * proposed_solution and shipping it to every employee. The screen only
     * rendered a snippet, which is exactly why it went unnoticed: the text was
     * sitting in the response the whole time. Found by comparing the two views
     * side by side (§11.3).
     */
    idea.viewer_inside = isInsideIdea(user, idea);
    idea.solution_summary = summariseSolution(idea.proposed_solution);
    idea.situation_summary = previewText(idea.present_situation, previewChars);
    idea.solution_redacted = !canReadSolution(user, idea, mode);
    idea.proposed_solution = null;
    idea.present_situation = null;

    /*
     * And the organisation's own rule about what a colleague outside an idea
     * may read. The board is where that rule bites hardest: All Ideas only ever
     * shows an employee their own submissions, so the board is the one screen
     * where they see everybody else's.
     */
    if (idea.solution_redacted) {
      if (!sections.includes('solution')) {
        idea.solution_summary = null;
        idea.solution_hidden_by_policy = true;
      }
      if (!sections.includes('situation')) {
        idea.situation_summary = null;
        idea.situation_hidden_by_policy = true;
      }
      if (!sections.includes('benefits')) {
        idea.tangible_benefit = null;
        idea.intangible_benefit = null;
      }
    }
  }
  return { success: true, ideas };
}

export default {
  voteStats, communityVoteStats, communityAdjustedScore,
  rate, upDownVote, communityVote, communityStats, pollAll, stats, board,
};

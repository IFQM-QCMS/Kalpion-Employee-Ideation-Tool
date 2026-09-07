/** Rewards & Recognition - the leaderboard as a document HR can act on. */
import config from '../config/index.js';
import { getApprovalConfig } from './settingsService.js';
import { badRequest } from '../utils/respond.js';

// The same points table the engine awards from, not a copy of it.
const POINTS = config.points;

/** The periods an organisation can ask for. */
export const PERIODS = {
  weekly: { label: 'Weekly', kind: 'week', weeks: 1 },
  fortnightly: { label: 'Fortnightly', kind: 'week', weeks: 2 },
  monthly: { label: 'Monthly', kind: 'month', months: 1 },
  quarterly: { label: 'Quarterly', kind: 'month', months: 3 },
  half_yearly: { label: 'Half-yearly', kind: 'month', months: 6 },
  yearly: { label: 'Yearly', kind: 'month', months: 12 },
};

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Turn a period name into a concrete, closed date range. */
export function resolveRange({ period = 'monthly', offset = 0, from = '', to = '' } = {}) {
  const off = Math.max(0, Math.min(60, parseInt(offset, 10) || 0));

  // An explicit range wins: an organisation whose reward cycle does not fit any of the named
  // periods should not be forced into one.
  if (from || to) {
    const okDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!okDate(from) || !okDate(to)) {
      throw badRequest('from and to must both be dates in YYYY-MM-DD form.');
    }
    if (from > to) throw badRequest('The start date must not be after the end date.');
    const end = new Date(`${to}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);   // inclusive `to`, half-open internally
    return {
      period: 'custom', offset: 0, start: from, end: ymd(end),
      label: 'Custom range', display: `${from} to ${to}`,
    };
  }

  const spec = PERIODS[period];
  if (!spec) {
    throw badRequest(`Unknown period "${period}". Choose one of: ${Object.keys(PERIODS).join(', ')}.`);
  }

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  let start;
  let end;

  if (spec.kind === 'week') {
    // Monday of the current week. getUTCDay() is 0 for Sunday, so Sunday maps back six days
    // rather than forward one.
    const dow = (today.getUTCDay() + 6) % 7;
    const thisMonday = new Date(today);
    thisMonday.setUTCDate(today.getUTCDate() - dow);

    end = new Date(thisMonday);
    end.setUTCDate(thisMonday.getUTCDate() - (off * spec.weeks * 7) + (off === 0 ? 7 : 0));
    start = new Date(end);
    start.setUTCDate(end.getUTCDate() - spec.weeks * 7);
  } else {
    // Calendar-aligned: snap to the block of months this period belongs to, so "quarterly"
    // gives Jan-Mar and never Feb-Apr.
    const m = today.getUTCMonth();
    const blockStart = Math.floor(m / spec.months) * spec.months;
    start = new Date(Date.UTC(today.getUTCFullYear(), blockStart - off * spec.months, 1));
    end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + spec.months, 1));
  }

  // The label names the window, not the setting - "1 Mar 2026 to 31 Mar 2026" is what a
  // reader can check; "monthly, offset 1" is not.
  const lastDay = new Date(end);
  lastDay.setUTCDate(end.getUTCDate() - 1);

  return {
    period, offset: off,
    start: ymd(start), end: ymd(end),
    label: spec.label,
    display: `${ymd(start)} to ${ymd(lastDay)}`,
  };
}

/** The whole leaderboard for a window - everybody, in order, with their ideas. */
export async function rewardsLeaderboard(db, opts = {}) {
  const range = resolveRange(opts);
  const includeAll = opts.include_all === true || opts.include_all === '1';

  // Points earned in the window, computed rather than read.
  const [rows] = await db.execute(
    `SELECT u.id, u.employee_id, u.name, u.email, u.phone, u.department,
            u.business_unit, u.location, u.role, u.points AS points_lifetime,
            u.avatar_initials,
            m.name AS manager_name,
            COUNT(i.id) AS ideas_submitted,
            SUM(i.status = 'Approved')    AS ideas_approved,
            SUM(i.status = 'Implemented') AS ideas_implemented,
            SUM(i.status = 'Rejected')    AS ideas_rejected,
            SUM(i.status IN ('Submitted','Under Review')) AS ideas_pending,
            COALESCE(SUM(i.points_awarded), 0) AS points_from_ideas,
            ROUND(AVG(NULLIF(i.ai_score, 0)), 1) AS avg_ai_score
       FROM users u
       LEFT JOIN users m ON m.id = u.manager_id
       LEFT JOIN ideas i
              ON i.submitter_id = u.id
             AND i.status <> 'Draft'
             AND i.submitted_at >= ? AND i.submitted_at < ?
      WHERE u.role NOT IN ('admin','super_admin')
      GROUP BY u.id
      ORDER BY u.name ASC`,
    [range.start, range.end]
  );

  const people = rows
    .map((r) => {
      const submitted = Number(r.ideas_submitted) || 0;
      const fromIdeas = Number(r.points_from_ideas) || 0;
      return {
        ...r,
        ideas_submitted: submitted,
        ideas_approved: Number(r.ideas_approved) || 0,
        ideas_implemented: Number(r.ideas_implemented) || 0,
        ideas_rejected: Number(r.ideas_rejected) || 0,
        ideas_pending: Number(r.ideas_pending) || 0,
        points_submission: submitted * POINTS.submit,
        points_from_ideas: fromIdeas,
        points_period: submitted * POINTS.submit + fromIdeas,
        points_lifetime: Number(r.points_lifetime) || 0,
      };
    })
    .filter((p) => includeAll || p.ideas_submitted > 0)
    // Ranked on the period score, then on how many ideas, then by name.
    .sort((a, b) => b.points_period - a.points_period
      || b.ideas_approved - a.ideas_approved
      || b.ideas_submitted - a.ideas_submitted
      || String(a.name).localeCompare(String(b.name)));

  // Equal scores share a rank - 1, 2, 2, 4 - because telling two people with identical
  // results that one of them came third is a fight nobody needs.
  let lastScore = null;
  let lastRank = 0;
  people.forEach((p, i) => {
    if (p.points_period !== lastScore) {
      lastRank = i + 1;
      lastScore = p.points_period;
    }
    p.rank = lastRank;
  });

  const totals = people.reduce((acc, p) => ({
    people: acc.people + 1,
    ideas: acc.ideas + p.ideas_submitted,
    approved: acc.approved + p.ideas_approved,
    implemented: acc.implemented + p.ideas_implemented,
    rejected: acc.rejected + p.ideas_rejected,
    pending: acc.pending + p.ideas_pending,
    points: acc.points + p.points_period,
  }), { people: 0, ideas: 0, approved: 0, implemented: 0, rejected: 0, pending: 0, points: 0 });

  return { success: true, range, totals, people, points_scheme: POINTS };
}

/*
 * Everything behind the numbers: every idea in the window, in full, with the people who
 * handled it and when.
 */
export async function rewardsDetail(db, opts = {}) {
  const base = await rewardsLeaderboard(db, opts);
  const { range } = base;

  const [ideas] = await db.execute(
    `SELECT i.*, u.name AS submitter_name, u.employee_id AS submitter_employee_id,
            u.department AS submitter_department, u.business_unit AS submitter_business_unit,
            u.email AS submitter_email,
            c1.name AS co1_name, c2.name AS co2_name,
            ch.title AS challenge_title
       FROM ideas i
       JOIN users u ON u.id = i.submitter_id
       LEFT JOIN users c1 ON c1.id = i.co_suggester_1_id
       LEFT JOIN users c2 ON c2.id = i.co_suggester_2_id
       LEFT JOIN challenges ch ON ch.id = i.challenge_id
      WHERE i.status <> 'Draft'
        AND i.submitted_at >= ? AND i.submitted_at < ?
      ORDER BY i.submitted_at ASC`,
    [range.start, range.end]
  );

  if (!ideas.length) {
    return { ...base, ideas: [], chain: (await getApprovalConfig(db)).approvers };
  }

  const ids = ideas.map((i) => i.id);

  // Fetched in chunks rather than one enormous IN list.
  const chunked = async (sql, list) => {
    const out = [];
    for (let n = 0; n < list.length; n += 1000) {
      const slice = list.slice(n, n + 1000);
      const [rows] = await db.query(sql.replace('{{IN}}', slice.map(() => '?').join(',')), slice);
      out.push(...rows);
    }
    return out;
  };

  // The approval trail, with the stage each decision was taken AT rather than the actor's
  // role today - see migration 036.
  const workflow = await chunked(
    `SELECT w.idea_id, w.action, w.comment, w.created_at, w.stage,
            u.name AS actor_name, u.employee_id AS actor_employee_id, u.role AS actor_role
       FROM idea_workflow w
       JOIN users u ON u.id = w.actor_id
      WHERE w.idea_id IN ({{IN}})
      ORDER BY w.idea_id, w.created_at ASC, w.id ASC`,
    ids
  );

  // The attachments are LISTED, not embedded.
  const attachments = await chunked(
    `SELECT idea_id, section, filename, filepath, uploaded_at
       FROM idea_attachments WHERE idea_id IN ({{IN}}) ORDER BY idea_id, id`,
    ids
  );

  const cosug = await chunked(
    `SELECT cs.idea_id, u.name, u.employee_id
       FROM idea_co_suggesters cs JOIN users u ON u.id = cs.user_id
      WHERE cs.idea_id IN ({{IN}}) ORDER BY cs.idea_id, cs.id`,
    ids
  );

  const cfg = await getApprovalConfig(db);
  const byIdea = (list) => {
    const m = new Map();
    for (const r of list) {
      if (!m.has(r.idea_id)) m.set(r.idea_id, []);
      m.get(r.idea_id).push(r);
    }
    return m;
  };
  const wfBy = byIdea(workflow);
  const atBy = byIdea(attachments);
  const csBy = byIdea(cosug);

  const full = ideas.map((i) => {
    const anon = !!i.is_anonymous;
    return {
      ...i,
      // Anonymity survives the reward pack. See the note above.
      submitter_name: anon ? 'Anonymous' : i.submitter_name,
      submitter_employee_id: anon ? '' : i.submitter_employee_id,
      submitter_email: anon ? '' : i.submitter_email,
      co_suggesters: anon ? [] : (csBy.get(i.id) || []),
      workflow: (wfBy.get(i.id) || []).map((w) => ({
        ...w,
        stage_label: w.stage ? (cfg.labels[w.stage] || w.stage) : null,
      })),
      attachments: atBy.get(i.id) || [],
    };
  });

  return {
    ...base,
    ideas: full,
    // The path configured at the time of export, so a reader can tell a chain that ran to
    // completion from one that stopped early.
    chain: cfg.approvers.map((a, n) => ({
      stage: a.stage, role: a.role, position: n + 1,
      label: cfg.labels[a.stage] || a.stage,
    })),
  };
}

export default { PERIODS, resolveRange, rewardsLeaderboard, rewardsDetail };

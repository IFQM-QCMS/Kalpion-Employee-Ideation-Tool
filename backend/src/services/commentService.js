/**
 * Comment service — Node port of PHP api/comments.php (threaded comments).
 *
 * Actions: list (nested top-level + replies with soft-delete placeholders),
 * add (with validation + parent check), delete (owner or admin/executive/
 * super_admin; soft-delete if the comment has replies, else hard-delete).
 *
 * The nesting + placeholder rules mirror the PHP exactly:
 *   • A soft-deleted comment is kept as a "[deleted]" placeholder ONLY if it
 *     still has replies; otherwise it is omitted from the tree.
 *   • Replies attach to their parent by shared object reference, so arbitrary
 *     depth nests correctly.
 */
import { badRequest, forbidden, notFound } from '../utils/respond.js';
import { getOrgSettings } from './mailerService.js';
import { employeeSections } from './ideaSections.js';

const ADMIN_ROLES = ['admin', 'executive', 'super_admin'];
// The same set ideaService treats as entitled to read a full proposal. Somebody
// in one of these roles is judging ideas, so the discussion is theirs to read.
const PRIVILEGED = ['manager', 'department_manager', 'senior_manager', 'plant_head',
  'executive', 'admin', 'super_admin'];

/**
 * Is this discussion open to this person?
 *
 * The author, their co-suggesters, the assigned reviewers and anyone senior
 * enough to be reviewing always see it. For everybody else it is one of the
 * sections the organisation controls, and the thread is where an idea gets
 * picked apart in detail - so an organisation that hides the proposal and
 * leaves the comments open has not hidden anything.
 */
async function canReadThread(db, user, ideaId) {
  if (!user) return false;
  if (PRIVILEGED.includes(user.role)) return true;

  const uid = Number(user.id);
  const [[idea] = []] = await db.execute(
    'SELECT submitter_id, current_reviewer_id, co_suggester_1_id, co_suggester_2_id FROM ideas WHERE id = ?',
    [ideaId]
  );
  if (!idea) return true;   // a missing idea is the caller's problem, not ours
  if ([idea.submitter_id, idea.current_reviewer_id,
       idea.co_suggester_1_id, idea.co_suggester_2_id].some((x) => Number(x) === uid)) {
    return true;
  }
  const [[cos] = []] = await db.execute(
    'SELECT 1 AS yes FROM idea_co_suggesters WHERE idea_id = ? AND user_id = ? LIMIT 1', [ideaId, uid]
  );
  if (cos) return true;
  const [[rv] = []] = await db.execute(
    'SELECT 1 AS yes FROM idea_reviewers WHERE idea_id = ? AND reviewer_id = ? LIMIT 1', [ideaId, uid]
  );
  if (rv) return true;

  return employeeSections(await getOrgSettings(db)).includes('comments');
}

// ── LIST ────────────────────────────────────────────────────────────
export async function list(db, ideaId, user = null) {
  ideaId = Number(ideaId) || 0;
  if (!ideaId) throw badRequest('idea_id is required.');

  // `user` is optional so existing callers keep working; when it is supplied
  // the organisation's section rules are applied.
  if (user && !(await canReadThread(db, user, ideaId))) {
    return { success: true, comments: [], comments_hidden: true };
  }

  const [rows] = await db.execute(
    `SELECT c.id, c.idea_id, c.parent_id, c.content, c.is_deleted, c.created_at,
            u.id AS user_id, u.name AS user_name, u.avatar_initials, u.role AS user_role
     FROM idea_comments c
     LEFT JOIN users u ON u.id = c.user_id
     WHERE c.idea_id = ?
     ORDER BY c.created_at ASC`,
    [ideaId]
  );

  // Which comment ids are referenced as a parent (i.e. have replies).
  const childParentIds = new Set();
  for (const r of rows) {
    if (r.parent_id) childParentIds.add(Number(r.parent_id));
  }

  // Build the id→comment map, applying soft-delete placeholder rules.
  const commentMap = new Map();
  for (const r of rows) {
    r.replies = [];
    if (Number(r.is_deleted) === 1) {
      if (!childParentIds.has(Number(r.id))) continue; // no replies → omit
      r.content = '[deleted]';
      r.user_name = null;
      r.avatar_initials = null;
      r.user_role = null;
    }
    commentMap.set(Number(r.id), r);
  }

  // Nest replies under parents (insertion order = created_at ASC, so parents
  // are always present before their children).
  const topLevel = [];
  for (const comment of commentMap.values()) {
    const pid = Number(comment.parent_id ?? 0);
    if (pid && commentMap.has(pid)) {
      commentMap.get(pid).replies.push(comment);
    } else {
      topLevel.push(comment);
    }
  }

  return { success: true, comments: topLevel };
}

// ── ADD ─────────────────────────────────────────────────────────────
export async function add(db, user, b) {
  const ideaId = Number(b.idea_id) || 0;
  const content = String(b.content ?? '').trim();
  const parentId = b.parent_id ? Number(b.parent_id) : null;

  if (!ideaId) throw badRequest('idea_id is required.');
  if (content === '') throw badRequest('Comment content cannot be empty.');
  if ([...content].length > 1000) throw badRequest('Comment cannot exceed 1000 characters.');

  const [ideaRows] = await db.execute('SELECT id FROM ideas WHERE id = ? LIMIT 1', [ideaId]);
  if (!ideaRows.length) throw notFound('Idea not found.');

  if (parentId !== null) {
    const [pRows] = await db.execute(
      'SELECT id FROM idea_comments WHERE id = ? AND idea_id = ? LIMIT 1',
      [parentId, ideaId]
    );
    if (!pRows.length) throw notFound('Parent comment not found.');
  }

  const [result] = await db.execute(
    `INSERT INTO idea_comments (idea_id, user_id, content, parent_id, is_deleted, created_at)
     VALUES (?, ?, ?, ?, 0, NOW())`,
    [ideaId, user.id, content, parentId]
  );
  return { success: true, comment_id: result.insertId };
}

// ── DELETE ──────────────────────────────────────────────────────────
export async function remove(db, user, id) {
  id = Number(id) || 0;
  if (!id) throw badRequest('Comment id is required.');

  const [rows] = await db.execute('SELECT * FROM idea_comments WHERE id = ? LIMIT 1', [id]);
  const comment = rows[0];
  if (!comment) throw notFound('Comment not found.');

  const isOwner = Number(comment.user_id) === Number(user.id);
  const isPriv = ADMIN_ROLES.includes(user.role);
  if (!isOwner && !isPriv) {
    throw forbidden('You do not have permission to delete this comment.');
  }

  const [rc] = await db.execute('SELECT COUNT(*) AS c FROM idea_comments WHERE parent_id = ?', [id]);
  const hasReplies = Number(rc[0].c) > 0;

  if (hasReplies) {
    await db.execute("UPDATE idea_comments SET is_deleted = 1, content = '' WHERE id = ?", [id]);
  } else {
    await db.execute('DELETE FROM idea_comments WHERE id = ?', [id]);
  }

  return { success: true };
}

export default { list, add, remove };

/**
 * Notification service — Node port of the `notifications` and `mark_read`
 * actions in PHP api/users.php.
 *
 *   list()      → the user's recent notifications, plus a TRUE unread count.
 *                 Back-fills a missing idea_id by scanning the message for an
 *                 IDA-YYYY-NNN code and linking (and persisting) the match.
 *   markRead()  → marks the given notifications read, or all of them.
 */

const IDEA_CODE_RE = /IDA-\d{4}-\d{3}/;

// Twenty was too few to be "your notifications" — an active reviewer passes
// that in a week, and the panel silently stopped at the twentieth with no way
// to reach the rest. Fifty is still one small indexed read.
const PAGE = 50;

export async function list(db, user, { limit } = {}) {
  const n = Math.max(1, Math.min(200, parseInt(limit, 10) || PAGE));
  const [notifs] = await db.execute(
    // Interpolated after clamping to an integer: MySQL 8 rejects a placeholder
    // in LIMIT on a prepared statement, which is what broke the user list.
    `SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT ${n}`,
    [user.id]
  );

  for (const item of notifs) {
    if (!item.idea_id) {
      const codeMatch = String(item.message ?? '').match(IDEA_CODE_RE) || String(item.title ?? '').match(IDEA_CODE_RE);
      if (codeMatch) {
        const [rows] = await db.execute('SELECT id FROM ideas WHERE idea_code = ? LIMIT 1', [codeMatch[0]]);
        const found = rows[0]?.id;
        if (found) {
          item.idea_id = Number(found);
          await db.execute('UPDATE notifications SET idea_id=? WHERE id=?', [found, item.id]);
        }
      }
    }
  }

  /*
   * Counted in the database, not by filtering the page above.
   *
   * The old version counted unread among the twenty rows it had just fetched,
   * so somebody with sixty unread notifications saw a badge reading "20" — and
   * clearing the visible ones made the badge jump to a number they had never
   * been shown. The badge has to describe the account, not the page.
   */
  const [[{ unread }]] = await db.execute(
    'SELECT COUNT(*) AS unread FROM notifications WHERE user_id=? AND is_read=0',
    [user.id]
  );
  const [[{ total }]] = await db.execute(
    'SELECT COUNT(*) AS total FROM notifications WHERE user_id=?',
    [user.id]
  );

  return {
    success: true,
    notifications: notifs,
    unread_count: Number(unread) || 0,
    total: Number(total) || 0,
    // So the panel can say "showing 50 of 137" rather than pretending 50 is all
    // there is, which is what it did before.
    has_more: Number(total) > notifs.length,
  };
}

/**
 * Mark notifications read.
 *
 * `ids` marks exactly those; omitting it marks everything for this user. The
 * controller used to drop the ids the client sent and always mark everything,
 * so clicking one notification quietly cleared the lot — which is why reading
 * one item made the whole panel go quiet.
 *
 * The user_id clause is not decoration: without it an id from another account
 * would be marked read by anyone who guessed the number.
 */
export async function markRead(db, user, ids = null) {
  const list_ = Array.isArray(ids)
    ? [...new Set(ids.map((v) => Number(v)).filter(Number.isFinite))]
    : null;

  if (list_ && list_.length) {
    const holes = list_.map(() => '?').join(',');
    const [r] = await db.execute(
      `UPDATE notifications SET is_read=1 WHERE user_id=? AND id IN (${holes})`,
      [user.id, ...list_]
    );
    return { success: true, updated: r.affectedRows };
  }

  // No ids supplied — "mark all read".
  const [r] = await db.execute(
    'UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0', [user.id]
  );
  return { success: true, updated: r.affectedRows };
}

export default { list, markRead };

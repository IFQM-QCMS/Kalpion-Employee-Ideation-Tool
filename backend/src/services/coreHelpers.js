/**
 * Shared per-tenant helpers — Node ports of the small utility functions in
 * PHP api/config.php (generateIdeaCode, addNotification, addWorkflow, addPoints).
 * Each takes the tenant `db` pool as its first argument.
 */

/**
 * Generate the next idea code: IDA-<year>-<NNN>. Mirrors generateIdeaCode().
 *
 * Derived from the highest code already issued this year, not from COUNT(*).
 * A count reuses a number as soon as any idea is deleted, and the column is
 * UNIQUE — so the next submission collided and the submitter got a 500 for
 * someone else's deletion. The caller still retries on a duplicate, because two
 * simultaneous submissions can read the same maximum.
 */
export async function generateIdeaCode(db) {
  const year = new Date().getFullYear();
  const [rows] = await db.execute(
    `SELECT MAX(CAST(SUBSTRING_INDEX(idea_code, '-', -1) AS UNSIGNED)) AS n
       FROM ideas WHERE idea_code LIKE ?`,
    [`IDA-${year}-%`]
  );
  const n = Number(rows[0].n || 0) + 1;
  return `IDA-${year}-${String(n).padStart(3, '0')}`;
}

/** Insert a notification. Mirrors addNotification(). */
export async function addNotification(db, userId, title, msg, ideaId = null) {
  await db.execute(
    'INSERT INTO notifications (user_id,title,message,idea_id) VALUES (?,?,?,?)',
    [userId, title, msg, ideaId]
  );
}

/**
 * Insert a workflow/audit entry.
 *
 * `stage` is the approval stage the actor was acting AT, and it is stored
 * rather than derived. The alternative is to read the actor's role when the
 * document is printed, which answers a different question: it says what that
 * person's job is today, not what they were when they signed. Somebody
 * promoted from team lead to plant head in March would silently rewrite every
 * approval they gave in January, and the closure PDF is exactly the document
 * where that matters — it is read to find out who signed off, in what capacity,
 * and in what order.
 *
 * Null for entries that are not approvals (a comment, a resubmission) and for
 * everything recorded before the column existed; the PDF falls back to the
 * actor's current role there and says nothing it cannot support.
 */
export async function addWorkflow(db, ideaId, actorId, action, comment = null, stage = null) {
  const allowed = ['Submitted', 'Reviewed', 'Approved', 'Rejected', 'Implemented', 'Commented', 'Reopened'];
  const safeAction = allowed.includes(action) ? action : 'Commented';
  const fullComment = allowed.includes(action) ? comment : `${action}${comment ? `: ${comment}` : ''}`;
  try {
    await db.execute(
      'INSERT INTO idea_workflow (idea_id,actor_id,action,comment,stage) VALUES (?,?,?,?,?)',
      [ideaId, actorId, safeAction, fullComment, stage]
    );
  } catch {
    /*
     * Fall back to the column set that has always existed.
     *
     * Not only for a too-long action: a tenant whose migration has not been
     * run yet has no `stage` column, and an audit entry that fails to write is
     * worse than one written without the stage on it. The trail is the point.
     */
    try {
      await db.execute(
        'INSERT INTO idea_workflow (idea_id,actor_id,action,comment) VALUES (?,?,?,?)',
        [ideaId, actorId, safeAction, fullComment]
      );
    } catch {
      try {
        await db.execute(
          'INSERT INTO idea_workflow (idea_id,actor_id,action,comment) VALUES (?,?,?,?)',
          [ideaId, actorId, String(action).slice(0, 50), comment]
        );
      } catch {}
    }
  }
}

/** Increment a user's points. Mirrors addPoints(). */
export async function addPoints(db, userId, pts) {
  await db.execute('UPDATE users SET points = points + ? WHERE id = ?', [pts, userId]);
}

export default { generateIdeaCode, addNotification, addWorkflow, addPoints };

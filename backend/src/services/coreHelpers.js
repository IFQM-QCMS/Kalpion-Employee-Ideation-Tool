/*
 * Shared per-tenant helpers - Node ports of the small utility functions in PHP
 * api/config.php (generateIdeaCode, addNotification, addWorkflow, addPoints).
 */

/** Generate the next idea code: IDA-<year>-<NNN>. */
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

/** Insert a workflow/audit entry. */
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
    // Fall back to the column set that has always existed.
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

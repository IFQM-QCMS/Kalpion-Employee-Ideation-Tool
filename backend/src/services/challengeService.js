/** Challenge service - Node port of PHP api/challenges.php (innovation challenges). */
import { badRequest, forbidden, notFound } from '../utils/respond.js';

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const UPDATE_ADMIN_ROLES = ['admin', 'executive', 'super_admin'];

// LIST
export async function list(db) {
  const [rows] = await db.query(
    `SELECT ch.*, u.name AS creator_name,
            (SELECT COUNT(*) FROM ideas i
             WHERE i.challenge_id = ch.id AND i.status != 'Draft') AS idea_count
     FROM challenges ch
     LEFT JOIN users u ON u.id = ch.created_by
     ORDER BY (ch.status = 'active') DESC, ch.deadline ASC`
  );
  return { success: true, challenges: rows };
}

// GET (challenge + linked ideas)
export async function get(db, id) {
  id = Number(id) || 0;
  if (!id) throw badRequest('id is required.');

  const [rows] = await db.execute(
    `SELECT ch.*, u.name AS creator_name
     FROM challenges ch
     LEFT JOIN users u ON u.id = ch.created_by
     WHERE ch.id = ? LIMIT 1`,
    [id]
  );
  const challenge = rows[0];
  if (!challenge) throw notFound('Challenge not found.');

  const [ideas] = await db.execute(
    `SELECT i.id, i.idea_code, i.title, i.status, i.ai_score,
            i.impact_level, i.impact_areas, i.submitted_at,
            u.name AS submitter_name, u.department, u.avatar_initials
     FROM ideas i
     JOIN users u ON u.id = i.submitter_id
     WHERE i.challenge_id = ? AND i.status != 'Draft'
     ORDER BY i.ai_score DESC, i.submitted_at ASC`,
    [id]
  );
  challenge.ideas = ideas;

  return { success: true, challenge };
}

// CREATE
export async function create(db, user, b) {
  const title = String(b.title ?? '').trim();
  const description = String(b.description ?? '').trim();
  const deadline = String(b.deadline ?? '').trim();

  if (title === '') throw badRequest('Title is required.');
  if (deadline !== '' && !/^\d{4}-\d{2}-\d{2}/.test(deadline)) {
    throw badRequest('Deadline must be a valid date (YYYY-MM-DD).');
  }

  const [result] = await db.execute(
    `INSERT INTO challenges (title, description, deadline, created_by, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', NOW(), NOW())`,
    [title, description || null, deadline || null, user.id]
  );
  return { success: true, id: result.insertId };
}

// UPDATE
export async function update(db, user, id, b) {
  id = Number(id) || 0;
  if (!id) throw badRequest('id is required.');

  const [rows] = await db.execute('SELECT * FROM challenges WHERE id = ? LIMIT 1', [id]);
  const challenge = rows[0];
  if (!challenge) throw notFound('Challenge not found.');

  const isCreator = Number(challenge.created_by) === Number(user.id);
  const isPriv = UPDATE_ADMIN_ROLES.includes(user.role);
  if (!isCreator && !isPriv) {
    throw forbidden('Only the creator or an admin/executive can update this challenge.');
  }

  const title = String(b.title ?? challenge.title).trim();
  const description = has(b, 'description') ? String(b.description).trim() : challenge.description;
  const deadline = has(b, 'deadline') ? String(b.deadline).trim() : challenge.deadline;
  const status = b.status ?? challenge.status;

  if (title === '') throw badRequest('Title cannot be empty.');
  if (!['active', 'closed', 'draft'].includes(status)) throw badRequest('Invalid status value.');

  await db.execute(
    `UPDATE challenges SET title = ?, description = ?, deadline = ?, status = ?, updated_at = NOW()
     WHERE id = ?`,
    [title, description || null, deadline || null, status, id]
  );
  return { success: true };
}

// DELETE (orphan linked ideas first)
export async function remove(db, id) {
  id = Number(id) || 0;
  if (!id) throw badRequest('id is required.');

  const [rows] = await db.execute('SELECT id FROM challenges WHERE id = ? LIMIT 1', [id]);
  if (!rows.length) throw notFound('Challenge not found.');

  await db.execute('UPDATE ideas SET challenge_id = NULL WHERE challenge_id = ?', [id]);
  await db.execute('DELETE FROM challenges WHERE id = ?', [id]);
  return { success: true };
}

export default { list, get, create, update, remove };

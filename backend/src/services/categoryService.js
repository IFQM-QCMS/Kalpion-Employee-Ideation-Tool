/** Idea categories - the list an organisation offers on the submission wizard. */
import { badRequest, notFound, ApiError } from '../utils/respond.js';

const MAX_NAME = 80;
/*
 * A guard against a runaway list, not a business rule - the wizard renders every category
 * as a chip, and a few hundred of them is not a form.
 */
const MAX_CATEGORIES = 40;

// LIST
/** Every signed-in user reads this (the submission wizard needs it). */
export async function list(db) {
  const [rows] = await db.query(
    `SELECT c.id, c.name, c.sort_order,
            (SELECT COUNT(*) FROM ideas i
              WHERE FIND_IN_SET(c.name, REPLACE(i.impact_areas, ', ', ','))) AS idea_count
       FROM idea_categories c
      ORDER BY c.sort_order ASC, c.id ASC`
  );
  return { success: true, categories: rows };
}

// CREATE
export async function create(db, b) {
  const name = String(b?.name ?? '').trim().replace(/\s+/g, ' ');

  if (!name) throw badRequest('Category name is required.');
  if (name.length > MAX_NAME) throw badRequest(`Category name must be ${MAX_NAME} characters or fewer.`);
  // A comma would split one category into two the moment it is written into the
  // comma-separated impact_areas column.
  if (name.includes(',')) throw badRequest('Category name cannot contain a comma.');

  const [[{ c: count }]] = await db.query('SELECT COUNT(*) AS c FROM idea_categories');
  if (Number(count) >= MAX_CATEGORIES) {
    throw badRequest(`You can have at most ${MAX_CATEGORIES} categories.`);
  }

  const [dup] = await db.execute('SELECT id FROM idea_categories WHERE name = ? LIMIT 1', [name]);
  if (dup.length) throw new ApiError(409, 'That category already exists.');

  const [[{ next }]] = await db.query(
    'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM idea_categories'
  );
  const [res] = await db.execute(
    'INSERT INTO idea_categories (name, sort_order) VALUES (?, ?)',
    [name, next]
  );
  return { success: true, id: res.insertId, name, sort_order: next };
}

// DELETE
export async function remove(db, id) {
  id = Number(id) || 0;
  if (!id) throw badRequest('id is required.');

  const [rows] = await db.execute('SELECT id, name FROM idea_categories WHERE id = ? LIMIT 1', [id]);
  const category = rows[0];
  if (!category) throw notFound('Category not found.');

  // An empty list would leave the submission wizard with nothing to offer and no way back
  // except SQL.
  const [[{ c: count }]] = await db.query('SELECT COUNT(*) AS c FROM idea_categories');
  if (Number(count) <= 1) throw badRequest('You must keep at least one category.');

  await db.execute('DELETE FROM idea_categories WHERE id = ?', [id]);
  return { success: true, deleted: category.name };
}

export default { list, create, remove };

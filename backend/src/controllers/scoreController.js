/** Score controller - the two REST endpoints of PHP api/score.php. */
import { computeAIScoreWithReason, saveIdeaScore } from '../services/aiService.js';
import { respond, notFound } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

/** GET /api/score?id= - recompute + save a single idea's AI score. */
export const score = asyncHandler(async (req, res) => {
  const id = Number(req.query.id) || 0;
  const [rows] = await req.db.execute('SELECT * FROM ideas WHERE id = ?', [id]);
  const idea = rows[0];
  if (!idea) throw notFound('Idea not found.');

  const ai = await computeAIScoreWithReason(idea);
  await saveIdeaScore(req.db, id, ai.score, ai.reason);

  return respond(res, {
    success: true,
    id,
    ai_score: ai.score,
    ai_reason: ai.reason,
    source: ai.source,
    breakdown: ai.breakdown ?? null,
  });
});

/** POST /api/score/batch-rescore - recompute + save every idea (admin only). */
export const batchRescore = asyncHandler(async (req, res) => {
  const [ideas] = await req.db.query('SELECT * FROM ideas');
  let updated = 0;
  for (const idea of ideas) {
    const ai = await computeAIScoreWithReason(idea);
    await saveIdeaScore(req.db, Number(idea.id), ai.score, ai.reason);
    updated++;
  }
  return respond(res, { success: true, updated });
});

export default { score, batchRescore };

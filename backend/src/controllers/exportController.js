/**
 * Export controller — sends raw CSV / HTML (not JSON). Maps to api/export.php.
 */
import * as exportService from '../services/exportService.js';
import * as ideaService from '../services/ideaService.js';
import { buildIdeaPdf, buildIdeaGistPdf } from '../services/ideaPdfService.js';
import asyncHandler from '../utils/asyncHandler.js';

function csvHeaders(res, filename) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('Pragma', 'no-cache');
}

export const ideas = asyncHandler(async (req, res) => {
  const { csv, filename } = await exportService.ideasCsv(req.db, req.user, {
    status: req.query.status, search: req.query.search, impact: req.query.impact,
  });
  csvHeaders(res, filename);
  res.send(csv);
});

export const leaderboard = asyncHandler(async (req, res) => {
  const { csv, filename } = await exportService.leaderboardCsv(req.db);
  csvHeaders(res, filename);
  res.send(csv);
});

export const analytics = asyncHandler(async (req, res) => {
  const html = await exportService.analyticsHtml(req.db);
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.send(html);
});

// Single idea → Closure Summary PDF. The route restricts this to the review
// hierarchy; the idea is loaded through the caller's own tenant pool, so an id
// from another organisation simply 404s (no cross-tenant read is possible).
export const ideaPdf = asyncHandler(async (req, res) => {
  const { idea } = await ideaService.get(req.db, req.user, req.params.id);

  /*
   * Two documents, chosen by who is asking.
   *
   * Somebody inside the idea - its author, a colleague credited on it, or one
   * of the people reviewing it - gets the closure summary: the full working
   * record. Everybody else gets a one-page gist.
   *
   * The split is not only about what the reader may read. ideaService has
   * already emptied the fields they are not entitled to, so handing them the
   * closure form would produce two pages of blank boxes: it looks like a broken
   * export and it invites the reader to wonder what was removed. A document
   * that says "summary" on its face is both safer and more honest.
   */
  const inside = idea.viewer_inside === true;
  const code = idea.idea_code || idea.id;
  const filename = inside
    ? `idea_${code}_closure_summary.pdf`
    : `idea_${code}_summary.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-cache, no-store');

  if (inside) buildIdeaPdf(idea, res);
  else buildIdeaGistPdf(idea, res, req.user);
});

export default { ideas, leaderboard, analytics, ideaPdf };

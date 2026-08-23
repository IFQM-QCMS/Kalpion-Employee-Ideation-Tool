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

/**
 * GET /api/export/user-guide — the manual for whoever is asking.
 *
 * ── Why the role decides the file ──────────────────────────────────────────
 *
 * There are three manuals, and handing an employee the platform-admin one is
 * not a small mistake. It describes screens they cannot open, a console they
 * have no account for, and other organisations they must never learn exist —
 * so the wrong manual is both useless to them and a disclosure of how the
 * vendor side works.
 *
 * The role comes from the SESSION, never from the request. A `?role=` would be
 * a way for anybody to ask for the platform-admin manual by typing it.
 *
 * ── Falling back rather than failing ───────────────────────────────────────
 *
 * A role with no manual of its own gets the employee one, because every role
 * here submits and tracks ideas as well as whatever else they do. Only a
 * deployment shipped without the folder at all gets a 404, and it says so
 * plainly rather than serving a broken download.
 */
const MANUALS = {
  // Platform staff — the vendor console.
  platform_admin: {
    file: 'Manual_PlatformAdmin.pdf',
    name: 'IFQM-Platform-Admin-Manual.pdf',
  },
  // Whoever runs one organisation: users, approval chain, analytics, billing.
  admin: { file: 'Manual_OrgAdmin.pdf', name: 'IFQM-Organisation-Admin-Manual.pdf' },
  super_admin: { file: 'Manual_OrgAdmin.pdf', name: 'IFQM-Organisation-Admin-Manual.pdf' },
  // Everybody else. Reviewers included: they submit and track like anyone else,
  // and the approval queue is covered in the employee manual.
  employee: { file: 'Manual_Employee.pdf', name: 'IFQM-Employee-Manual.pdf' },
};

export const userGuide = asyncHandler(async (req, res) => {
  const { createReadStream } = await import('node:fs');
  const fsp = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const role = String(req.user?.role || 'employee');
  const pick = MANUALS[role] || MANUALS.employee;

  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, '..', '..', '..');
  const file = path.join(root, 'User manuals', pick.file);

  try {
    await fsp.access(file);
  } catch {
    return res.status(404).json({
      success: false,
      error: 'The user manual is not available on this deployment.',
    });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${pick.name}"`);
  // Streamed rather than read into memory: each is a few hundred kilobytes and
  // several people may ask at once.
  return createReadStream(file).pipe(res);
});

export default { ideas, leaderboard, analytics, ideaPdf, userGuide };

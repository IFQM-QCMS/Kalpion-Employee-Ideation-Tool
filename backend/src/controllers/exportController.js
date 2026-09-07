/** Export controller - sends raw CSV / HTML (not JSON). */
import * as exportService from '../services/exportService.js';
import * as ideaService from '../services/ideaService.js';
import { buildIdeaPdf, buildIdeaGistPdf } from '../services/ideaPdfService.js';
import { buildLeaderboardPdf } from '../services/leaderboardPdfService.js';
import { sendViaPlatform } from '../services/mailerService.js';
import { badRequest, ApiError } from '../utils/respond.js';
import logger from '../utils/logger.js';
import * as leaderboardService from '../services/leaderboardService.js';
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

/** GET /api/export/leaderboard-pdf - the leaderboard as a document. */
export const leaderboardPdf = asyncHandler(async (req, res) => {
  const period = String(req.query.period || 'all');
  const data = await leaderboardService.leaderboard(req.db, period);

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `attachment; filename="leaderboard_${period}_${stamp}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');

  const doc = buildLeaderboardPdf(data.individuals || [], {
    orgName: req.tenant?.name || req.user?.org_name || '',
    period,
  });
  doc.pipe(res);
});

/** POST /api/export/leaderboard/send - forward the leaderboard to HR. */
export const sendLeaderboard = asyncHandler(async (req, res) => {
  const to = String(req.body?.to || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(to)) {
    throw badRequest('Enter a valid email address to send this to.');
  }

  const period = String(req.body?.period || 'all');
  const note = String(req.body?.note || '').slice(0, 500);
  const orgName = req.tenant?.name || req.user?.org_name || 'IFQM';

  const data = await leaderboardService.leaderboard(req.db, period);
  const rows = data.individuals || [];
  if (!rows.length) throw badRequest('There is nothing on the leaderboard for this period yet.');

  // The PDF has to be a Buffer, not a stream: an attachment is sent as one value and the
  // transport cannot wait on a stream it did not create.
  const pdf = await new Promise((resolve, reject) => {
    const chunks = [];
    const doc = buildLeaderboardPdf(rows, { orgName, period });
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const esc = (v) => String(v ?? '').replace(/[<>&]/g, '');
  const top = rows.slice(0, 5)
    .map((r, i) => `<tr><td style="padding:3px 12px 3px 0">${i + 1}.</td>`
      + `<td style="padding:3px 12px 3px 0"><b>${esc(r.name)}</b></td>`
      + `<td style="padding:3px 0;color:#667089">${esc(r.department) || '-'}</td>`
      + `<td style="padding:3px 0 3px 12px;text-align:right">${esc(r.points)} pts</td></tr>`)
    .join('');

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">
  <p>Hello,</p>
  <p><b>${esc(req.user.name)}</b> has shared the ${esc(orgName)} idea leaderboard with you
     for Rewards &amp; Recognition.</p>
  ${note ? `<p style="padding:10px 14px;background:#f4f4f7;border-left:3px solid #4f46e5;margin:14px 0">${esc(note)}</p>` : ''}
  <table style="border-collapse:collapse;font-size:14px;margin:16px 0">${top}</table>
  <p style="color:#667089;font-size:13px">The full ranking is attached as a PDF.</p>
</div>`;

  const emailed = await sendViaPlatform(
    to, '', `Idea leaderboard - ${orgName}`, html,
    [{
      filename: `leaderboard_${period}_${new Date().toISOString().slice(0, 10)}.pdf`,
      content: pdf,
      contentType: 'application/pdf',
    }]
  ).catch((e) => { throw new ApiError(502, `The leaderboard could not be sent: ${e.message}`); });

  if (emailed && emailed.success === false) {
    throw new ApiError(502, emailed.error || 'The leaderboard could not be sent.');
  }

  logger.info(`leaderboard forwarded to ${to} by user ${req.user.id}`);
  res.json({ success: true, sent_to: to, rows: rows.length });
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

// Single idea Closure Summary PDF.
export const ideaPdf = asyncHandler(async (req, res) => {
  const { idea } = await ideaService.get(req.db, req.user, req.params.id);

  // Two documents, chosen by who is asking.
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

/** GET /api/export/user-guide - the manual for whoever is asking. */
const MANUALS = {
  // Platform staff - the vendor console.
  platform_admin: {
    file: 'Manual_PlatformAdmin.pdf',
    name: 'Kalpion-Platform-Admin-Manual.pdf',
  },
  // Whoever runs one organisation: users, approval chain, analytics, billing.
  admin: { file: 'Manual_OrgAdmin.pdf', name: 'Kalpion-Organisation-Admin-Manual.pdf' },
  super_admin: { file: 'Manual_OrgAdmin.pdf', name: 'Kalpion-Organisation-Admin-Manual.pdf' },
  // Everybody else. Reviewers included: they submit and track like anyone else, and the
  // approval queue is covered in the employee manual.
  employee: { file: 'Manual_Employee.pdf', name: 'Kalpion-Employee-Manual.pdf' },
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
  // Streamed rather than read into memory: each is a few hundred kilobytes and several
  // people may ask at once.
  return createReadStream(file).pipe(res);
});

export default { ideas, leaderboard, leaderboardPdf, sendLeaderboard, analytics, ideaPdf, userGuide };

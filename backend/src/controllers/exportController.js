/**
 * Export controller — sends raw CSV / HTML (not JSON). Maps to api/export.php.
 */
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

/**
 * GET /api/export/leaderboard-pdf — the leaderboard as a document.
 *
 * HR run Rewards & Recognition from this, and the CSV they had was not a
 * document: open it a month later and it is a grid of numbers with nothing on
 * it saying which period it covers or when it was produced. This carries the
 * organisation's name, the period and the timestamp, so it can be attached to
 * a mail, tabled in a meeting and filed as the record afterwards.
 *
 * The period comes from the query string and is whitelisted by the leaderboard
 * service itself — it maps to a fixed SQL fragment and is never interpolated.
 */
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

/**
 * POST /api/export/leaderboard/send — forward the leaderboard to HR.
 *
 * MOM 24/08 §1. The leaderboard is what Rewards & Recognition is decided from,
 * and getting it to the people who run R&R was a copy-paste into a mail client:
 * the existing "Email" button opens a mailto:, which cannot carry an
 * attachment, so what HR received was ten lines of plain text with no record of
 * the period or the numbers behind it.
 *
 * This sends the actual document.
 *
 * ── Why it is restricted ──────────────────────────────────────────────────
 *
 * The route is guarded by requireRole (see exportRoutes) rather than a check in
 * here, which is how every other restricted route in this file is done.
 *
 * It needs guarding because an endpoint that takes an arbitrary address and
 * sends mail from the platform's own verified domain is a spam relay if anyone
 * can reach it — the message arrives carrying IFQM's authentication, which is
 * exactly what makes it worth abusing. The leaderboard itself is not sensitive;
 * the ability to send mail as IFQM is.
 *
 * The recipient is validated rather than trusted: a header-injection attempt
 * ("hr@x.com\nBcc: …") fails the pattern before it reaches the transport, and
 * headerSafe() in the mailer strips CR/LF as a second line of defence.
 */
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

  /*
   * The PDF has to be a Buffer, not a stream: an attachment is sent as one
   * value and the transport cannot wait on a stream it did not create. So the
   * document is collected before the mail is composed.
   */
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
      + `<td style="padding:3px 0;color:#667089">${esc(r.department) || '—'}</td>`
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
    to, '', `Idea leaderboard — ${orgName}`, html,
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
    name: 'Kalpion-Platform-Admin-Manual.pdf',
  },
  // Whoever runs one organisation: users, approval chain, analytics, billing.
  admin: { file: 'Manual_OrgAdmin.pdf', name: 'Kalpion-Organisation-Admin-Manual.pdf' },
  super_admin: { file: 'Manual_OrgAdmin.pdf', name: 'Kalpion-Organisation-Admin-Manual.pdf' },
  // Everybody else. Reviewers included: they submit and track like anyone else,
  // and the approval queue is covered in the employee manual.
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
  // Streamed rather than read into memory: each is a few hundred kilobytes and
  // several people may ask at once.
  return createReadStream(file).pipe(res);
});

export default { ideas, leaderboard, leaderboardPdf, sendLeaderboard, analytics, ideaPdf, userGuide };

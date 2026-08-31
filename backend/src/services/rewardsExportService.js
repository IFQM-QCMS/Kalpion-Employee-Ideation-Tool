/**
 * The Rewards & Recognition pack, as a workbook and as a PDF.
 *
 * ── Two formats because they are read by two different people ─────────────
 *
 * The spreadsheet is for HR to work IN: sort it, filter it, paste a column into
 * a payroll sheet, add a "reward given" column of their own. The PDF is for HR
 * to file and circulate — the thing attached to an approval email, read on a
 * phone, and produced two years later when somebody asks why a particular
 * person got a certificate.
 *
 * Both carry the same numbers from the same query, so the two can never
 * disagree. That matters more than it sounds: a spreadsheet and a PDF of "the
 * same" report that differ by one person is how a reward process loses its
 * credibility, and the cause is always two code paths computing separately.
 */
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { registerFonts, makeTextScriptAware } from './pdfFonts.js';

// ── Shared formatting ───────────────────────────────────────────────────────

const s = (v) => (v == null ? '' : String(v));

/** A date as somebody reads it, not as the database stores it. */
function fmtDate(v) {
  if (!v) return '';
  const d = new Date(String(v).replace(' ', 'T') + (String(v).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return s(v);
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function fmtDateTime(v) {
  if (!v) return '';
  const d = new Date(String(v).replace(' ', 'T') + (String(v).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return s(v);
  return `${fmtDate(v)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

/**
 * One line describing what an approver did and where they stood.
 *
 * The stage is what was RECORDED at the time (migration 036), so somebody
 * promoted since still reads as the capacity they signed in. Rows from before
 * that column existed fall back to the actor's current role and say so with a
 * "?", because presenting a guess as a record is the one thing an audit trail
 * must not do.
 */
function trailLine(w) {
  const who = s(w.actor_name) || '—';
  const where = w.stage_label
    ? w.stage_label
    : (w.actor_role ? `${s(w.actor_role).replace(/_/g, ' ')} ?` : '');
  return `${fmtDateTime(w.created_at)} — ${who}${where ? ` (${where})` : ''}: ${s(w.action)}`
    + (w.comment ? ` — "${s(w.comment)}"` : '');
}

// ── Workbook ────────────────────────────────────────────────────────────────

const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2545' } };
const HEAD_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };

function styleHeader(ws) {
  const row = ws.getRow(1);
  row.font = HEAD_FONT;
  row.fill = HEAD_FILL;
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

/**
 * The pack as a workbook.
 *
 * Five sheets, because HR asked five different questions and one flat table
 * cannot answer them all without repeating an idea's full text on every row of
 * its approval trail.
 */
export async function buildRewardsWorkbook(data, orgName) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kalpion';
  wb.created = new Date();

  // ── 1. Summary — what this document covers ──
  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 34 }, { width: 60 }];
  const put = (k, v) => sum.addRow([k, v]);
  put('Organisation', orgName || '');
  put('Report', 'Rewards & Recognition — leaderboard');
  put('Period', `${data.range.label} (${data.range.display})`);
  put('Generated', fmtDateTime(new Date().toISOString()));
  put('', '');
  put('People listed', data.totals.people);
  put('Ideas submitted in period', data.totals.ideas);
  put('Approved', data.totals.approved);
  put('Implemented', data.totals.implemented);
  put('Rejected', data.totals.rejected);
  put('Still in review', data.totals.pending);
  put('Total points awarded', data.totals.points);
  put('', '');
  put('Points scheme', `Submit ${data.points_scheme.submit} · Approved ${data.points_scheme.approved}`
    + ` · Implemented ${data.points_scheme.implemented}`);
  put('Approval path', (data.chain || []).map((c) => `${c.position}. ${c.label}`).join('  →  '));
  put('', '');
  /*
   * Said in the document, not only in the code. Whoever reads this in a year
   * needs to know which window an idea was counted in without going to ask.
   */
  put('How the period is applied',
    'An idea counts in the period it was SUBMITTED in, even where its approval came later. '
    + 'Each idea carries its own dates below.');
  put('Anonymous ideas',
    'Listed without the author. An organisation that offered anonymity keeps it here too.');
  put('Attachments',
    'Listed by name on the Attachments sheet. The files themselves are not embedded.');
  sum.getColumn(1).font = { bold: true };
  sum.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

  // ── 2. Leaderboard — everybody, in order ──
  const lb = wb.addWorksheet('Leaderboard');
  lb.columns = [
    { header: 'Rank', key: 'rank', width: 7 },
    { header: 'Employee ID', key: 'employee_id', width: 14 },
    { header: 'Name', key: 'name', width: 26 },
    { header: 'Department', key: 'department', width: 20 },
    { header: 'Business unit', key: 'business_unit', width: 18 },
    { header: 'Role', key: 'role', width: 18 },
    { header: 'Reports to', key: 'manager_name', width: 22 },
    { header: 'Ideas submitted', key: 'ideas_submitted', width: 15 },
    { header: 'Approved', key: 'ideas_approved', width: 11 },
    { header: 'Implemented', key: 'ideas_implemented', width: 12 },
    { header: 'Rejected', key: 'ideas_rejected', width: 10 },
    { header: 'In review', key: 'ideas_pending', width: 11 },
    { header: 'Points — submission', key: 'points_submission', width: 18 },
    { header: 'Points — outcomes', key: 'points_from_ideas', width: 17 },
    { header: 'Points this period', key: 'points_period', width: 17 },
    { header: 'Points lifetime', key: 'points_lifetime', width: 15 },
    { header: 'Avg AI score', key: 'avg_ai_score', width: 13 },
    { header: 'Email', key: 'email', width: 26 },
    { header: 'Phone', key: 'phone', width: 16 },
  ];
  for (const p of data.people) {
    lb.addRow({ ...p, role: s(p.role).replace(/_/g, ' ') });
  }
  styleHeader(lb);
  // The two components sit beside the total on purpose: a score somebody is
  // rewarded against should be checkable without re-deriving it.
  lb.getColumn('points_period').font = { bold: true };

  // ── 3. Ideas — the whole of each one ──
  const id = wb.addWorksheet('Ideas');
  id.columns = [
    { header: 'Idea code', key: 'idea_code', width: 14 },
    { header: 'Submitted by', key: 'submitter_name', width: 24 },
    { header: 'Employee ID', key: 'submitter_employee_id', width: 13 },
    { header: 'Department', key: 'submitter_department', width: 18 },
    { header: 'Co-suggesters', key: 'co_suggesters', width: 26 },
    { header: 'Title', key: 'title', width: 40 },
    { header: 'Status', key: 'status', width: 13 },
    { header: 'Submitted on', key: 'submitted_at', width: 15 },
    { header: 'Last updated', key: 'updated_at', width: 15 },
    { header: 'Present situation', key: 'present_situation', width: 50 },
    { header: 'Proposed solution', key: 'proposed_solution', width: 50 },
    { header: 'Impact level', key: 'impact_level', width: 12 },
    { header: 'Impact areas', key: 'impact_areas', width: 20 },
    { header: 'Tangible benefit', key: 'tangible_benefit', width: 30 },
    { header: 'Intangible benefit', key: 'intangible_benefit', width: 30 },
    { header: 'Benefits expected', key: 'benefits_expected', width: 30 },
    { header: 'Investment required', key: 'investment_required', width: 16 },
    { header: 'Feasibility', key: 'feasibility', width: 14 },
    { header: 'Implementation duration', key: 'implementation_duration', width: 18 },
    { header: 'Expected implementation', key: 'expected_implementation_date', width: 18 },
    { header: 'Support required', key: 'support_required', width: 28 },
    { header: 'Challenge', key: 'challenge_title', width: 22 },
    { header: 'AI score', key: 'ai_score', width: 9 },
    { header: 'Points awarded', key: 'points_awarded', width: 13 },
    { header: 'Attachments', key: 'attachment_count', width: 12 },
    { header: 'Approvals recorded', key: 'approval_count', width: 16 },
  ];
  for (const i of data.ideas) {
    id.addRow({
      ...i,
      submitted_at: fmtDate(i.submitted_at),
      updated_at: fmtDate(i.updated_at),
      expected_implementation_date: fmtDate(i.expected_implementation_date),
      co_suggesters: (i.co_suggesters || []).map((c) => c.name).join(', '),
      attachment_count: (i.attachments || []).length,
      approval_count: (i.workflow || []).filter((w) => /approved/i.test(s(w.action))).length,
    });
  }
  styleHeader(id);
  id.eachRow((row, n) => { if (n > 1) row.alignment = { vertical: 'top', wrapText: true }; });

  // ── 4. Approval trail — one row per decision ──
  const tr = wb.addWorksheet('Approval trail');
  tr.columns = [
    { header: 'Idea code', key: 'idea_code', width: 14 },
    { header: 'Title', key: 'title', width: 36 },
    { header: 'Step', key: 'step', width: 6 },
    { header: 'When', key: 'when', width: 22 },
    { header: 'Who', key: 'who', width: 24 },
    { header: 'Employee ID', key: 'emp', width: 13 },
    { header: 'Position at the time', key: 'position', width: 22 },
    { header: 'Position recorded?', key: 'recorded', width: 17 },
    { header: 'Action', key: 'action', width: 14 },
    { header: 'Comment', key: 'comment', width: 50 },
  ];
  for (const i of data.ideas) {
    (i.workflow || []).forEach((w, n) => {
      tr.addRow({
        idea_code: i.idea_code,
        title: i.title,
        step: n + 1,
        when: fmtDateTime(w.created_at),
        who: w.actor_name,
        emp: w.actor_employee_id,
        position: w.stage_label || s(w.actor_role).replace(/_/g, ' '),
        // Spelled out rather than left as a bare "?" — a spreadsheet gets
        // filtered, and "inferred" is a word somebody can filter on.
        recorded: w.stage_label ? 'recorded' : 'inferred from role today',
        action: w.action,
        comment: w.comment,
      });
    });
  }
  styleHeader(tr);

  // ── 5. Attachments ──
  const at = wb.addWorksheet('Attachments');
  at.columns = [
    { header: 'Idea code', key: 'idea_code', width: 14 },
    { header: 'Title', key: 'title', width: 40 },
    { header: 'Section', key: 'section', width: 14 },
    { header: 'File name', key: 'filename', width: 40 },
    { header: 'Uploaded', key: 'uploaded_at', width: 22 },
  ];
  for (const i of data.ideas) {
    for (const a of i.attachments || []) {
      at.addRow({
        idea_code: i.idea_code,
        title: i.title,
        section: a.section,
        filename: a.filename,
        uploaded_at: fmtDateTime(a.uploaded_at),
      });
    }
  }
  styleHeader(at);

  return wb;
}

// ── PDF ─────────────────────────────────────────────────────────────────────

const NAVY = '#0b2545';
const INK = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#dfe3ea';
const ROW_ALT = '#f7f9fc';
const MARGIN = 36;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const RIGHT = PAGE_W - MARGIN;
const CONTENT_W = RIGHT - MARGIN;

/**
 * The pack as a PDF.
 *
 * Portrait, because it is read on a phone as often as printed, and because the
 * leaderboard is the part people actually look at — the idea dossiers behind it
 * are reference material somebody turns to when a specific award is questioned.
 *
 * Streamed into `res` rather than buffered: a year's pack for a 500-person site
 * runs to hundreds of pages, and holding all of it in memory to compute a
 * Content-Length nobody reads would be the one thing that makes this fall over
 * on the smallest instance we support.
 */
export function buildRewardsPdf(data, res, orgName) {
  const doc = new PDFDocument({
    size: 'A4', margin: MARGIN, bufferPages: true,
    info: {
      Title: `Rewards & Recognition — ${data.range.display}`,
      Author: orgName || 'Kalpion',
    },
  });
  registerFonts(doc);
  /*
   * Every string in this document is user data — names, idea text, comments —
   * and an Indian shop floor writes them in Kannada, Tamil and Devanagari as
   * readily as in English. This makes each doc.text() pick a face that can
   * actually shape what it is given, instead of drawing a row of blank boxes
   * with correct advance widths, which is the failure mode that looks fine
   * until somebody who reads the script opens it.
   */
  makeTextScriptAware(doc);
  doc.pipe(res);

  let y = MARGIN;

  const room = (need) => {
    if (y + need > PAGE_H - MARGIN - 24) {
      doc.addPage();
      y = MARGIN;
      return true;
    }
    return false;
  };

  const heading = (text, sub) => {
    room(40);
    doc.rect(MARGIN, y, CONTENT_W, 24).fill(NAVY);
    doc.font('bold').fontSize(11);
    doc.fillColor('#ffffff').text(text, MARGIN + 8, y + 7, { width: CONTENT_W - 120, lineBreak: false });
    if (sub) {
      doc.font('reg').fontSize(8);
      doc.fillColor('#c9d4e4').text(sub, MARGIN + 8, y + 8,
        { width: CONTENT_W - 16, align: 'right', lineBreak: false });
    }
    y += 32;
  };

  const para = (text, size = 8.6, colour = INK) => {
    doc.font('reg').fontSize(size);
    const h = doc.heightOfString(text, { width: CONTENT_W });
    room(h + 6);
    doc.fillColor(colour).text(text, MARGIN, y, { width: CONTENT_W });
    y += h + 6;
  };

  const kv = (k, v) => {
    doc.font('reg').fontSize(8.6);
    const h = Math.max(12, doc.heightOfString(s(v) || '—', { width: CONTENT_W - 150 }));
    room(h + 4);
    doc.font('bold').fontSize(8.2);
    doc.fillColor(MUTED).text(k, MARGIN, y, { width: 142, lineBreak: false });
    doc.font('reg').fontSize(8.6);
    doc.fillColor(INK).text(s(v) || '—', MARGIN + 148, y, { width: CONTENT_W - 148 });
    y += h + 4;
  };

  // ── Cover ──
  doc.font('bold').fontSize(20);
  doc.fillColor(NAVY).text('Rewards & Recognition', MARGIN, y, { width: CONTENT_W });
  y += 26;
  doc.font('reg').fontSize(11);
  doc.fillColor(MUTED).text(orgName || '', MARGIN, y, { width: CONTENT_W });
  y += 18;
  doc.font('bold').fontSize(12);
  doc.fillColor(INK).text(`${data.range.label}: ${data.range.display}`, MARGIN, y, { width: CONTENT_W });
  y += 22;
  doc.moveTo(MARGIN, y).lineTo(RIGHT, y).lineWidth(1).strokeColor(NAVY).stroke();
  y += 14;

  kv('Generated', fmtDateTime(new Date().toISOString()));
  kv('People listed', String(data.totals.people));
  kv('Ideas submitted in period', String(data.totals.ideas));
  kv('Approved / Implemented', `${data.totals.approved} / ${data.totals.implemented}`);
  kv('Rejected / Still in review', `${data.totals.rejected} / ${data.totals.pending}`);
  kv('Total points awarded', String(data.totals.points));
  kv('Points scheme', `Submit ${data.points_scheme.submit} · Approved ${data.points_scheme.approved}`
    + ` · Implemented ${data.points_scheme.implemented}`);
  kv('Approval path', (data.chain || []).map((c) => `${c.position}. ${c.label}`).join('  →  '));
  y += 6;
  para('An idea counts in the period it was SUBMITTED in, even where its approval came later — '
    + 'crediting the effort to when the work was done. Each idea below carries its own dates. '
    + 'Anonymous submissions are listed without their author. Attachments are named but not '
    + 'embedded.', 8, MUTED);

  // ── Leaderboard, everybody ──
  y += 8;
  heading('LEADERBOARD', `${data.people.length} people — complete, not a top ten`);

  const cols = [
    { k: 'rank', label: '#', w: 24 },
    { k: 'employee_id', label: 'EMP ID', w: 58 },
    { k: 'name', label: 'NAME', w: 118 },
    { k: 'department', label: 'DEPARTMENT', w: 88 },
    { k: 'ideas_submitted', label: 'IDEAS', w: 34 },
    { k: 'ideas_approved', label: 'APPR', w: 34 },
    { k: 'ideas_implemented', label: 'IMPL', w: 34 },
    { k: 'points_period', label: 'POINTS', w: 43 },
  ];
  const tableHead = () => {
    doc.rect(MARGIN, y, CONTENT_W, 15).fill('#eef2f7');
    let x = MARGIN + 4;
    doc.font('bold').fontSize(7);
    doc.fillColor(MUTED);
    for (const c of cols) {
      doc.text(c.label, x, y + 5, { width: c.w - 4, lineBreak: false });
      x += c.w;
    }
    y += 15;
  };
  tableHead();

  data.people.forEach((p, n) => {
    if (room(16)) tableHead();
    if (n % 2 === 0) doc.rect(MARGIN, y, CONTENT_W, 15).fill(ROW_ALT);
    let x = MARGIN + 4;
    for (const c of cols) {
      const bold = c.k === 'points_period' || c.k === 'rank';
      doc.font(bold ? 'bold' : 'reg').fontSize(7.8);
      doc.fillColor(bold ? NAVY : INK)
        .text(s(p[c.k]), x, y + 4, { width: c.w - 4, lineBreak: false });
      x += c.w;
    }
    y += 15;
  });

  // ── One dossier per idea ──
  y += 10;
  heading('THE IDEAS BEHIND THESE SCORES', `${data.ideas.length} in this period`);

  if (!data.ideas.length) {
    para('No ideas were submitted in this period.', 9, MUTED);
  }

  for (const i of data.ideas) {
    room(120);
    y += 4;
    doc.rect(MARGIN, y, CONTENT_W, 18).fill('#eef2f7');
    doc.font('bold').fontSize(9);
    doc.fillColor(NAVY).text(`${s(i.idea_code)} — ${s(i.title)}`, MARGIN + 6, y + 5,
      { width: CONTENT_W - 12, lineBreak: false });
    y += 24;

    kv('Submitted by', `${s(i.submitter_name)}`
      + (i.submitter_employee_id ? ` (${s(i.submitter_employee_id)})` : '')
      + (i.submitter_department ? ` — ${s(i.submitter_department)}` : ''));
    if ((i.co_suggesters || []).length) {
      kv('Co-suggesters', i.co_suggesters.map((c) => `${c.name} (${c.employee_id})`).join(', '));
    }
    kv('Status', s(i.status));
    kv('Submitted on', fmtDateTime(i.submitted_at));
    kv('Present situation', i.present_situation);
    kv('Proposed solution', i.proposed_solution);
    if (i.tangible_benefit) kv('Tangible benefit', i.tangible_benefit);
    if (i.intangible_benefit) kv('Intangible benefit', i.intangible_benefit);
    if (i.benefits_expected) kv('Benefits expected', i.benefits_expected);
    if (i.investment_required) kv('Investment required', i.investment_required);
    if (i.feasibility) kv('Feasibility', i.feasibility);
    if (i.implementation_duration) kv('Implementation duration', i.implementation_duration);
    if (i.expected_implementation_date) {
      kv('Expected implementation', fmtDate(i.expected_implementation_date));
    }
    if (i.support_required) kv('Support required', i.support_required);
    if (i.impact_level || i.impact_areas) {
      kv('Impact', `${s(i.impact_level)}${i.impact_areas ? ` — ${s(i.impact_areas)}` : ''}`);
    }
    if (i.challenge_title) kv('Challenge', i.challenge_title);
    kv('Points awarded', s(i.points_awarded ?? 0));

    // The trail, in order, with the position each person held at the time.
    doc.font('bold').fontSize(8.2);
    room(20);
    doc.fillColor(MUTED).text('APPROVAL TIMELINE', MARGIN, y, { width: CONTENT_W });
    y += 12;
    if (!(i.workflow || []).length) {
      para('No workflow recorded.', 8, MUTED);
    } else {
      for (const w of i.workflow) {
        const line = trailLine(w);
        doc.font('reg').fontSize(8);
        const h = doc.heightOfString(line, { width: CONTENT_W - 12 });
        room(h + 3);
        doc.fillColor(/reject/i.test(s(w.action)) ? '#b3261e' : INK)
          .text(line, MARGIN + 8, y, { width: CONTENT_W - 12 });
        y += h + 3;
      }
    }

    if ((i.attachments || []).length) {
      doc.font('bold').fontSize(8.2);
      room(18);
      doc.fillColor(MUTED).text('ATTACHMENTS', MARGIN, y, { width: CONTENT_W });
      y += 12;
      for (const a of i.attachments) {
        const line = `${s(a.filename)} — ${s(a.section)} section, uploaded ${fmtDateTime(a.uploaded_at)}`;
        doc.font('reg').fontSize(8);
        const h = doc.heightOfString(line, { width: CONTENT_W - 12 });
        room(h + 3);
        doc.fillColor(INK).text(line, MARGIN + 8, y, { width: CONTENT_W - 12 });
        y += h + 3;
      }
    }

    y += 6;
    doc.moveTo(MARGIN, y).lineTo(RIGHT, y).lineWidth(0.5).strokeColor(LINE).stroke();
    y += 8;
  }

  /*
   * Footer on every page.
   *
   * The bottom margin is zeroed while it is written: PDFKit starts a new page
   * whenever text would cross the bottom margin, and the footer sits below it by
   * design — so writing there ADDS a page and draws the footer on the new one.
   * Every export used to gain a trailing blank page that way.
   */
  const range = doc.bufferedPageRange();
  for (let p = 0; p < range.count; p++) {
    doc.switchToPage(range.start + p);
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('reg').fontSize(7);
    doc.fillColor(MUTED).text(
      `${orgName || ''} — Rewards & Recognition, ${data.range.display}`,
      MARGIN, PAGE_H - MARGIN + 4, { width: CONTENT_W - 80, lineBreak: false });
    doc.text(`Page ${p + 1} of ${range.count}`,
      RIGHT - 80, PAGE_H - MARGIN + 4, { width: 80, align: 'right', lineBreak: false });
    doc.page.margins.bottom = saved;
  }

  doc.end();
}

export default { buildRewardsWorkbook, buildRewardsPdf };

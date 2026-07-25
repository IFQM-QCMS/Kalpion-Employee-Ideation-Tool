/**
 * Single-idea "Closure Summary" PDF.
 *
 * Higher authorities in the review hierarchy export an individual employee's
 * idea as a printable, pre-formatted closure summary (the structured two-page
 * layout the business uses at project closure), filled with that idea's data.
 * Generated fresh on every request and streamed straight to the client — no
 * file is ever written to disk.
 *
 * The layout is a faithful reproduction of the closure-summary template
 * (sections A–G across two pages). Fields that an idea does not carry are left
 * as blank ruled lines, exactly as a printed form would be. No external
 * branding appears on the page. Colours follow the product's indigo/blue theme.
 *
 * Font: Noto Sans (SIL OFL, bundled under backend/assets/fonts) rather than
 * PDFKit's built-in Helvetica, because Helvetica's WinAnsi encoding has no
 * glyph for the Indian Rupee sign (₹) and every monetary figure here is INR.
 * Note: Noto Sans has no U+2192 arrow glyph, so labels use "»" instead of "→".
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
const FONT_REG = path.join(FONT_DIR, 'NotoSans-Regular.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'NotoSans-Bold.ttf');

// Product palette — indigo/blue (matches the app's --primary #4f46e5).
const BLUE = '#4f46e5';
const BLUE_DK = '#3730a3';
const TAG = '#c7d2fe';       // light indigo for the right-aligned section tag
const INK = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#c9ced6';
const LABEL_BG = '#eef1f8';  // faint indigo tint for label cells
const BOX_BG = '#f6f7fb';

const MARGIN = 34;
const PAGE_W = 595.28;
const RIGHT = PAGE_W - MARGIN;
const CONTENT_W = RIGHT - MARGIN;

const RUPEE = '₹';
const ARROW = '»'; // Noto Sans has no → glyph; » is a safe forward indicator.

// ── small formatting helpers ─────────────────────────────────────────
const s = (v) => (v === null || v === undefined ? '' : String(v)).trim();

function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return s(v);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Money is INR. Format with Indian digit grouping and a ₹ prefix.
function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (Number.isFinite(n)) return `${RUPEE} ${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const t = s(v);
  return t ? (t.startsWith(RUPEE) ? t : `${RUPEE} ${t}`) : '';
}

const ROI_TYPE_LABEL = {
  cost_saving: 'Cost Saving', time_saving: 'Time Saving',
  quality_improvement: 'Quality Improvement', revenue_increase: 'Revenue Increase', other: 'Other',
};
const IMPL_STATUS_LABEL = {
  not_started: 'Not started', in_progress: 'In progress', completed: 'Completed', on_hold: 'On hold',
};

// ── low-level drawing ────────────────────────────────────────────────
function titleBlock(doc) {
  doc.font('B').fontSize(15).fillColor(BLUE).text('IDEA CLOSURE SUMMARY', MARGIN, MARGIN);
  doc.font('R').fontSize(7.5).fillColor(MUTED)
    .text('Completed at Closure — Structured for Fast Retrieval', MARGIN, MARGIN + 19);
  doc.font('B').fontSize(7.5).fillColor(BLUE)
    .text('CLOSURE SUMMARY TEMPLATE', MARGIN, MARGIN + 2, { width: CONTENT_W, align: 'right' })
    .text('2-PAGE FORMAT', MARGIN, MARGIN + 12, { width: CONTENT_W, align: 'right' });
  doc.rect(MARGIN, MARGIN + 34, CONTENT_W, 3).fill(BLUE);
  return MARGIN + 45;
}

// A 2-column label/value header grid with row heights sized to their content,
// so a long Project Title or a wrapping label is never truncated.
function headerGrid(doc, y, pairs) {
  const colW = CONTENT_W / 2;
  const labelW = 94;
  const padY = 5;
  for (let i = 0; i < pairs.length; i += 2) {
    const row = [pairs[i], pairs[i + 1]].filter(Boolean);
    let rowH = 18;
    for (let c = 0; c < row.length; c++) {
      doc.font('B').fontSize(7);
      const lh = doc.heightOfString(row[c][0], { width: labelW - 9 });
      doc.font('R').fontSize(8.3);
      const vh = doc.heightOfString(s(row[c][1]) || ' ', { width: colW - labelW - 11 });
      rowH = Math.max(rowH, lh + padY * 2, vh + padY * 2);
    }
    for (let c = 0; c < row.length; c++) {
      const cx = MARGIN + c * colW;
      const [label, value] = row[c];
      doc.rect(cx, y, labelW, rowH).fillAndStroke(LABEL_BG, LINE);
      doc.font('B').fontSize(7).fillColor(INK).text(label, cx + 5, y + padY, { width: labelW - 9 });
      doc.rect(cx + labelW, y, colW - labelW, rowH).stroke(LINE);
      doc.font('R').fontSize(8.3).fillColor(INK).text(s(value) || '', cx + labelW + 6, y + padY, { width: colW - labelW - 11 });
    }
    y += rowH;
  }
  return y + 10;
}

function sectionHeader(doc, y, title, tag) {
  const h = 15;
  doc.rect(MARGIN, y, CONTENT_W, h).fill(BLUE);
  doc.font('B').fontSize(8.5).fillColor('#ffffff').text(title, MARGIN + 7, y + 4);
  if (tag) doc.font('B').fontSize(7).fillColor(TAG)
    .text(tag, MARGIN, y + 4.5, { width: CONTENT_W - 8, align: 'right' });
  return y + h + 7;
}

/** A label + ruled value. Returns the y after the row. */
function field(doc, x, y, w, label, value, opts = {}) {
  const labelW = opts.labelW ?? 132;
  const valX = x + labelW;
  const valW = w - labelW;
  doc.font('B').fontSize(7.8).fillColor(INK).text(label, x, y, { width: labelW - 6 });
  const labelH = doc.heightOfString(label, { width: labelW - 6 });
  const val = s(value);
  let valH = 0;
  if (val) {
    doc.font('R').fontSize(8.3).fillColor(opts.color || INK);
    valH = doc.heightOfString(val, { width: valW - 4 });
    doc.text(val, valX, y, { width: valW - 4 });
  }
  const rowH = Math.max(labelH, valH, 11);
  doc.moveTo(valX, y + rowH + 2).lineTo(x + w, y + rowH + 2).lineWidth(0.6).strokeColor(LINE).stroke();
  return y + rowH + 9;
}

function yesNo(doc, x, y, label, value) {
  doc.font('B').fontSize(7.8).fillColor(INK).text(label, x, y, { width: 200 });
  const bx = x + 210;
  const yes = value === true || value === 'yes';
  const no = value === false || value === 'no';
  doc.font('R').fontSize(8).fillColor(INK);
  doc.rect(bx, y - 1, 9, 9).strokeColor(INK).lineWidth(0.7).stroke();
  if (yes) doc.font('B').fillColor(BLUE_DK).text('x', bx + 2.3, y - 0.5);
  doc.font('R').fillColor(INK).text('Yes', bx + 13, y);
  doc.rect(bx + 42, y - 1, 9, 9).strokeColor(INK).lineWidth(0.7).stroke();
  if (no) doc.font('B').fillColor(BLUE_DK).text('x', bx + 44.3, y - 0.5);
  doc.font('R').fillColor(INK).text('No', bx + 55, y);
  return y + 16;
}

function notesBox(doc, y, h, text) {
  doc.rect(MARGIN, y, CONTENT_W, h).fillAndStroke(BOX_BG, LINE);
  if (s(text)) doc.font('R').fontSize(8.3).fillColor(INK)
    .text(s(text), MARGIN + 8, y + 7, { width: CONTENT_W - 16, height: h - 12, ellipsis: true });
  return y + h + 10;
}

// Height a callout box needs for its title + checkbox lines (measured, so the
// content can never spill past the border into the next section).
function calloutHeight(doc, w, lines) {
  let h = 22;
  doc.font('R').fontSize(7.4);
  for (const ln of lines) h += Math.max(doc.heightOfString(ln, { width: w - 26 }), 9) + 4;
  return h + 4;
}

function calloutBox(doc, x, y, w, h, title, lines) {
  doc.rect(x, y, w, h).fillAndStroke('#ffffff', LINE);
  doc.font('B').fontSize(7.5).fillColor(BLUE_DK).text(title, x + 7, y + 6, { width: w - 12 });
  let ly = y + 20;
  doc.font('R').fontSize(7.4).fillColor(INK);
  for (const ln of lines) {
    doc.rect(x + 8, ly + 1, 7, 7).strokeColor(INK).lineWidth(0.6).stroke();
    doc.text(ln, x + 20, ly, { width: w - 26 });
    ly += Math.max(doc.heightOfString(ln, { width: w - 26 }), 9) + 4;
  }
}

// ── main ─────────────────────────────────────────────────────────────
export function buildIdeaPdf(idea, res) {
  const doc = new PDFDocument({
    size: 'A4', bufferPages: true,
    margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: 12 },
  });
  doc.registerFont('R', FONT_REG);
  doc.registerFont('B', FONT_BOLD);
  doc.font('R');
  doc.pipe(res);

  const submitter = s(idea.submitter_name) || '—';
  const dept = s(idea.department);
  const bu = s(idea.business_unit);
  const areas = s(idea.impact_areas);
  const closureDate = fmtDate(idea.submitted_at || idea.updated_at || idea.created_at);

  // ── PAGE 1 ──
  let y = titleBlock(doc);
  y = headerGrid(doc, y, [
    ['Project Title', idea.title],
    ['Case / Report No.', idea.idea_code],
    ['Plant / Line', bu || dept || '—'],
    ['Part / Process', areas || '—'],
    ['Date of Closure', closureDate],
    ['Prepared By (Team Leader)', submitter],
  ]);

  // Section A — Problem Signature (fields left, chart box right)
  y = sectionHeader(doc, y, 'SECTION A — PROBLEM SIGNATURE', 'DEFECT IDENTIFICATION');
  const colW = CONTENT_W * 0.6;
  const chartX = MARGIN + colW + 10;
  const chartW = RIGHT - chartX;
  const aTop = y;
  let ay = y;
  ay = field(doc, MARGIN, ay, colW, 'Theme / Defect Type', areas, { labelW: 120 });
  ay = field(doc, MARGIN, ay, colW, 'Target Area / Line / Part No.', bu || dept, { labelW: 120 });
  ay = field(doc, MARGIN, ay, colW, 'Symptom (What / Where Observed)', idea.present_situation, { labelW: 120 });
  ay = field(doc, MARGIN, ay, colW, 'Scale (Impact Level)', s(idea.impact_level), { labelW: 120 });
  ay = field(doc, MARGIN, ay, colW, 'Keywords / Search Tags', [areas, s(idea.template_type)].filter(Boolean).join(', '), { labelW: 120 });
  // chart box — caption INSIDE the box (never overlapping the section header)
  const boxH = Math.max(ay - aTop - 6, 64);
  doc.rect(chartX, aTop, chartW, boxH).fillAndStroke(BOX_BG, LINE);
  doc.font('B').fontSize(6.6).fillColor(MUTED).text('PARETO / STRATIFICATION CHART', chartX + 6, aTop + 6, { width: chartW - 12 });
  const attN = (idea.attachments || []).length;
  doc.font('R').fontSize(7).fillColor(MUTED).text(
    attN ? `See ${attN} attached document(s).` : '—',
    chartX + 6, aTop + boxH / 2, { width: chartW - 12, align: 'center' });
  y = ay + 4;

  // Section B — Verified Root Cause
  y = sectionHeader(doc, y, 'SECTION B — VERIFIED ROOT CAUSE', 'ROOT CAUSE VALIDATION');
  y = field(doc, MARGIN, y, CONTENT_W, 'Root Cause (5-Why, Level 5)', '', { labelW: 170 });
  y = field(doc, MARGIN, y, CONTENT_W, 'Failure Mode (Man / Machine / Material / Method)', '', { labelW: 220 });
  y = field(doc, MARGIN, y, CONTENT_W, 'Validation Method Used', s(idea.ai_reason), { labelW: 170 });
  y = yesNo(doc, MARGIN, y + 1, 'Statistically Proven?', null) + 2;

  // Section C — Solution Implemented
  y = sectionHeader(doc, y, 'SECTION C — SOLUTION IMPLEMENTED', 'CORRECTIVE ACTION');
  y = field(doc, MARGIN, y, CONTENT_W, 'Interim Containment (Use Today)', '', { labelW: 170 });
  y = field(doc, MARGIN, y, CONTENT_W, 'Permanent Corrective Action', idea.proposed_solution, { labelW: 170 });
  y = field(doc, MARGIN, y, CONTENT_W, 'Redeployment Effort (Ease / Cost / Impact)',
    [s(idea.feasibility) && `Feasibility: ${s(idea.feasibility)}`, fmtMoney(idea.investment_required)].filter(Boolean).join('  ·  '),
    { labelW: 210 });
  y = field(doc, MARGIN, y, CONTENT_W, 'Linked SOP / Standard Doc No.',
    (idea.attachments || []).map((a) => a.filename).join(', '), { labelW: 170 });

  // Section D — Proof of Result
  y = sectionHeader(doc, y, 'SECTION D — PROOF OF RESULT', 'RESULTS VALIDATION');
  y = field(doc, MARGIN, y, CONTENT_W, `Baseline Metric ${ARROW} Post-Action Metric`, s(idea.tangible_benefit), { labelW: 200 });
  y = field(doc, MARGIN, y, CONTENT_W, '% Improvement', '', { labelW: 200 });
  y = field(doc, MARGIN, y, CONTENT_W, `Net Benefit Realized (${RUPEE} / yr)`,
    fmtMoney(idea.roi_value) + (idea.roi_type ? `   (${ROI_TYPE_LABEL[idea.roi_type] || idea.roi_type})` : '') || s(idea.benefits_expected),
    { labelW: 200 });
  y = field(doc, MARGIN, y, CONTENT_W, 'Still Holding? (Status)', IMPL_STATUS_LABEL[idea.implementation_status] || '', { labelW: 200 });

  // ── PAGE 2 ──
  doc.addPage();
  y = MARGIN;

  y = sectionHeader(doc, y, 'ADDITIONAL NOTES', 'OPTIONAL');
  const notes = [
    s(idea.intangible_benefit) && `Intangible benefit: ${s(idea.intangible_benefit)}`,
    s(idea.benefits_expected) && `Benefits expected: ${s(idea.benefits_expected)}`,
    s(idea.support_required) && `Support required: ${s(idea.support_required)}`,
    (s(idea.co_suggesters_display) || [s(idea.co1_name), s(idea.co2_name)].filter(Boolean).join(', ')) &&
      `Co-suggesters: ${s(idea.co_suggesters_display) || [s(idea.co1_name), s(idea.co2_name)].filter(Boolean).join(', ')}`,
  ].filter(Boolean).join('\n');
  y = notesBox(doc, y, 104, notes);

  // Section E — Project Contacts
  y = sectionHeader(doc, y, 'SECTION E — PROJECT CONTACTS', 'WHO TO CONTACT');
  y = field(doc, MARGIN, y, CONTENT_W, 'Facilitator / Leader Name', idea.is_anonymous ? 'Anonymous' : submitter, { labelW: 170 });
  y = field(doc, MARGIN, y, CONTENT_W, 'Department / Plant / Line', [dept, bu].filter(Boolean).join(' / '), { labelW: 170 });
  y = field(doc, MARGIN, y, CONTENT_W, 'Contact (Email / Extension)', idea.is_anonymous ? '' : s(idea.submitter_email), { labelW: 170 });
  y = yesNo(doc, MARGIN, y + 1, 'Sponsor / Champion Sign-Off on File?', s(idea.manager_name) ? 'yes' : null) + 2;

  // Section F — Reuse Potential
  y = sectionHeader(doc, y, 'SECTION F — REUSE POTENTIAL', 'APPLICABILITY');
  y = field(doc, MARGIN, y, CONTENT_W, 'Horizontal Deployment (Applied Elsewhere?)', '', { labelW: 230 });
  y = field(doc, MARGIN, y, CONTENT_W, 'Known Limitations / Side Effects', '', { labelW: 230 });
  const boxY = y + 2;
  const halfW = (CONTENT_W - 14) / 2;
  const leftLines = [
    'High — same part, same defect, proven root cause. Reuse as-is.',
    'Medium — same root cause, different part/line. Adapt before deploying.',
    'Low — symptom only matches. Use as reference; re-verify root cause.',
  ];
  const rightLines = [
    'Reuse fix as-is',
    'Adapt & pilot on affected line',
    'Consult original team before acting',
    'Not applicable — continue search',
  ];
  const boxH2 = Math.max(calloutHeight(doc, halfW, leftLines), calloutHeight(doc, halfW, rightLines));
  calloutBox(doc, MARGIN, boxY, halfW, boxH2, 'MATCH CONFIDENCE', leftLines);
  calloutBox(doc, MARGIN + halfW + 14, boxY, halfW, boxH2, 'RECOMMENDED NEXT ACTION', rightLines);
  y = boxY + boxH2 + 12;

  // Section G — Team & Sign-Off
  y = sectionHeader(doc, y, 'SECTION G — TEAM & SIGN-OFF', 'CLOSURE APPROVAL');
  const approval = (idea.workflow || []).filter((w) => /Approved|Implemented/i.test(s(w.action))).slice(-1)[0];
  const approvedBy = approval ? `${s(approval.actor_name)} — ${fmtDate(approval.created_at)}` : '';
  y = field(doc, MARGIN, y, CONTENT_W, 'Team Leader', idea.is_anonymous ? 'Anonymous' : submitter, { labelW: 150 });
  y = field(doc, MARGIN, y, CONTENT_W, 'Facilitator', s(idea.manager_name), { labelW: 150 });
  y = field(doc, MARGIN, y, CONTENT_W, 'Sponsor / Champion', '', { labelW: 150 });
  y = field(doc, MARGIN, y, CONTENT_W, 'Approved By (Name & Date)', approvedBy, { labelW: 150 });

  // Footer on every page — generation stamp, no external branding.
  const range = doc.bufferedPageRange();
  const footerY = doc.page.height - 26;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('R').fontSize(7).fillColor(MUTED).text(
      `${s(idea.idea_code)}  ·  Generated ${fmtDate(new Date())}  ·  Page ${i + 1} of ${range.count}`,
      MARGIN, footerY, { width: CONTENT_W, align: 'center', lineBreak: false });
  }

  doc.end();
  return doc;
}

export default { buildIdeaPdf };

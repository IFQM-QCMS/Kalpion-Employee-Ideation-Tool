/** Leaderboard as a PDF - MOM 24/08 §8. */
import PDFDocument from 'pdfkit';
import { registerFonts, applyFont } from './pdfFonts.js';

// IFQM's palette, the same navy and gold the app and the site wear.
const NAVY = '#0b2545';
const NAVY_MID = '#1a5299';
const GOLD = '#c9a961';
const INK = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#dfe3ea';
const HEAD_BG = '#0b2545';
const HEAD_TEXT = '#ffffff';
const ROW_ALT = '#f7f9fc';
// Rank tints for the top three.
const MEDAL = ['#fdf6e3', '#f1f4f8', '#faeee4'];

const MARGIN = 40;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const RIGHT = PAGE_W - MARGIN;
const CONTENT_W = RIGHT - MARGIN;

const ROW_H = 20;
const HEAD_H = 22;
const FOOT_RESERVE = 34;

const PERIOD_LABEL = {
  all: 'All time',
  weekly: 'This week',
  monthly: 'This month',
  quarterly: 'This quarter',
  yearly: 'This year',
};

const s = (v) => (v === null || v === undefined ? '' : String(v)).trim();

// Columns. Name takes what is left over rather than a fixed width, because it is the only
// column whose content cannot be predicted - everything else is a number of known
// magnitude.
const COLS = [
  { key: 'rank', label: '#', w: 26, align: 'center' },
  { key: 'name', label: 'Name', w: null, align: 'left' },
  { key: 'department', label: 'Department', w: 108, align: 'left' },
  { key: 'idea_count', label: 'Ideas', w: 44, align: 'right' },
  { key: 'implemented_count', label: 'Impl.', w: 44, align: 'right' },
  { key: 'avg_score', label: 'Avg score', w: 62, align: 'right' },
  { key: 'points', label: 'Points', w: 52, align: 'right' },
];

function resolveWidths() {
  const fixed = COLS.reduce((n, c) => n + (c.w || 0), 0);
  return COLS.map((c) => ({ ...c, w: c.w ?? CONTENT_W - fixed }));
}

/** Cut a string to fit a width, ending in an ellipsis. */
function fit(doc, text, width) {
  const str = s(text);
  if (!str) return '';
  if (doc.widthOfString(str) <= width) return str;

  const ELLIPSIS = '...';
  const room = width - doc.widthOfString(ELLIPSIS);
  if (room <= 0) return '';

  // Binary search rather than shrinking one character at a time: a 200-character pasted
  // string would otherwise cost 200 measurements per cell.
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.widthOfString(str.slice(0, mid)) <= room) lo = mid;
    else hi = mid - 1;
  }
  return str.slice(0, lo).trimEnd() + ELLIPSIS;
}

function drawHeader(doc, { orgName, period, generatedAt, page }) {
  // A navy band across the top - the same device the app's sidebar uses, so the document is
  // recognisably from the same product.
  doc.rect(0, 0, PAGE_W, 74).fill(NAVY);

  doc.font('bold').fontSize(15).fillColor('#ffffff')
    .text('Idea Leaderboard', MARGIN, 22, { width: CONTENT_W * 0.6, lineBreak: false });

  // The organisation's own name may be in any of the seven languages.
  const org = orgName || 'IFQM';
  applyFont(doc, org, { size: 10 });
  doc.fillColor('#c5d3e4')
    .text(fit(doc, org, CONTENT_W * 0.6), MARGIN, 44,
      { width: CONTENT_W * 0.6, lineBreak: false });

  // Period and generation stamp. Both matter months later, when somebody is holding a
  // printout and asking what it covers.
  doc.font('bold').fontSize(10).fillColor(GOLD)
    .text(PERIOD_LABEL[period] || PERIOD_LABEL.all, MARGIN, 24,
      { width: CONTENT_W, align: 'right', lineBreak: false });
  doc.font('reg').fontSize(8.5).fillColor('#9db1cb')
    .text(`Generated ${generatedAt}`, MARGIN, 40,
      { width: CONTENT_W, align: 'right', lineBreak: false });
  if (page > 1) {
    doc.text(`continued - page ${page}`, MARGIN, 52,
      { width: CONTENT_W, align: 'right', lineBreak: false });
  }

  return 92;
}

function drawTableHead(doc, cols, y) {
  doc.rect(MARGIN, y, CONTENT_W, HEAD_H).fill(HEAD_BG);
  doc.font('bold').fontSize(8).fillColor(HEAD_TEXT);

  let x = MARGIN;
  for (const c of cols) {
    doc.text(c.label.toUpperCase(), x + 6, y + 7,
      { width: c.w - 12, align: c.align, lineBreak: false });
    x += c.w;
  }
  return y + HEAD_H;
}

function drawRow(doc, cols, y, row, rank) {
  if (rank <= 3) doc.rect(MARGIN, y, CONTENT_W, ROW_H).fill(MEDAL[rank - 1]);
  else if (rank % 2 === 0) doc.rect(MARGIN, y, CONTENT_W, ROW_H).fill(ROW_ALT);

  let x = MARGIN;
  for (const c of cols) {
    let v;
    if (c.key === 'rank') v = String(rank);
    else if (c.key === 'avg_score') v = row.avg_score == null || row.avg_score === '' ? '-' : String(row.avg_score);
    else if (c.align === 'right') v = String(Number(row[c.key]) || 0);
    else v = s(row[c.key]) || '-';

    // Rank and points carry the emphasis; everything else is supporting detail.
    const bold = rank <= 3 ? (c.key === 'name' || c.key === 'points' || c.key === 'rank')
      : c.key === 'points';
    // Per cell, not per row. One row can hold a Latin department and a Kannada name, so the
    // face has to be decided from the text about to be drawn - and it must be set BEFORE fit()
    // measures, or the measurement is taken with the wrong font and the truncation point is
    // wrong.
    applyFont(doc, v, { bold, size: 9 });
    doc.fillColor(c.key === 'points' ? NAVY_MID : INK);

    // fit() is applied to every cell, not just the name: a long department is just as capable
    // of pushing a row out of shape.
    doc.text(fit(doc, v, c.w - 12), x + 6, y + 6,
      { width: c.w - 12, align: c.align, lineBreak: false });
    x += c.w;
  }

  doc.moveTo(MARGIN, y + ROW_H).lineTo(RIGHT, y + ROW_H)
    .lineWidth(0.5).strokeColor(LINE).stroke();
  return y + ROW_H;
}


export function buildLeaderboardPdf(rows, meta = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
  registerFonts(doc);
  doc.font('reg');

  const cols = resolveWidths();
  const generatedAt = new Date().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const header = { orgName: meta.orgName, period: meta.period, generatedAt };

  let page = 1;
  let y = drawHeader(doc, { ...header, page });
  y = drawTableHead(doc, cols, y);

  if (!rows.length) {
    doc.font('reg').fontSize(10).fillColor(MUTED)
      .text('Nobody has earned points in this period yet.', MARGIN, y + 18,
        { width: CONTENT_W, align: 'center' });
  }

  let rank = 1;
  for (const row of rows) {
    // Break BEFORE drawing, not after.
    if (y + ROW_H > PAGE_H - MARGIN - FOOT_RESERVE) {
      doc.addPage();
      page += 1;
      y = drawHeader(doc, { ...header, page });
      y = drawTableHead(doc, cols, y);
    }
    y = drawRow(doc, cols, y, row, rank++);
  }

  // Page numbers, added once every page exists - bufferPages is what makes "page N of M"
  // possible, because M is not known while the pages are being written.
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = 0; i < total; i++) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('reg').fontSize(8).fillColor(MUTED)
      .text(`Page ${i + 1} of ${total}`, MARGIN, PAGE_H - MARGIN - 10,
        { width: CONTENT_W, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return doc;
}

export default { buildLeaderboardPdf };

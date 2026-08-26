/**
 * Leaderboard as a PDF — MOM 24/08 §8.
 *
 * The leaderboard already exported as CSV and shared as a picture. Neither is
 * what this is actually for. HR run Rewards & Recognition off it, and what they
 * need is a document: something with the organisation's name, the period it
 * covers and the date it was produced printed on it, that can be attached to a
 * mail, tabled in a meeting, and filed afterwards as the record of who was
 * recognised and why.
 *
 * A CSV has none of that — open it next month and it is a grid of numbers with
 * no indication of which quarter it came from. A share card has the branding
 * but only fits five people.
 *
 * Font: Noto Sans, for the same reason as ideaPdfService — PDFKit's built-in
 * Helvetica has no glyph for the Rupee sign, and while this document does not
 * currently print money, it prints names, and the same font handles the Indic
 * scripts an employee list will contain.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
const FONT_REG = path.join(FONT_DIR, 'NotoSans-Regular.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'NotoSans-Bold.ttf');

const INK = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#d5dae2';
const HEAD_BG = '#eef1f8';
const BLUE = '#4f46e5';
/* Medal tints for the top three. Deliberately pale: this gets printed, often on
   a mono laser, and a saturated fill turns into a grey block that swallows the
   name sitting on it. */
const MEDAL = ['#fff5d6', '#eef1f5', '#f9e6d8'];

const MARGIN = 40;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const RIGHT = PAGE_W - MARGIN;
const CONTENT_W = RIGHT - MARGIN;

const PERIOD_LABEL = {
  all: 'All time',
  monthly: 'This month',
  quarterly: 'This quarter',
  yearly: 'This year',
};

const s = (v) => (v === null || v === undefined ? '' : String(v)).trim();

/*
 * Columns, and the widths they get.
 *
 * Name takes what is left over rather than a fixed width, because it is the
 * only column whose content cannot be predicted — everything else is a number
 * of known magnitude. Sizing the numbers and giving the remainder to the name
 * is what stops a long name colliding with the Points column.
 */
const COLS = [
  { key: 'rank', label: '#', w: 30, align: 'center' },
  { key: 'name', label: 'Name', w: null, align: 'left' },
  { key: 'department', label: 'Department', w: 110, align: 'left' },
  { key: 'idea_count', label: 'Ideas', w: 48, align: 'right' },
  { key: 'implemented_count', label: 'Implemented', w: 78, align: 'right' },
  { key: 'avg_score', label: 'Avg score', w: 66, align: 'right' },
  { key: 'points', label: 'Points', w: 56, align: 'right' },
];

function resolveWidths() {
  const fixed = COLS.reduce((n, c) => n + (c.w || 0), 0);
  return COLS.map((c) => ({ ...c, w: c.w ?? CONTENT_W - fixed }));
}

function drawHeader(doc, { orgName, period, generatedAt, page }) {
  doc.font(FONT_BOLD).fontSize(16).fillColor(INK)
    .text('Leaderboard', MARGIN, MARGIN);

  doc.font(FONT_REG).fontSize(10).fillColor(MUTED)
    .text(s(orgName) || 'IFQM', MARGIN, MARGIN + 21);

  // Period and generation stamp, right-aligned. Both matter months later, when
  // somebody is looking at a printout and asking what it covers.
  const right = [
    PERIOD_LABEL[period] || PERIOD_LABEL.all,
    `Generated ${generatedAt}`,
  ];
  doc.fontSize(9);
  right.forEach((line, i) => {
    doc.fillColor(i === 0 ? INK : MUTED)
      .text(line, MARGIN, MARGIN + (i === 0 ? 2 : 15), { width: CONTENT_W, align: 'right' });
  });

  doc.moveTo(MARGIN, MARGIN + 40).lineTo(RIGHT, MARGIN + 40)
    .lineWidth(1).strokeColor(BLUE).stroke();

  if (page > 1) {
    doc.font(FONT_REG).fontSize(8).fillColor(MUTED)
      .text(`continued — page ${page}`, MARGIN, MARGIN + 45, { width: CONTENT_W, align: 'right' });
  }
  return MARGIN + 56;
}

function drawTableHead(doc, cols, y) {
  doc.rect(MARGIN, y, CONTENT_W, 20).fill(HEAD_BG);
  doc.font(FONT_BOLD).fontSize(8.5).fillColor(MUTED);

  let x = MARGIN;
  for (const c of cols) {
    doc.text(c.label.toUpperCase(), x + 5, y + 6, { width: c.w - 10, align: c.align });
    x += c.w;
  }
  return y + 20;
}

function drawRow(doc, cols, y, row, rank) {
  const H = 19;

  if (rank <= 3) {
    doc.rect(MARGIN, y, CONTENT_W, H).fill(MEDAL[rank - 1]);
  }

  doc.font(rank <= 3 ? FONT_BOLD : FONT_REG).fontSize(9).fillColor(INK);

  let x = MARGIN;
  for (const c of cols) {
    let v;
    if (c.key === 'rank') v = String(rank);
    else if (c.key === 'avg_score') v = row.avg_score == null ? '—' : String(row.avg_score);
    else v = s(row[c.key]) || (c.align === 'right' ? '0' : '—');

    doc.text(v, x + 5, y + 5, { width: c.w - 10, align: c.align, ellipsis: true, lineBreak: false });
    x += c.w;
  }

  doc.moveTo(MARGIN, y + H).lineTo(RIGHT, y + H).lineWidth(0.5).strokeColor(LINE).stroke();
  return y + H;
}

/**
 * @param {Array} rows      leaderboard rows, already ordered by points desc
 * @param {object} meta     { orgName, period }
 * @returns {PDFDocument}   a live stream — the caller pipes it to the response
 */
export function buildLeaderboardPdf(rows, meta = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
  doc.registerFont('reg', FONT_REG);
  doc.registerFont('bold', FONT_BOLD);

  const cols = resolveWidths();
  const generatedAt = new Date().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const header = { orgName: meta.orgName, period: meta.period, generatedAt };

  let page = 1;
  let y = drawHeader(doc, { ...header, page });
  y = drawTableHead(doc, cols, y);

  if (!rows.length) {
    doc.font(FONT_REG).fontSize(10).fillColor(MUTED)
      .text('Nobody has earned points in this period yet.', MARGIN, y + 16,
        { width: CONTENT_W, align: 'center' });
  }

  let rank = 1;
  for (const row of rows) {
    /*
     * Break BEFORE drawing, not after. Measuring afterwards is how a row ends
     * up half-drawn across the page boundary — and the header has to be redrawn
     * on the new page or the columns further down have no labels.
     */
    if (y + 19 > PAGE_H - MARGIN - 24) {
      doc.addPage();
      page += 1;
      y = drawHeader(doc, { ...header, page });
      y = drawTableHead(doc, cols, y);
    }
    y = drawRow(doc, cols, y, row, rank++);
  }

  // Page numbers, added once every page exists. bufferPages is what makes
  // "page N of M" possible — M is not known while the pages are being written.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font(FONT_REG).fontSize(8).fillColor(MUTED)
      .text(`Page ${i + 1} of ${range.count}`, MARGIN, PAGE_H - MARGIN - 4,
        { width: CONTENT_W, align: 'center' });
  }

  doc.end();
  return doc;
}

export default { buildLeaderboardPdf };

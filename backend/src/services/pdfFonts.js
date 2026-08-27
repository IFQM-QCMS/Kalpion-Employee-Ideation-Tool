/**
 * Fonts for generated PDFs, chosen by the script the text is written in.
 *
 * ── The bug this exists for ────────────────────────────────────────────────
 *
 * Every PDF the product generates was drawn in Noto Sans, which covers Latin,
 * Devanagari and the Rupee sign — and does NOT cover Kannada, Tamil, Telugu or
 * Malayalam. A glyph the font lacks resolves to .notdef, and .notdef in this
 * font is blank with a normal advance width.
 *
 * So an employee named ರಾಜೇಶ್ ಕುಮಾರ್ did not render as boxes, or as garbage, or
 * as an error. The row was laid out at the correct width with nothing drawn in
 * it. On a leaderboard going to HR for Rewards & Recognition, that is a person
 * silently deleted from the list of people being recognised.
 *
 * It was invisible for two reasons. widthOfString() returns a non-zero width
 * for a missing glyph, because .notdef has an advance — so nothing measures as
 * wrong. And the product ships in exactly the four languages the font does not
 * cover, so the only way to see it is to have data in one of them.
 *
 * ── Bold ──────────────────────────────────────────────────────────────────
 *
 * Only the Latin face has a bold cut here. Asking for bold on an Indic string
 * gets the regular face rather than falling back to Noto Sans, because a
 * missing weight costs emphasis and a missing script costs the whole name. If
 * bold matters for those scripts later, add the -Bold files and extend FACES;
 * nothing else has to change.
 */
import path from 'node:path';
import * as fontkit from 'fontkit';
import { fileURLToPath } from 'node:url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');

/*
 * Unicode blocks, in the order they are tested. Devanagari is deliberately
 * absent: Noto Sans covers it, so it belongs to the default face.
 */
const FACES = [
  { name: 'kn', file: 'NotoSansKannada-Regular.ttf', re: /[ಀ-೿]/ },
  { name: 'ta', file: 'NotoSansTamil-Regular.ttf', re: /[஀-௿]/ },
  { name: 'te', file: 'NotoSansTelugu-Regular.ttf', re: /[ఀ-౿]/ },
  { name: 'ml', file: 'NotoSansMalayalam-Regular.ttf', re: /[ഀ-ൿ]/ },
];

export const BASE_REG = path.join(DIR, 'NotoSans-Regular.ttf');
export const BASE_BOLD = path.join(DIR, 'NotoSans-Bold.ttf');

/** The Indic face a string needs, or null when the base face will do. */
export function scriptFaceFor(text) {
  const str = String(text ?? '');
  for (const f of FACES) if (f.re.test(str)) return f.name;
  return null;
}

/**
 * Register every face on a document. Call once, immediately after creating it.
 *
 * `regular` and `bold` name the Latin faces, because ideaPdfService already
 * calls its faces 'R' and 'B' throughout a 500-line layout and renaming those
 * would be a large diff with nothing to show for it.
 */
export function registerFonts(doc, { regular = 'reg', bold = 'bold' } = {}) {
  doc.registerFont(regular, BASE_REG);
  doc.registerFont(bold, BASE_BOLD);
  for (const f of FACES) {
    try {
      doc.registerFont(f.name, path.join(DIR, f.file));
    } catch {
      /*
       * A missing font file must not take the document down. That script then
       * renders blank — the very thing this module exists to prevent — but a
       * document that is mostly right beats a 500, and the selection below
       * degrades to the base face on its own.
       */
    }
  }
}

/*
 * ── Shaping can throw, and a PDF export must not ──────────────────────────
 *
 * fontkit (which PDFKit shapes with) crashes on some Telugu conjuncts in Noto
 * Sans Telugu: it reads a null anchor out of the GPOS mark-attachment table and
 * dies with "Cannot read properties of null (reading 'xCoordinate')". Both the
 * hinted and unhinted builds of the font do it, so it is fontkit's bug rather
 * than the font's, and we cannot fix it from here.
 *
 * What we can do is not let it take the request with it. An idea written in
 * Telugu would otherwise 500 the export — a worse failure than the blank text
 * this module was written to fix, because the reader gets nothing at all.
 *
 * So the face is PROVED before it is used: shape the string once inside a
 * try/catch, and fall back to the base face if that throws. The fallback still
 * renders blank for that string, which is bad — but it is one field blank in a
 * document that opens, instead of no document.
 *
 * The probe costs one extra shaping per Indic string. Results are cached per
 * document, because the same name is drawn repeatedly across a table.
 */
const CACHE = new Map();
const OPENED = new Map();

/**
 * Can this face shape this string without throwing?
 *
 * Asked of the FONT, through fontkit directly, rather than of the document.
 *
 * The first version of this probe called doc.widthOfString() — which
 * makeTextScriptAware() below has already replaced with a version that
 * swallows errors and returns 0. So the probe could never see a failure, always
 * reported the face as good, and the crash simply moved to the draw. A guard
 * that consults something it also disabled is not a guard.
 *
 * fontkit is what PDFKit shapes with, so this exercises exactly the code that
 * would run, and it is unaffected by anything done to the document.
 */
function canShape(face, text) {
  const spec = FACES.find((f) => f.name === face);
  if (!spec) return false;

  let font = OPENED.get(face);
  if (font === undefined) {
    try {
      font = fontkit.openSync(path.join(DIR, spec.file));
    } catch {
      font = null;
    }
    OPENED.set(face, font);
  }
  if (!font) return false;

  try {
    font.layout(String(text));
    return true;
  } catch (e) {
    logger.warn(
      `pdf: ${face} cannot shape "${String(text).slice(0, 24)}" — ${e.message}. `
      + 'Falling back to the base font, which will leave this text blank.'
    );
    return false;
  }
}

function faceFor(doc, text, fallback) {
  const face = scriptFaceFor(text);
  if (!face) return fallback;

  // Cached across documents: the answer depends on the font and the string,
  // and both are the same next time. Bounded so a long export cannot grow it
  // without limit.
  const key = `${face}\u0000${text}`;
  let ok = CACHE.get(key);
  if (ok === undefined) {
    ok = canShape(face, text);
    if (CACHE.size > 5000) CACHE.clear();
    CACHE.set(key, ok);
  }
  return ok ? face : fallback;
}

/**
 * Set the right face for a string, and the size. Returns the face chosen.
 *
 * For call sites that know what they are about to draw. Where the call sites
 * are too many to touch, use makeTextScriptAware() instead.
 */
export function applyFont(doc, text, { bold = false, size, names = {} } = {}) {
  const base = bold ? (names.bold || 'bold') : (names.regular || 'reg');
  const name = faceFor(doc, text, base);
  doc.font(name);
  if (size) doc.fontSize(size);
  return name;
}

/**
 * Make every doc.text() on this document pick its own face.
 *
 * ── Why a wrapper rather than editing the call sites ──────────────────────
 *
 * ideaPdfService draws through roughly forty doc.text() calls spread across a
 * two-page form layout, and in most of them the font is selected well before
 * the value is known — the label and the value share a helper. Threading the
 * script choice through all of that would touch every one of them and risk the
 * layout for a change that has nothing to do with layout.
 *
 * This intercepts at the one place every one of them ends up. A string needing
 * an Indic face gets it for that call only, and the caller's own font is put
 * back afterwards, so nothing downstream observes the swap.
 *
 * The previous face is tracked by wrapping font() as well, because PDFKit
 * offers no public read of "what font is currently selected" — and restoring
 * from a private field would break the next time PDFKit renames it.
 */
export function makeTextScriptAware(doc, { regular = 'reg' } = {}) {
  const origFont = doc.font.bind(doc);
  const origText = doc.text.bind(doc);
  const origWidth = doc.widthOfString.bind(doc);
  let current = regular;

  doc.font = (name, ...rest) => {
    if (typeof name === 'string') current = name;
    return origFont(name, ...rest);
  };

  /*
   * Measuring has to survive too. Layout code calls widthOfString to decide
   * where things go, and an unshapeable string thrown from there kills the
   * document just as dead as one thrown from text().
   */
  doc.widthOfString = (text, ...rest) => {
    try {
      return origWidth(text, ...rest);
    } catch {
      return 0;
    }
  };

  doc.text = (text, ...rest) => {
    const face = faceFor(doc, text, current);
    if (face === current) return origText(text, ...rest);
    origFont(face);
    try {
      return origText(text, ...rest);
    } catch (e) {
      // Shaping proved fine a moment ago, so this is something else — but a
      // half-drawn document is still better than none.
      logger.warn(`pdf: text draw failed (${e.message}); skipping this run`);
      return doc;
    } finally {
      origFont(current);
    }
  };

  return doc;
}

export default {
  registerFonts, applyFont, scriptFaceFor, makeTextScriptAware, BASE_REG, BASE_BOLD,
};

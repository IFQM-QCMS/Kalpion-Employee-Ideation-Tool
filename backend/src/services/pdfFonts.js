/** Fonts for generated PDFs, chosen by the script the text is written in. */
import path from 'node:path';
import * as fontkit from 'fontkit';
import { fileURLToPath } from 'node:url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');

// Unicode blocks, in the order they are tested.
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

/** Register every face on a document. */
export function registerFonts(doc, { regular = 'reg', bold = 'bold' } = {}) {
  doc.registerFont(regular, BASE_REG);
  doc.registerFont(bold, BASE_BOLD);
  for (const f of FACES) {
    try {
      doc.registerFont(f.name, path.join(DIR, f.file));
    } catch {
      // A missing font file must not take the document down.
    }
  }
}

// fontkit (which PDFKit shapes with) crashes on some Telugu conjuncts in Noto Sans Telugu:
// it reads a null anchor out of the GPOS mark-attachment table and dies with "Cannot read
// properties of null (reading 'xCoordinate')".
const CACHE = new Map();
const OPENED = new Map();

/** Can this face shape this string without throwing? */
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
      `pdf: ${face} cannot shape "${String(text).slice(0, 24)}" - ${e.message}. `
      + 'Falling back to the base font, which will leave this text blank.'
    );
    return false;
  }
}

function faceFor(doc, text, fallback) {
  const face = scriptFaceFor(text);
  if (!face) return fallback;

  // Cached across documents: the answer depends on the font and the string, and both are the
  // same next time.
  const key = `${face}\u0000${text}`;
  let ok = CACHE.get(key);
  if (ok === undefined) {
    ok = canShape(face, text);
    if (CACHE.size > 5000) CACHE.clear();
    CACHE.set(key, ok);
  }
  return ok ? face : fallback;
}

/** Set the right face for a string, and the size. */
export function applyFont(doc, text, { bold = false, size, names = {} } = {}) {
  const base = bold ? (names.bold || 'bold') : (names.regular || 'reg');
  const name = faceFor(doc, text, base);
  doc.font(name);
  if (size) doc.fontSize(size);
  return name;
}

/** Make every doc.text() on this document pick its own face. */
export function makeTextScriptAware(doc, { regular = 'reg' } = {}) {
  const origFont = doc.font.bind(doc);
  const origText = doc.text.bind(doc);
  const origWidth = doc.widthOfString.bind(doc);
  let current = regular;

  doc.font = (name, ...rest) => {
    if (typeof name === 'string') current = name;
    return origFont(name, ...rest);
  };

  // Measuring has to survive too.
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
      // Shaping proved fine a moment ago, so this is something else - but a half-drawn document
      // is still better than none.
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

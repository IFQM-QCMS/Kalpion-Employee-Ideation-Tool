/*
 * A backtick inside a <style>{`...`}</style> block.
 *
 * ── The bug this exists for ────────────────────────────────────────────────
 *
 * LandingPage renders its CSS through <style>{`...`}</style>. A prose comment
 * inside that CSS referred to a class name as `.ifqm-lp` — in backticks, the
 * way you would write it in Markdown.
 *
 * Those two characters closed the template literal and opened another one, and
 * what was left still parsed as valid JavaScript:
 *
 *     "…css…".ifqm - lp`…more css…`
 *
 * a property access, a subtraction, and a tagged template. So the build passed
 * — nothing about it is syntactically wrong — and the page threw
 * "lp is not defined" at render, which React answers by unmounting the whole
 * tree. A blank page and a green build.
 *
 * That combination is the reason for this file. A bundler cannot flag it, a
 * type checker would not either, and the runtime error names an identifier that
 * appears nowhere in the source, so it tells you nothing about where to look.
 *
 * ── Why it only checks <style> blocks ─────────────────────────────────────
 *
 * The first version of this script tried to tokenise JavaScript so it could
 * check every template literal. It reported five failures, all false: an
 * apostrophe in ordinary JSX text ("doesn't") reads as an opening quote to
 * anything short of a real parser, and everything after it is misclassified.
 *
 * A check that cries wolf is worse than no check, because it gets ignored and
 * then removed. So this looks at one thing, the place where CSS and prose are
 * embedded in JavaScript and the accident is actually possible, and it decides
 * that one thing by a rule with no judgement in it: between <style>{` and `},
 * a backtick is always wrong. No parsing, no heuristics, nothing to tune.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'src');
const OPEN = '<style>{`';
const problems = [];

function scan(file) {
  const src = fs.readFileSync(file, 'utf8');
  let from = 0;

  for (;;) {
    const open = src.indexOf(OPEN, from);
    if (open === -1) break;

    const bodyStart = open + OPEN.length;
    // The literal ends at the first backtick after it, whatever follows.
    const close = src.indexOf('`', bodyStart);
    if (close === -1) {
      const line = src.slice(0, open).split('\n').length;
      problems.push(`${path.relative(process.cwd(), file)}:${line}  <style> template literal is never closed`);
      break;
    }

    // If the literal did not end at `}</style>, something inside cut it short.
    const after = src.slice(close, close + 10);
    if (!after.startsWith('`}</style>')) {
      const line = src.slice(0, close).split('\n').length;
      const lineText = src.split('\n')[line - 1].trim();
      problems.push(
        `${path.relative(process.cwd(), file)}:${line}\n`
        + '    A backtick here ends the <style> literal early. The file will still\n'
        + '    compile, and the page will render blank at runtime.\n'
        + '    Write the class name without backticks.\n'
        + `      ${lineText}`
      );
    }

    from = close + 1;
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(jsx?|mjs)$/.test(entry.name)) scan(p);
  }
}

walk(ROOT);

if (problems.length) {
  console.error(`\n${problems.length} broken <style> literal(s):\n`);
  for (const p of problems) console.error(p + '\n');
  process.exit(1);
}
console.log(`<style> literals OK`);

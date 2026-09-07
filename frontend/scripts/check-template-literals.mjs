// A backtick inside a <style>{`...`}</style> block.
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

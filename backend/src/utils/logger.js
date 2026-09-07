/** Minimal structured logger. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FILE_LOGGING =
  process.env.LOG_TO_FILE === '1' ||
  (process.env.NODE_ENV === 'production' && process.env.LOG_TO_FILE !== '0');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', '..', 'logs');

let dirReady = false;
function ensureDir() {
  if (dirReady) return true;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    dirReady = true;
  } catch {
    // Unwritable log dir must never take the app down - console still works.
  }
  return dirReady;
}

const day = () => new Date().toISOString().slice(0, 10);

function appendLine(line, isError) {
  if (!FILE_LOGGING || !ensureDir()) return;
  const files = [`ifqm-${day()}.log`];
  if (isError) files.push(`error-${day()}.log`);
  for (const f of files) {
    // Fire-and-forget append; O_APPEND keeps single writes whole. Logging must never become
    // the thing the request waits on.
    fs.appendFile(path.join(LOG_DIR, f), line + '\n', () => {});
  }
}

const ts = () => new Date().toISOString();

const logger = {
  info(msg, meta) {
    const line = `[${ts()}] INFO  ${msg}${meta ? ' ' + safe(meta) : ''}`;
    console.log(line);
    appendLine(line, false);
  },
  warn(msg, meta) {
    const line = `[${ts()}] WARN  ${msg}${meta ? ' ' + safe(meta) : ''}`;
    console.warn(line);
    appendLine(line, false);
  },
  error(msg, meta) {
    const line = `[${ts()}] ERROR ${msg}${meta ? ' ' + safe(meta) : ''}`;
    console.error(line);
    appendLine(line, true);
  },
};

function safe(meta) {
  if (meta instanceof Error) return meta.stack || meta.message;
  try {
    return typeof meta === 'string' ? meta : JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

export default logger;

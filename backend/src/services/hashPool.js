/** A small worker-thread pool for bcrypt hashing. */
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, '..', 'workers', 'hashWorker.js');

/*
 * Leave at least one core for the rest of the app - the whole point is that the server
 * stays responsive while an import runs.
 */
function workerCount(jobSize) {
  const cores = Math.max(1, (os.cpus()?.length || 2) - 1);
  const byLoad = Math.ceil(jobSize / 50); // tiny imports don't need a thread each
  return Math.max(1, Math.min(cores, byLoad, 8));
}

/** Hash many passwords in parallel. */
export async function hashMany(items, rounds, onProgress) {
  const result = new Map();
  if (!items.length) return result;

  const n = workerCount(items.length);
  const chunkSize = Math.ceil(items.length / n);
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) chunks.push(items.slice(i, i + chunkSize));

  logger.info(`hashPool: hashing ${items.length} passwords across ${chunks.length} worker(s) at cost ${rounds}`);

  let done = 0;
  const workers = [];

  try {
    await Promise.all(
      chunks.map(
        (chunk) =>
          new Promise((resolve, reject) => {
            const w = new Worker(WORKER_PATH);
            workers.push(w);

            w.once('message', (msg) => {
              if (!msg.ok) return reject(new Error(msg.error));
              for (const { key, hash } of msg.out) result.set(key, hash);
              done += chunk.length;
              onProgress?.(done);
              resolve();
            });
            // A worker that dies (OOM, crash) must reject rather than hang the import forever.
            w.once('error', reject);
            w.once('exit', (code) => {
              if (code !== 0) reject(new Error(`hash worker exited with code ${code}`));
            });

            w.postMessage({ items: chunk, rounds });
          })
      )
    );
  } finally {
    // Always tear the threads down, including on failure.
    await Promise.all(workers.map((w) => w.terminate().catch(() => {})));
  }

  return result;
}

export default { hashMany };

/** bcrypt hashing worker. */
import { parentPort } from 'node:worker_threads';
import bcrypt from 'bcryptjs';

parentPort.on('message', ({ items, rounds }) => {
  try {
    // items: [{ key, password }] -> [{ key, hash }]
    const out = items.map(({ key, password }) => ({
      key,
      hash: bcrypt.hashSync(password, rounds),
    }));
    parentPort.postMessage({ ok: true, out });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err?.message || String(err) });
  }
});

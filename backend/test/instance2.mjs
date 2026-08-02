/**
 * A SECOND, independent application process — the horizontal-scalability probe.
 *
 * tc_runner.mjs spawns this while its own instance is running, pointed at the
 * same scratch databases. Two OS processes behind one database is exactly the
 * shape of a load-balanced deployment, so anything that only works because a
 * request happened to land on the process that served the previous one (an
 * in-memory session, a local cache, a per-process counter) shows up here as a
 * failure instead of surviving to production.
 *
 * It only ever listens; it never provisions or drops a database — the runner
 * owns that lifecycle.
 *
 *   PORT2=<port> node test/instance2.mjs      (env inherited from the runner)
 */
process.env.NODE_ENV = 'test';
process.env.MASTER_DB_NAME = process.env.MASTER_DB_NAME || 'ifqm_test_master';
process.env.FALLBACK_DB_NAME = process.env.FALLBACK_DB_NAME || 'ifqm_test_a';

const { createApp } = await import('../src/app.js');

const app = createApp();
const server = app.listen(Number(process.env.PORT2) || 0, '127.0.0.1', () => {
  // The runner waits for this line before sending traffic.
  process.stdout.write(`READY ${server.address().port}\n`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(() => process.exit(0)); });
}

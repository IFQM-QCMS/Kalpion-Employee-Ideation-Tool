/** A SECOND, independent application process - the horizontal-scalability probe. */
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

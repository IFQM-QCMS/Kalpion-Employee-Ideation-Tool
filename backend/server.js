/**
 * Server entrypoint. Boots the Express app and starts listening.
 */
import { createApp } from './src/app.js';
import config, { assertConfigOrExit } from './src/config/index.js';
import { closeAllPools } from './src/database/tenant.js';
import { startScheduler, stopScheduler } from './src/workers/scheduler.js';
import logger from './src/utils/logger.js';

// Never boot a production server with a forgeable token secret or a
// passwordless database. Exits the process in production.
assertConfigOrExit(logger);

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(`IFQM backend listening on port ${config.port} (${config.env})`);
  // Started here rather than at import time, so a process that fails to bind
  // its port does not spend fifteen seconds sending email on the way out.
  startScheduler();
});

// A port clash is the single most common way starting this goes wrong (a stray
// instance from a previous run is still holding it). Say so plainly instead of
// dumping a net.js stack trace that reads like the app is broken.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(
      `Port ${config.port} is already in use — another IFQM backend is probably still running.\n` +
      `  Find it:  Windows> netstat -ano | findstr :${config.port}    Linux/macOS> lsof -i :${config.port}\n` +
      `  Stop it:  Windows> taskkill /PID <pid> /F                   Linux/macOS> kill <pid>\n` +
      `  Or start this one on a different port:  PORT=4001 node server.js`
    );
    process.exit(1);
  }
  if (err.code === 'EACCES') {
    logger.error(`Not allowed to bind port ${config.port}. Ports below 1024 need elevated privileges.`);
    process.exit(1);
  }
  logger.error('Failed to start server', err);
  process.exit(1);
});

// Graceful shutdown: stop accepting connections, let in-flight requests finish,
// then close the DB pools. Without draining, a deploy can cut a request off
// mid-transaction.
let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${sig} received — draining connections`);
  // Before the pools close, so a job cannot start a query against a pool that
  // is about to be torn down underneath it.
  stopScheduler();

  const force = setTimeout(() => {
    logger.error('Shutdown timed out after 15s — forcing exit');
    process.exit(1);
  }, 15000).unref();

  server.close(async () => {
    try {
      await closeAllPools();
    } catch (e) {
      logger.error('Error closing DB pools', e.message);
    }
    clearTimeout(force);
    logger.info('Shutdown complete');
    process.exit(0);
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { shutdown(sig); });
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err);
  process.exit(1);
});

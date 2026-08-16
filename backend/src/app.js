/**
 * Express application factory.
 * Wires global middleware (security, CORS, body parsing, logging, rate limit),
 * mounts the API router, then the 404 + error handlers.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import config from './config/index.js';
import apiRoutes from './routes/index.js';
import { globalLimiter } from './middleware/rateLimiter.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  /*
   * Configured, not hard-coded. At 1 the hosted deployment logged every sign-in
   * from a 10.x.x.x address — its own load balancer — because more than one
   * proxy sits in front and one hop back never reaches the client. See
   * readTrustProxy in config for why this is a setting and not a constant.
   */
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  // Security headers.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      // The API serves JSON and file downloads, never HTML, so lock the CSP all
      // the way down. (The React app is served separately by the web server and
      // gets its own CSP — see docs/DEPLOYMENT.md.)
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], sandbox: [] },
      },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.forceHttps
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    })
  );

  // Behind a TLS-terminating proxy, redirect any plaintext request rather than
  // letting a bearer token travel in the clear.
  if (config.forceHttps) {
    app.use((req, res, next) => {
      if (req.secure || req.headers['x-forwarded-proto'] === 'https') return next();
      return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
    });
  }

  // CORS allow-list from config. JWT lives in the Authorization header (not a
  // cookie), so credentials are not required.
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || config.corsOrigins.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          return cb(null, true);
        }
        return cb(new Error(`Origin ${origin} not allowed by CORS`));
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      // X-Client-Timezone must be listed or the browser's preflight rejects it
      // and every cross-origin request from the deployed frontend fails - not
      // just the ones that care about the header.
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Timezone'],
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  if (config.env !== 'test') {
    app.use(morgan(config.env === 'development' ? 'dev' : 'combined'));
  }

  app.use(globalLimiter);

  // NOTE: uploads are deliberately NOT served by express.static any more.
  // Mounting the uploads directory publicly meant every idea attachment —
  // employee-authored documents — was downloadable by anyone with the URL, with
  // no login and no tenant check. They now go through
  // GET /api/upload/:id/download, which authenticates the caller, scopes the
  // lookup to their tenant's database, and streams the file as an attachment.

  app.use('/api', apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;

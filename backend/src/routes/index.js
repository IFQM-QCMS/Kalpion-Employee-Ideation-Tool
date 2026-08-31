/**
 * API route aggregator. Mounts each feature module under /api/*.
 * Modules are added here as the migration proceeds (users, ideas, votes, ...).
 */
import { Router } from 'express';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import ideaRoutes from './ideaRoutes.js';
import votingRoutes from './votingRoutes.js';
import commentRoutes from './commentRoutes.js';
import leaderboardRoutes from './leaderboardRoutes.js';
import rewardsRoutes from './rewardsRoutes.js';
import scoreRoutes from './scoreRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import settingsRoutes from './settingsRoutes.js';
import challengeRoutes from './challengeRoutes.js';
import categoryRoutes from './categoryRoutes.js';
import exportRoutes from './exportRoutes.js';
import reportRoutes from './reportRoutes.js';
import uploadRoutes from './uploadRoutes.js';
import brandingRoutes from './brandingRoutes.js';
import supportRoutes from './supportRoutes.js';
import integrationRoutes from './integrationRoutes.js';
import platformRoutes from './platformRoutes.js';
import registrationRoutes from './registrationRoutes.js';
import { masterDb } from '../database/master.js';
import logger from '../utils/logger.js';

const router = Router();

// Liveness: "the process is up". Cheap enough for a load balancer to hit often.
router.get('/health', (_req, res) => res.json({ success: true, status: 'ok' }));

// Readiness: "this instance can actually serve traffic". A process that is
// running but cannot reach its database is worse than one that is down — it
// answers every request with a 500. Point the load balancer / orchestrator at
// this one so a DB-less instance is pulled out of rotation instead.
router.get('/ready', async (_req, res) => {
  try {
    await masterDb().query('SELECT 1');
    return res.json({ success: true, status: 'ready' });
  } catch (err) {
    logger.error('Readiness check failed: master DB unreachable', err.message);
    return res.status(503).json({ success: false, status: 'degraded', error: 'Database unreachable.' });
  }
});

router.use('/auth', authRoutes);
// Public: an MSME applying for its own workspace. Everything it creates is a
// queued application — provisioning only happens on platform-admin approval.
router.use('/registrations', registrationRoutes);
router.use('/users', userRoutes);
router.use('/ideas', ideaRoutes);
router.use('/votes', votingRoutes);
router.use('/comments', commentRoutes);
router.use('/leaderboard', leaderboardRoutes);
// Rewards & Recognition — the leaderboard as a document HR can act on.
router.use('/rewards', rewardsRoutes);
router.use('/score', scoreRoutes);
router.use('/notifications', notificationRoutes);
router.use('/settings', settingsRoutes);
router.use('/challenges', challengeRoutes);
router.use('/categories', categoryRoutes);
router.use('/export', exportRoutes);
router.use('/reports', reportRoutes);
router.use('/upload', uploadRoutes);
router.use('/branding', brandingRoutes);
router.use('/support', supportRoutes);
router.use('/integrations', integrationRoutes);
router.use('/platform', platformRoutes);

export default router;

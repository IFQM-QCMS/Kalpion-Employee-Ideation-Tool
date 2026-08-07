/**
 * Idea routes — /api/ideas/*
 * Ported from PHP api/ideas.php. Role guards mirror the PHP requireRole(...)
 * calls per action.
 */
import { Router } from 'express';
import * as ideas from '../controllers/ideaController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

const REVIEWER_ROLES = ['team_lead', 'project_lead', 'manager', 'department_manager', 'senior_manager', 'plant_head', 'executive', 'admin', 'super_admin'];
const IMPL_ROLES = ['manager', 'department_manager', 'senior_manager', 'plant_head', 'executive', 'admin', 'super_admin'];

// Reads — literal paths before the /:id param route.
router.get('/', requireAuth, ideas.list);                       // action=list
router.get('/my', requireAuth, ideas.my);                       // action=my
router.get('/review', requireRole(...REVIEWER_ROLES), ideas.review); // action=review
router.get('/dashboard', requireAuth, ideas.dashboard);         // action=dashboard
router.get('/check-duplicate', requireAuth, ideas.checkDuplicate); // action=check_duplicate
router.get('/:id', requireAuth, ideas.get);                     // action=get&id=

// Writes
router.post('/submit', requireAuth, ideas.submit);              // action=submit
router.post('/draft', requireAuth, ideas.draft);                // action=draft
router.post('/review-action', requireRole(...REVIEWER_ROLES), ideas.reviewAction);        // action=review_action
router.post('/assign-reviewers', requireRole(...REVIEWER_ROLES), ideas.assignReviewers);  // action=assign_reviewers
router.post('/reviewer-decision', requireRole(...REVIEWER_ROLES), ideas.reviewerDecision); // action=reviewer_decision
router.post('/bulk-review', requireRole(...REVIEWER_ROLES), ideas.bulkReview);            // action=bulk_review
router.post('/roi', requireRole(...IMPL_ROLES), ideas.updateRoi);                        // action=update_roi
router.post('/implementation', requireRole(...IMPL_ROLES), ideas.updateImplementation);  // action=update_implementation

// Archiving and patentability are organisation-admin decisions (MOM §13.2,
// §13.10). requireRole gates the route; ideaService re-checks, because a service
// that trusts its caller's role has no defence if a new route forgets to.
router.post('/archive', requireRole('admin', 'super_admin'), ideas.setArchived);
router.post('/patentability', requireRole('admin', 'super_admin'), ideas.setPatentability);

export default router;

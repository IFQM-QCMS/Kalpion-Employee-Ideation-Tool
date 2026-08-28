/**
 * Idea routes — /api/ideas/*
 * Ported from PHP api/ideas.php. Role guards mirror the PHP requireRole(...)
 * calls per action.
 */
import { Router } from 'express';
import * as ideas from '../controllers/ideaController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

/*
 * Who may SEE the review queue. Org and super admins are here for oversight —
 * they can read what is pending across the organisation and nothing else.
 */
const REVIEW_VIEW_ROLES = ['team_lead', 'project_lead', 'manager', 'department_manager',
  'senior_manager', 'plant_head', 'executive', 'admin', 'super_admin'];

/*
 * Who may DECIDE. Deliberately narrower.
 *
 * `admin` and `super_admin` used to be in the single list this replaced, so an
 * org admin could reach every decision endpoint; the service refused them once
 * they got there, which meant the prohibition existed only as a thrown error at
 * the end of a request that should never have been accepted. The screen showed
 * the buttons, the route allowed the call, and one forgotten check anywhere in
 * that path would have handed approval authority to the wrong person.
 *
 * MOM §13.12: review decisions are kept independent of administration. An
 * administrator who could also approve is both the person who configures the
 * chain and a person the chain answers to.
 *
 * The service keeps its own check as well. A route list is a statement about
 * one URL; the service is what actually holds the rule.
 */
const REVIEW_DECIDE_ROLES = ['team_lead', 'project_lead', 'manager', 'department_manager',
  'senior_manager', 'plant_head', 'executive'];
const IMPL_ROLES = ['manager', 'department_manager', 'senior_manager', 'plant_head', 'executive', 'admin', 'super_admin'];

// Reads — literal paths before the /:id param route.
router.get('/', requireAuth, ideas.list);                       // action=list
router.get('/my', requireAuth, ideas.my);                       // action=my
router.get('/review', requireRole(...REVIEW_VIEW_ROLES), ideas.review); // action=review
router.get('/dashboard', requireAuth, ideas.dashboard);         // action=dashboard
router.get('/check-duplicate', requireAuth, ideas.checkDuplicate); // action=check_duplicate
router.get('/:id', requireAuth, ideas.get);                     // action=get&id=

// Writes
router.post('/submit', requireAuth, ideas.submit);              // action=submit
router.post('/draft', requireAuth, ideas.draft);                // action=draft
router.post('/review-action', requireRole(...REVIEW_DECIDE_ROLES), ideas.reviewAction);        // action=review_action
router.post('/assign-reviewers', requireRole(...REVIEW_DECIDE_ROLES), ideas.assignReviewers);  // action=assign_reviewers
router.post('/reviewer-decision', requireRole(...REVIEW_DECIDE_ROLES), ideas.reviewerDecision); // action=reviewer_decision
router.post('/bulk-review', requireRole(...REVIEW_DECIDE_ROLES), ideas.bulkReview);            // action=bulk_review
router.post('/roi', requireRole(...IMPL_ROLES), ideas.updateRoi);                        // action=update_roi
router.post('/implementation', requireRole(...IMPL_ROLES), ideas.updateImplementation);  // action=update_implementation

// Archiving and patentability are organisation-admin decisions (MOM §13.2,
// §13.10). requireRole gates the route; ideaService re-checks, because a service
// that trusts its caller's role has no defence if a new route forgets to.
router.post('/archive', requireRole('admin', 'super_admin'), ideas.setArchived);
router.post('/patentability', requireRole('admin', 'super_admin'), ideas.setPatentability);
router.post('/bulk-archive', requireRole('admin', 'super_admin'), ideas.bulkArchive);

// The patentable tick is not an admin decision - a submitter may raise it on
// their own idea and a reviewer on any idea. The service does the real check.
router.post('/patentable-flag', requireAuth, ideas.setPatentableFlag);

export default router;

/**
 * Idea controller — HTTP layer over ideaService. Maps to PHP api/ideas.php.
 */
import * as ideaService from '../services/ideaService.js';
import { respond } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

export const list = asyncHandler(async (req, res) =>
  respond(res, await ideaService.list(req.db, req.user, {
    status: req.query.status, search: req.query.search, impact: req.query.impact,
    // These three were missing, which made the service-side filters
    // unreachable: the screen sent ?archived=1 and the server quietly ignored
    // it, so "Archived only" showed the live list instead. A filter that is
    // silently dropped is worse than one that errors, because it looks like it
    // worked.
    archived: req.query.archived, tag: req.query.tag,
    time_required: req.query.time_required,
  }))
);

export const my = asyncHandler(async (req, res) =>
  respond(res, await ideaService.my(req.db, req.user))
);

export const review = asyncHandler(async (req, res) =>
  respond(res, await ideaService.review(req.db, req.user))
);

export const get = asyncHandler(async (req, res) =>
  respond(res, await ideaService.get(req.db, req.user, req.query.id ?? req.params.id))
);

export const submit = asyncHandler(async (req, res) =>
  respond(res, await ideaService.submitOrDraft(req.db, req.user, 'submit', req.body || {}))
);

export const draft = asyncHandler(async (req, res) =>
  respond(res, await ideaService.submitOrDraft(req.db, req.user, 'draft', req.body || {}))
);

export const reviewAction = asyncHandler(async (req, res) =>
  respond(res, await ideaService.reviewAction(req.db, req.user, req.body || {}))
);

export const dashboard = asyncHandler(async (req, res) =>
  respond(res, await ideaService.dashboard(req.db, req.user))
);

export const assignReviewers = asyncHandler(async (req, res) =>
  respond(res, await ideaService.assignReviewers(req.db, req.user, req.body || {}))
);

export const reviewerDecision = asyncHandler(async (req, res) =>
  respond(res, await ideaService.reviewerDecision(req.db, req.user, req.body || {}))
);

export const checkDuplicate = asyncHandler(async (req, res) =>
  respond(res, await ideaService.checkDuplicate(req.db, req.query.title))
);

export const bulkReview = asyncHandler(async (req, res) =>
  respond(res, await ideaService.bulkReview(req.db, req.user, req.body || {}))
);

export const updateRoi = asyncHandler(async (req, res) =>
  respond(res, await ideaService.updateRoi(req.db, req.user, req.body || {}))
);

export const updateImplementation = asyncHandler(async (req, res) =>
  respond(res, await ideaService.updateImplementation(req.db, req.user, req.body || {}))
);

// MOM §13.2 / §13.10 — org-admin only; the service enforces the role itself so
// the rule holds no matter which route reaches it.
export const setArchived = asyncHandler(async (req, res) =>
  respond(res, await ideaService.setArchived(req.db, req.user, req.body || {}))
);

export const setPatentability = asyncHandler(async (req, res) =>
  respond(res, await ideaService.setPatentability(req.db, req.user, req.body || {}))
);

export default {
  list, my, review, get, submit, draft, reviewAction, dashboard,
  assignReviewers, reviewerDecision, checkDuplicate, bulkReview, updateRoi, updateImplementation,
  setArchived, setPatentability,
};

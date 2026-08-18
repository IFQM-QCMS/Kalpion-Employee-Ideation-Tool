/**
 * Bulk employee import — HTTP layer over userImportService.
 *
 * Every route here is mounted behind requireRole('admin','super_admin'), and the
 * service re-checks each row's role against what THIS actor may assign, so an
 * admin cannot escalate anyone (including themselves) through a spreadsheet.
 */
import * as importService from '../services/userImportService.js';
import { respond, badRequest } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

const ACCEPTED = /\.(xlsx|csv)$/i;

function requireFile(req) {
  const file = req.file;
  if (!file) throw badRequest('No file uploaded.');
  if (!ACCEPTED.test(file.originalname || '')) {
    throw badRequest('Upload a .xlsx or .csv file (use the downloadable template).');
  }
  return file;
}

/** GET /api/users/import/template — the pre-filled .xlsx. */
export const template = asyncHandler(async (req, res) => {
  const buffer = await importService.buildTemplate(req.user.role);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="ifqm-employee-import-template.xlsx"');
  res.setHeader('Cache-Control', 'private, no-store');
  return res.send(Buffer.from(buffer));
});

/** POST /api/users/import/preview — validate only. Writes nothing. */
export const preview = asyncHandler(async (req, res) => {
  const file = requireFile(req);
  const result = await importService.preview(req.db, req.user, file.buffer, file.originalname);
  return respond(res, result);
});

/** POST /api/users/import — create the accounts (background job). */
export const start = asyncHandler(async (req, res) => {
  const file = requireFile(req);
  const result = await importService.startImport(
    req.db, req.user, file.buffer, file.originalname, req.tenant
  );
  return respond(res, result, 202); // accepted; poll the job for progress
});

/** GET /api/users/import/:id — progress + errors, for polling. */
export const job = asyncHandler(async (req, res) =>
  respond(res, await importService.getJob(req.db, req.params.id))
);

/** GET /api/users/import/:id/errors.csv — the full rejection list. */
export const errorsCsv = asyncHandler(async (req, res) => {
  const csv = await importService.errorsCsv(req.db, req.params.id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="import-${Number(req.params.id) || 0}-errors.csv"`);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.send('﻿' + csv); // BOM so Excel reads UTF-8 correctly
});

export default { template, preview, start, job, errorsCsv };

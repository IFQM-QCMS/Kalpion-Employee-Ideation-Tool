/**
 * Rewards & Recognition — the org admin's reward pack.
 *
 * Three endpoints over one dataset: read it on screen, take it away as a
 * workbook, take it away as a PDF. The two downloads go through the same
 * service call as the screen, so what HR receives is what the admin saw.
 */
import * as rewards from '../services/rewardsService.js';
import { buildRewardsWorkbook, buildRewardsPdf } from '../services/rewardsExportService.js';
import { respond } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

/** Everything the query string is allowed to say. */
const opts = (req) => ({
  period: req.query.period,
  offset: req.query.offset,
  from: req.query.from,
  to: req.query.to,
  include_all: req.query.include_all,
});

/** A filename somebody can find again in a folder of thirty of them. */
const stem = (range) => `rewards_${range.period}_${range.start}_to_${range.end}`;

/*
 * The screen. Leaderboard only — the per-idea dossiers can run to thousands of
 * rows for a year, and a browser table is not where anybody reads those. The
 * downloads carry them.
 */
export const leaderboard = asyncHandler(async (req, res) =>
  respond(res, await rewards.rewardsLeaderboard(req.db, opts(req))));

/*
 * The full pack as JSON, for a client that wants to render the detail itself.
 * Same shape the exports are built from, so a third format never has to
 * re-derive anything.
 */
export const detail = asyncHandler(async (req, res) =>
  respond(res, await rewards.rewardsDetail(req.db, opts(req))));

export const excel = asyncHandler(async (req, res) => {
  const data = await rewards.rewardsDetail(req.db, opts(req));
  const wb = await buildRewardsWorkbook(data, req.tenant?.name);

  res.setHeader('Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${stem(data.range)}.xlsx"`);
  res.setHeader('Cache-Control', 'no-cache, no-store');
  await wb.xlsx.write(res);
  res.end();
});

export const pdf = asyncHandler(async (req, res) => {
  const data = await rewards.rewardsDetail(req.db, opts(req));

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${stem(data.range)}.pdf"`);
  res.setHeader('Cache-Control', 'no-cache, no-store');
  buildRewardsPdf(data, res, req.tenant?.name);
});

export default { leaderboard, detail, excel, pdf };

/**
 * Export service — Node port of PHP api/export.php.
 *
 *   ideasCsv       → ideas list as CSV (role-scoped, filtered), with UTF-8 BOM.
 *   leaderboardCsv → leaderboard as CSV.
 *   analyticsHtml  → printable analytics report as standalone HTML.
 *
 * CSV formatting matches PHP fputcsv (comma-delimited, fields quoted when they
 * contain a comma/quote/newline, quotes doubled) with a leading UTF-8 BOM so
 * Excel opens it correctly.
 */
const INDIVIDUAL_ROLES = ['trainee', 'employee'];
// Kept in step with ideaService's list of the same name — an export must show
// exactly what the screen it was launched from shows.
const TEAM_ROLES = ['team_lead', 'project_lead', 'manager', 'department_manager', 'senior_manager'];

// Role-based visibility clause (mirrors ideas.php list / export.php).
function buildVisibilityClause(user, params) {
  if (INDIVIDUAL_ROLES.includes(user.role)) {
    params.push(user.id, user.id, user.id);
    return '(i.submitter_id = ? OR i.co_suggester_1_id = ? OR i.co_suggester_2_id = ?)';
  }
  if (TEAM_ROLES.includes(user.role)) {
    params.push(user.id, user.id);
    return '(i.submitter_id IN (SELECT id FROM users WHERE manager_id = ?) OR i.submitter_id = ?)';
  }
  return "i.status != 'Draft'";
}

function csvField(v) {
  if (v === null || v === undefined) v = '';
  v = String(v);
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
const csvRow = (arr) => arr.map(csvField).join(',') + '\n';
const BOM = '﻿';

function stamp() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

// ── EXPORT IDEAS CSV ────────────────────────────────────────────────
export async function ideasCsv(db, user, { status, search, impact } = {}) {
  const params = [];
  const where = [`(${buildVisibilityClause(user, params)})`];
  if (status) { where.push('i.status = ?'); params.push(status); }
  if (search) { where.push('(i.title LIKE ? OR i.idea_code LIKE ?)'); const s = `%${search}%`; params.push(s, s); }
  if (impact) { where.push('i.impact_level = ?'); params.push(impact); }

  const sql =
    `SELECT i.idea_code, i.title, i.status, u.name AS submitter_name, u.department,
            i.impact_level, i.impact_areas, i.ai_score, i.submitted_at,
            i.investment_required, i.feasibility, i.implementation_duration,
            i.expected_implementation_date, i.benefits_expected, i.support_required
     FROM ideas i JOIN users u ON u.id = i.submitter_id` +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY i.submitted_at DESC LIMIT 10000';

  const [ideas] = await db.execute(sql, params);

  let csv = BOM;
  // The business-case columns trail the original nine, so any spreadsheet or
  // script built against the old export keeps finding its columns where it left
  // them.
  csv += csvRow(['Idea Code', 'Title', 'Status', 'Submitter', 'Department', 'Impact Level', 'Categories', 'AI Score', 'Submitted At',
    'Investment Required', 'Feasibility', 'Time to Implement', 'Expected Implementation Date', 'Benefits Expected', 'Support Required']);
  for (const r of ideas) {
    csv += csvRow([r.idea_code, r.title, r.status, r.submitter_name, r.department, r.impact_level, r.impact_areas, r.ai_score, r.submitted_at,
      r.investment_required, r.feasibility, r.implementation_duration, r.expected_implementation_date, r.benefits_expected, r.support_required]);
  }
  return { csv, filename: `ideas_${stamp()}.csv` };
}

// ── EXPORT LEADERBOARD CSV ──────────────────────────────────────────
export async function leaderboardCsv(db) {
  const [rows] = await db.query(
    `SELECT u.name, u.department, u.points,
            COUNT(DISTINCT i.id) AS idea_count,
            SUM(CASE WHEN i.status = 'Implemented' THEN 1 ELSE 0 END) AS implemented_count,
            ROUND(AVG(CASE WHEN i.status != 'Draft' THEN i.ai_score ELSE NULL END), 1) AS avg_score
     FROM users u
     LEFT JOIN ideas i ON i.submitter_id = u.id
     WHERE u.role NOT IN ('admin', 'super_admin')
     GROUP BY u.id
     ORDER BY u.points DESC`
  );

  let csv = BOM;
  csv += csvRow(['Rank', 'Name', 'Department', 'Points', 'Ideas Submitted', 'Ideas Implemented', 'Avg AI Score']);
  let rank = 1;
  for (const r of rows) {
    csv += csvRow([rank++, r.name, r.department, r.points, r.idea_count, r.implemented_count, r.avg_score ?? 'N/A']);
  }
  return { csv, filename: `leaderboard_${stamp()}.csv` };
}

// ── EXPORT ANALYTICS HTML (printable report) ────────────────────────
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));

export async function analyticsHtml(db) {
  const [trend] = await db.query(
    `SELECT DATE_FORMAT(submitted_at, '%Y-%m') AS month, COUNT(*) AS total,
            SUM(CASE WHEN status = 'Implemented' THEN 1 ELSE 0 END) AS implemented,
            ROUND(AVG(ai_score), 1) AS avg_score
     FROM ideas WHERE submitted_at IS NOT NULL
     GROUP BY month ORDER BY month ASC LIMIT 12`
  );
  const [statusSummary] = await db.query(
    "SELECT status, COUNT(*) AS cnt FROM ideas GROUP BY status ORDER BY cnt DESC"
  );
  const [scoreRows] = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN ai_score >= 75 THEN 1 ELSE 0 END), 0) AS high_quality,
            COALESCE(SUM(CASE WHEN ai_score >= 50 AND ai_score < 75 THEN 1 ELSE 0 END), 0) AS medium_quality,
            COALESCE(SUM(CASE WHEN ai_score > 0 AND ai_score < 50 THEN 1 ELSE 0 END), 0) AS low_quality,
            ROUND(AVG(CASE WHEN status != 'Draft' THEN ai_score ELSE NULL END), 1) AS overall_avg,
            COUNT(CASE WHEN status != 'Draft' THEN 1 END) AS total_scored
     FROM ideas WHERE status != 'Draft'`
  );
  const [topDepts] = await db.query(
    `SELECT u.department, COUNT(DISTINCT i.id) AS idea_count,
            SUM(CASE WHEN i.status = 'Implemented' THEN 1 ELSE 0 END) AS implemented,
            ROUND(AVG(CASE WHEN i.status != 'Draft' THEN i.ai_score ELSE NULL END), 1) AS avg_score
     FROM users u JOIN ideas i ON i.submitter_id = u.id
     WHERE i.status != 'Draft' AND u.department IS NOT NULL AND u.department != ''
     GROUP BY u.department ORDER BY idea_count DESC LIMIT 10`
  );

  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const generatedAt = `${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()} at ${p2(now.getHours())}:${p2(now.getMinutes())}`;
  const year = now.getFullYear();
  const orgName = 'Kalpion';

  const sq = scoreRows[0] || {};
  const total = Number(sq.total_scored ?? 0);
  const high = Number(sq.high_quality ?? 0);
  const med = Number(sq.medium_quality ?? 0);
  const low = Number(sq.low_quality ?? 0);
  const avg = sq.overall_avg ?? 'N/A';

  const grandTotal = statusSummary.reduce((a, s) => a + Number(s.cnt), 0) || 1;
  const statusRows = statusSummary.map((s) => {
    const pct = Math.round((Number(s.cnt) / grandTotal) * 100 * 10) / 10;
    return `    <tr>\n      <td>${esc(s.status)}</td>\n      <td>${Number(s.cnt)}</td>\n      <td>${pct}%</td>\n    </tr>`;
  }).join('\n');

  let trendSection = '';
  if (trend.length) {
    const maxTotal = Math.max(...trend.map((t) => Number(t.total))) || 1;
    const bars = trend.map((t) => {
      const wSub = Math.round((Number(t.total) / maxTotal) * 100);
      const wImpl = Number(t.total) > 0 ? Math.round((Number(t.implemented) / Number(t.total)) * wSub) : 0;
      return `  <div class="bar-row">\n    <div class="bar-label">${esc(t.month)}</div>\n    <div class="bar-track">\n      <div class="bar-fill" style="width:${wSub}%"></div>\n    </div>\n    <div class="bar-count">${Number(t.total)}</div>\n    <div class="bar-track">\n      <div class="bar-fill impl" style="width:${wImpl}%"></div>\n    </div>\n    <div class="bar-count">${Number(t.implemented)}</div>\n  </div>`;
    }).join('\n');
    const trows = trend.map((t) =>
      `    <tr>\n      <td>${esc(t.month)}</td>\n      <td>${Number(t.total)}</td>\n      <td>${Number(t.implemented)}</td>\n      <td>${t.avg_score ?? 'N/A'}</td>\n    </tr>`).join('\n');
    trendSection = `
<h2>Monthly Submission Trend</h2>
<div class="legend">
  <div class="legend-item"><div class="legend-dot dot-blue"></div> Submitted</div>
  <div class="legend-item"><div class="legend-dot dot-green"></div> Implemented</div>
</div>
<div class="bar-chart">
${bars}
</div>

<table style="margin-top:12px">
  <thead><tr><th>Month</th><th>Submitted</th><th>Implemented</th><th>Avg AI Score</th></tr></thead>
  <tbody>
${trows}
  </tbody>
</table>`;
  }

  let deptSection = '';
  if (topDepts.length) {
    const drows = topDepts.map((d) =>
      `    <tr>\n      <td>${esc(d.department)}</td>\n      <td>${Number(d.idea_count)}</td>\n      <td>${Number(d.implemented)}</td>\n      <td>${d.avg_score ?? 'N/A'}</td>\n    </tr>`).join('\n');
    deptSection = `
<h2>Top Departments by Ideas</h2>
<table>
  <thead><tr><th>Department</th><th>Ideas</th><th>Implemented</th><th>Avg AI Score</th></tr></thead>
  <tbody>
${drows}
  </tbody>
</table>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Analytics Report – ${esc(orgName)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #1e293b; background: #fff; padding: 32px 40px; line-height: 1.5; }
  h1 { font-size: 22px; font-weight: 700; color: #4f46e5; margin-bottom: 4px; }
  h2 { font-size: 15px; font-weight: 600; color: #1e293b; margin: 24px 0 10px; padding-bottom: 4px; border-bottom: 2px solid #e2e8f0; }
  .meta { font-size: 11px; color: #64748b; margin-bottom: 32px; }
  .cards { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 8px; }
  .card { flex: 1 1 140px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; background: #f8fafc; }
  .card .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .5px; }
  .card .value { font-size: 28px; font-weight: 700; color: #4f46e5; margin-top: 2px; }
  .card .sub   { font-size: 11px; color: #94a3b8; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  th { background: #4f46e5; color: #fff; padding: 7px 10px; text-align: left; font-size: 12px; }
  td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
  tr:nth-child(even) td { background: #f8fafc; }
  tr:last-child td { border-bottom: none; }
  .bar-chart { width: 100%; }
  .bar-row { display: flex; align-items: center; margin-bottom: 5px; gap: 8px; }
  .bar-label { width: 80px; font-size: 11px; color: #64748b; flex-shrink: 0; }
  .bar-track { flex: 1; background: #e2e8f0; border-radius: 4px; height: 14px; overflow: hidden; }
  .bar-fill  { height: 100%; background: #4f46e5; border-radius: 4px; }
  .bar-fill.impl { background: #10b981; }
  .bar-count { font-size: 11px; color: #64748b; width: 28px; text-align: right; flex-shrink: 0; }
  .legend { display: flex; gap: 16px; margin-bottom: 10px; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #64748b; }
  .legend-dot { width: 12px; height: 12px; border-radius: 2px; }
  .dot-blue  { background: #4f46e5; }
  .dot-green { background: #10b981; }
  footer { margin-top: 40px; font-size: 10px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 12px; }
  @media print { body { padding: 16px 20px; } h2 { page-break-before: auto; } .cards { page-break-inside: avoid; } table { page-break-inside: avoid; } .no-print { display: none !important; } @page { margin: 1.5cm; } }
</style>
</head>
<body>

<h1>${esc(orgName)} – Analytics Report</h1>
<p class="meta">Generated on ${esc(generatedAt)}</p>

<h2>Idea Quality Overview</h2>
<div class="cards">
  <div class="card">
    <div class="label">Total Ideas Scored</div>
    <div class="value">${total}</div>
    <div class="sub">non-draft ideas</div>
  </div>
  <div class="card">
    <div class="label">Average AI Score</div>
    <div class="value">${avg}</div>
    <div class="sub">out of 100</div>
  </div>
  <div class="card">
    <div class="label">High Quality</div>
    <div class="value" style="color:#10b981">${high}</div>
    <div class="sub">score &ge; 75</div>
  </div>
  <div class="card">
    <div class="label">Medium Quality</div>
    <div class="value" style="color:#f59e0b">${med}</div>
    <div class="sub">50 – 74</div>
  </div>
  <div class="card">
    <div class="label">Low Quality</div>
    <div class="value" style="color:#ef4444">${low}</div>
    <div class="sub">score &lt; 50</div>
  </div>
</div>

<h2>Ideas by Status</h2>
<table>
  <thead><tr><th>Status</th><th>Count</th><th>% of Total</th></tr></thead>
  <tbody>
${statusRows}
  </tbody>
</table>
${trendSection}
${deptSection}

<footer>
  This report was automatically generated by Kalpion.
  &copy; ${year} IFQM. All rights reserved.
</footer>

</body>
</html>`;
}

export default { ideasCsv, leaderboardCsv, analyticsHtml };

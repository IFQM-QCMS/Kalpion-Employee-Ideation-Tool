/**
 * Report service — Node port of the `analytics` and `audit` actions in PHP
 * api/users.php (the JSON data feeding the in-app analytics dashboard and the
 * audit log). The printable HTML analytics report lives in exportService.
 */

// ── analytics (JSON) ────────────────────────────────────────────────
export async function analytics(db) {
  const [trend] = await db.query(
    `SELECT DATE_FORMAT(submitted_at,'%Y-%m') AS month,
            COUNT(*) AS total,
            SUM(CASE WHEN status='Implemented' THEN 1 ELSE 0 END) AS implemented,
            ROUND(AVG(ai_score), 1) AS avg_score
     FROM ideas WHERE submitted_at IS NOT NULL AND status != 'Draft'
     GROUP BY month ORDER BY month DESC LIMIT 12`
  );

  const [impactRaw] = await db.query("SELECT impact_areas FROM ideas WHERE impact_areas IS NOT NULL AND status != 'Draft'");
  const counts = {};
  for (const row of impactRaw) {
    for (const area of String(row.impact_areas).split(',')) {
      const a = area.trim();
      if (a) counts[a] = (counts[a] || 0) + 1;
    }
  }
  // arsort — order by count descending.
  const impactDistribution = Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1])
  );

  const [statusSummary] = await db.query("SELECT status, COUNT(*) AS cnt FROM ideas WHERE status != 'Draft' GROUP BY status");

  const [scoreRows] = await db.query(
    `SELECT
        SUM(CASE WHEN ai_score >= 75 THEN 1 ELSE 0 END) AS high_quality,
        SUM(CASE WHEN ai_score >= 50 AND ai_score < 75 THEN 1 ELSE 0 END) AS medium_quality,
        SUM(CASE WHEN ai_score > 0 AND ai_score < 50 THEN 1 ELSE 0 END) AS low_quality,
        ROUND(AVG(CASE WHEN status != 'Draft' THEN ai_score ELSE NULL END), 1) AS overall_avg
     FROM ideas WHERE status != 'Draft'`
  );

  return {
    success: true,
    trend,
    impact_distribution: impactDistribution,
    status_summary: statusSummary,
    score_stats: scoreRows[0] || {},
  };
}

// ── audit (JSON) ────────────────────────────────────────────────────
export async function audit(db) {
  const [rows] = await db.query(
    `SELECT w.*, u.name AS actor_name, u.role AS actor_role,
            i.idea_code, i.title AS idea_title,
            s.name AS submitter_name, s.department
     FROM idea_workflow w
     JOIN users u ON u.id = w.actor_id
     JOIN ideas i ON i.id = w.idea_id
     JOIN users s ON s.id = i.submitter_id
     ORDER BY w.created_at DESC LIMIT 200`
  );
  return { success: true, audit: rows };
}

export default { analytics, audit };

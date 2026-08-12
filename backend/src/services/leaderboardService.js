/**
 * Leaderboard service — Node port of the `leaderboard` action in PHP
 * api/users.php. Returns individual rankings, department rankings, and the top
 * ideas, with an optional period filter (monthly | quarterly | yearly | all).
 *
 * The period filter is applied inside the `LEFT JOIN ideas i ON ... <filter>`
 * clause (exactly as PHP), so it constrains which ideas join rather than which
 * users appear — users with no ideas in the period still rank by points.
 *
 * `period` is whitelisted to a fixed SQL fragment (never interpolated from raw
 * input), preserving the PHP behaviour without any injection surface.
 */

const PERIOD_FILTERS = {
  weekly: 'AND YEARWEEK(i.submitted_at, 1) = YEARWEEK(NOW(), 1)',
  monthly: 'AND MONTH(i.submitted_at)=MONTH(NOW()) AND YEAR(i.submitted_at)=YEAR(NOW())',
  quarterly: 'AND QUARTER(i.submitted_at)=QUARTER(NOW()) AND YEAR(i.submitted_at)=YEAR(NOW())',
  yearly: 'AND YEAR(i.submitted_at)=YEAR(NOW())',
};

export async function leaderboard(db, period = 'all') {
  const dateFilter = PERIOD_FILTERS[period] || '';

  const [individuals] = await db.query(
    `SELECT u.id, u.name, u.department, u.business_unit, u.points, u.avatar_initials,
            COUNT(DISTINCT i.id) AS idea_count,
            SUM(CASE WHEN i.status='Implemented' THEN 1 ELSE 0 END) AS implemented_count,
            ROUND(AVG(CASE WHEN i.status != 'Draft' THEN i.ai_score ELSE NULL END), 1) AS avg_score,
            (SELECT COUNT(*) FROM idea_votes iv
             JOIN ideas i2 ON i2.id = iv.idea_id WHERE i2.submitter_id = u.id) AS total_votes_received,
            (SELECT ROUND(AVG(iv.rating),1) FROM idea_votes iv
             JOIN ideas i2 ON i2.id = iv.idea_id WHERE i2.submitter_id = u.id) AS avg_community_rating
     FROM users u
     LEFT JOIN ideas i ON i.submitter_id = u.id AND i.status != 'Draft' ${dateFilter}
     WHERE u.role NOT IN ('admin','super_admin')
     GROUP BY u.id
     ORDER BY u.points DESC
     LIMIT 20`
  );

  const [departments] = await db.query(
    `SELECT u.department,
            SUM(u.points)          AS dept_points,
            COUNT(DISTINCT u.id)   AS member_count,
            COUNT(DISTINCT i.id)   AS idea_count,
            ROUND(AVG(CASE WHEN i.status != 'Draft' THEN i.ai_score ELSE NULL END), 1) AS avg_score
     FROM users u
     LEFT JOIN ideas i ON i.submitter_id = u.id AND i.status != 'Draft' ${dateFilter}
     WHERE u.role NOT IN ('admin','super_admin')
     GROUP BY u.department
     ORDER BY dept_points DESC`
  );

  const [topIdeas] = await db.query(
    `SELECT i.id, i.idea_code, i.title, i.ai_score, i.status,
            i.impact_level, i.impact_areas,
            u.name AS submitter_name, u.department
     FROM ideas i
     JOIN users u ON u.id = i.submitter_id
     WHERE i.status != 'Draft' AND i.ai_score > 0 ${dateFilter}
     ORDER BY i.ai_score DESC
     LIMIT 5`
  );

  return { success: true, individuals, departments, top_ideas: topIdeas };
}

export default { leaderboard };

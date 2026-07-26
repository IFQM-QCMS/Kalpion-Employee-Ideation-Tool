-- ─────────────────────────────────────────────────────────────────────────────
--  Migration 008 — Index ideas.updated_at (per-TENANT database)
--
--    mysql -u root -p ifqm_<slug> < db/migrations/008_ideas_updated_at_index.sql
--
--  Idempotent: safe to re-run.
--
--  The ideas list (GET /api/ideas) orders by updated_at DESC and returns the top
--  100. Without an index on updated_at the optimiser full-scans the ideas table
--  and filesorts every request — cheap at a few thousand rows, but at hundreds of
--  thousands it dominates latency and, under concurrency, exhausts the connection
--  pool and returns 500s (observed in load testing: hundreds of failed requests
--  at 400+ concurrent connections, dropping to ZERO once this index exists).
--
--  With the index the plan becomes an ordered index read that stops at LIMIT 100
--  (EXPLAIN: type=index, no filesort).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ideas_updated_at ON ideas(updated_at);

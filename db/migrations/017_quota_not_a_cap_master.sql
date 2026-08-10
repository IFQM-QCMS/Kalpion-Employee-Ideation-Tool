-- ─────────────────────────────────────────────────────────────────────────────
--  Migration 017 — the request counter stops being a cap  (MASTER schema)
--
--    mysql -u root -p ifqm_master < db/migrations/017_quota_not_a_cap_master.sql
--
--  Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────
--
--  Migration 010 seeded a platform-wide ceiling of 10,000 requests in total and
--  2,000 per month, taken from the MOM. Those figures describe an allowance for
--  a machine-to-machine integration. They were applied instead to every
--  authenticated request, including ordinary page loads.
--
--  The arithmetic was never going to work. One employee with the All Ideas
--  screen open generated 360 requests an hour on its own, and four people
--  merely signed in generated roughly 170,000 a month from the notification
--  poll alone — against a cap of 2,000. The first organisation to use the
--  product in earnest reached 2,062 and every screen began answering 429. From
--  the customer's side that is indistinguishable from the software being
--  broken, which is exactly how it was reported.
--
--  A cap that stops a paying customer opening a page is not a commercial limit.
--  So the ceiling becomes opt-in:
--
--    * requests are still counted, per organisation, and still reported in the
--      platform console — that figure is genuinely useful;
--    * nothing is refused unless somebody has deliberately set a number on a
--      particular organisation (tenants.api_quota_total / api_quota_monthly),
--      which is the case the limit was really for: one customer behaving badly,
--      not every customer working.
--
--  The counters accumulated so far are also cleared. They were run up by normal
--  use against a limit that should never have applied to it, and leaving them
--  would keep an organisation at its ceiling for the rest of the month.

-- Remove the platform-wide ceiling. Per-organisation limits are untouched: if
-- an operator has deliberately capped somebody, that decision stands.
DELETE FROM platform_settings
 WHERE key_name IN ('api_quota_total', 'api_quota_monthly');

-- Clear the counters run up under the old rule. They are a usage record, not a
-- debt, and they restart from zero on the next request.
DELETE FROM tenant_api_usage;

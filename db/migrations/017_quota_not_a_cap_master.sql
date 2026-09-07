-- Migration 017 - the request counter stops being a cap (MASTER schema)

-- Remove the platform-wide ceiling.
DELETE FROM platform_settings
 WHERE key_name IN ('api_quota_total', 'api_quota_monthly');

-- Clear the counters run up under the old rule.
DELETE FROM tenant_api_usage;

-- A tenant whose db_host is 'localhost' only works when the database shares the API's
-- machine. Inside a container that is the API's own loopback, so every query on the
-- tenant fails with "Database connection failed" - which is what happened on the first
-- containerised deployment, from the one row master.sql seeds.
--
-- Empty is the fallback value: database/tenant.js then uses MASTER_DB_HOST, wherever the
-- registry is. On a machine where the database really is local, MASTER_DB_HOST is
-- 'localhost' too, so this changes nothing there.
ALTER TABLE tenants ALTER COLUMN db_host SET DEFAULT '';
UPDATE tenants SET db_host = '' WHERE db_host = 'localhost';

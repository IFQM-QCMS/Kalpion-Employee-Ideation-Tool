-- Let the application account create and own a database per organisation.
--
-- Run once by the MariaDB image, on an empty data volume only. An existing
-- deployment has to run the GRANT by hand - see the note at the bottom.
--
-- Why it is needed: MARIADB_USER in docker-compose.yml grants rights on
-- MARIADB_DATABASE (ifqm_master) and nothing else. Kalpion is multi-tenant and
-- creates a schema per organisation at runtime, so approving the first new
-- organisation would fail with "access denied" on CREATE DATABASE.
--
-- The escaped underscore matters. `_` is a single-character wildcard in a MySQL
-- or MariaDB grant, so `ifqm\_%` matches ifqm_master and ifqm_vp but not an
-- unrelated ifqmXYZ. Granting on the pattern is also what allows creating a new
-- database whose name matches it, without any server-wide CREATE privilege.

GRANT ALL PRIVILEGES ON `ifqm\_%`.* TO 'ifqm_app'@'%';
FLUSH PRIVILEGES;

-- On a database that already has data, the volume is not empty and this file is
-- never executed. Apply it by hand, once:
--
--   docker exec -i kalpion-db mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" \
--     -e "GRANT ALL PRIVILEGES ON \`ifqm\\_%\`.* TO 'ifqm_app'@'%'; FLUSH PRIVILEGES;"

# Deprecated schema files — do not provision from anything in here

These four files predate the current provisioning path and are **inert**: no
script, service or migration reads them. They are kept because git history is
easier to search when a file still has a name, and because deleting them
outright removes the only signpost telling a future operator why they should
not be used.

## What replaced them

| Superseded | Live source of truth |
|---|---|
| `schema.sql`, `database.sql` | `backend/schema/tenant_schema.sql` — the consolidated tenant schema, used by `provision-tenant.js` and `platformService.createTenant()` |
| `schema_updates.sql` | `db/migrations/*.sql`, applied in order by `backend/scripts/migrate.js` |
| `cleanup.sql` | nothing — it was a one-off |

`db/master.sql` (still in `db/`) is live: it builds the registry.

## Why they are dangerous rather than merely old

`docs/DEPLOYMENT.md` has warned against them for some time: both predate later
migrations, and `schema.sql` is missing three tables outright. A tenant
provisioned from one of these would come up looking healthy and fail later, on
whichever feature happened to need a column that was never created — which is a
much worse failure than refusing to provision at all.

If you need one for archaeology, read it here or pull it from git history.
Do not point a script at it.

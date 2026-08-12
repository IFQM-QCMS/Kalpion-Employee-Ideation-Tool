# Will this hold 500 organisations and 1,000,000 users?

**Short answer: not as it stands — and the reason is not the one you would
expect.** The data model is fine. The connection topology is not, and there are
three loops that touch every organisation on a single request.

None of this is a rewrite. It is roughly a week of focused work, all of it in
four files. But it has to happen *before* the numbers get large, not after,
because the failure mode is a hard refusal rather than a slowdown.

| | |
|---|---|
| **Target** | 500 organisations · 1,000,000 users · Azure |
| **Per-organisation data** | ✅ Comfortable. 2,000 users and ~50k ideas per org is small for MySQL, and the indexes are already there. |
| **Connection topology** | ❌ **Hard wall.** Breaks well before 500 orgs. |
| **All-tenant loops** | ❌ Three of them. One is on the unauthenticated login path. |
| **Horizontal scaling** | ⚠️ Blocked by in-process state in three places. |

---

## 1. The hard wall: one connection pool per organisation, never evicted

`backend/src/database/tenant.js` keeps a `Map` of connection pools keyed by
database, and **nothing ever removes an entry**. Each pool is sized
`connectionLimit: 10`.

That is correct and cheap at 5 organisations. At 500 it is the thing that breaks.

### Measured, not estimated

I ran this against the local MySQL, opening real pools exactly as the app does:

```
  10 tenants touched once  ->   10 connections open
  50 tenants touched once  ->   50 connections open
 100 tenants touched once  ->  100 connections open
 100 tenants x5 concurrent ->  ER_CON_COUNT_ERROR: Too many connections
```

One hundred organisations with five simultaneous requests each was enough to
exhaust the server. Not slow it down — **refuse it**.

### What that means on Azure

| Load | Connections held, per app instance |
|---|---|
| 500 orgs idle but touched | ~500 |
| 500 orgs, light concurrency | 1,000–2,000 |
| 500 orgs, 10 concurrent each | **5,000** |

Azure Database for MySQL Flexible Server allows roughly:

| Tier | max_connections |
|---|---|
| Burstable B2s | ~340 |
| General Purpose 4 vCore | ~1,365 |
| General Purpose 16 vCore | ~5,460 |
| Memory Optimised 64 vCore | ~20,000 |

So 500 organisations at real concurrency needs a **16-vCore database for a
single application instance** — and a second instance would double it. You would
be buying a very large database to hold idle sockets, not to do work.

> [!IMPORTANT]
> **This gets worse because of the background job I added yesterday.** The email
> queue drain iterates every active tenant every 60 seconds. Since the pool idle
> timeout is also 60 seconds, every one of the 500 pools is refreshed just before
> it would have closed — pinning all 500 connections open permanently, even on a
> platform with no users signed in. That has to be fixed alongside this.

### The fix

Cap the number of live pools and close the least recently used. Most
organisations are idle at any moment; 500 pools exist to serve perhaps 30 active
ones.

```
LRU cap of ~50 pools × 4 connections = ~200 connections per instance
```

That runs comfortably on a 4-vCore database with room for several app instances.
Reopening a pool costs a few milliseconds and happens only for an organisation
nobody has touched recently.

Also drop `DB_POOL_SIZE` from 10 to 3–4. Ten concurrent queries *for a single
organisation of 2,000 people* is not a real load pattern.

---

## 2. Three loops that touch every organisation

### 2.1 The serious one — on the unauthenticated login path

`directoryService.resolveTenantByLogin` looks a person up in `login_directory`
first, which is indexed and fast. When that misses, it **falls back to scanning
every active tenant**: open a pool, run a query, move on.

For a registered user this never fires. For an **unknown email address** it
always fires — and an unknown email address is precisely what a password-spray
or account-enumeration attempt produces.

At 500 organisations, one login attempt with a bogus address becomes **500 pool
opens and 500 queries**. The auth rate limit of 30 per 15 minutes per IP still
permits 15,000 queries per IP, and an attacker has more than one IP.

This is both the scalability wall and an amplification vector: one
unauthenticated request costing 500 database round trips.

**Fix:** the directory is already self-healing for users who sign in. Backfill it
for everyone at provisioning and import time, then delete the scan and answer
"no such account" directly. The generic-response behaviour is unaffected.

### 2.2 The email queue drain

`workers/scheduler.js` iterates every active tenant every 60 seconds. At 500
orgs that is 500 queries a minute — 720,000 a day — almost all against empty
queues, and as noted above it pins every pool open.

**Fix:** keep a pointer in the registry — a small table, or a column on
`tenants`, set when mail is queued and cleared when the queue empties — and
drain only the organisations that actually have something waiting.

### 2.3 The messaging dashboard's email health panel

`messagingService.emailHealth` runs two queries per tenant on every page load.
At 500 orgs that is 1,000 queries to render one panel. **My code, added
yesterday** — at 5 organisations it is instant and I did not think past that.

**Fix:** cache it for a minute, or roll the counts into the same registry
pointer as 2.2.

---

## 3. What blocks running more than one instance

The design is stateless in the way that matters — sessions are JWTs, so any
instance can serve any request. Three pieces of in-process state stop you
actually running two:

| What | Where | Consequence of two instances |
|---|---|---|
| Rate limiter | `middleware/rateLimiter.js` | Counters are per-process, so the effective limit is N× what you configured. |
| Quota metering | `middleware/tenantQuota.js` | Each instance buffers its own counts. They flush to one table, so totals stay correct, but the in-memory cache can be up to 30s stale per instance. Tolerable. |
| Background jobs | `workers/scheduler.js` | **Two instances would both drain the email queue.** The claim-then-send is not atomic enough to make that safe — duplicate emails. I gated it behind `RUN_BACKGROUND_JOBS` for exactly this reason, but that is a stopgap, not a design. |

**Fix:** point the rate limiter at Redis (Azure Cache for Redis; `express-rate-limit`
has a store for it), and either move the scheduler into its own single-replica
container or give it a database advisory lock — the same `GET_LOCK` mechanism
already used for idea decisions.

---

## 4. What is genuinely fine

Worth stating plainly, because it is most of the system:

- **Per-organisation data volume.** 1,000,000 users across 500 organisations is
  2,000 per organisation. With ~50,000 ideas each, every table stays in the low
  hundreds of thousands of rows. MySQL does not notice this.
- **The indexes.** `ideas` is indexed on status, submitter, reviewer,
  `submitted_at`, `updated_at` and `archived_at`; `users` on email+status,
  name and manager. The queries that matter are covered.
- **Paging.** Every list is capped at 100 rows server-side and searched and
  filtered in the database. No screen pulls a whole table.
- **Tenant isolation under load.** A separate database per organisation means
  one customer's heavy month cannot slow another's queries — genuinely better
  than a shared-table design at this scale.
- **Password hashing.** Already off the event loop via a worker pool, which is
  the usual thing that turns a sign-in rush into a site-wide outage.
- **The billing and messaging queries added this week.** `billingOverview` is a
  single joined query over `tenants`, not a loop. It stays one query at 500 orgs.

---

## 5. Two things to decide, not just fix

**Is one database per organisation still right at 500?** It is a real strength —
separation you can point at in a sales conversation, and a restore that affects
one customer. It is also the direct cause of §1. At 500 the answer is still yes,
with the LRU cap. At 5,000 it would not be, and the alternative (shared tables
with a tenant column) is a far larger change than anything in this document.
Worth deciding deliberately rather than discovering.

**500 databases is an operational load, not just a technical one.** Every
migration runs 500 times. The ledger already handles that correctly and
forward-only, but a migration that takes 2 seconds per database is 17 minutes of
deployment, and one that fails on database 300 leaves you half-migrated. That
needs a batched runner with resumption before the count gets large.

---

## 6. The honest verdict

**Will it work perfectly without crashing at 500 organisations and 1,000,000
users, as the code stands today?** No. It will refuse connections somewhere
between 100 and 200 active organisations, and a single unauthenticated login
attempt with an unknown address will cost 500 database queries.

**Is the architecture capable of it?** Yes, and without redesign. The layering,
the isolation, the indexing and the paging are all right. Every problem above is
a bounded fix in one of four files:

| # | Fix | Effort | Without it |
|---|---|---|---|
| 1 | LRU cap on the pool cache; pool size 10 → 4 | ~1 day | Hard failure above ~150 active orgs |
| 2 | Backfill `login_directory`, delete the tenant scan | ~1 day | 500 queries per unknown-email login |
| 3 | Drain only tenants with queued mail | ~half day | 720k needless queries/day, pools pinned open |
| 4 | Cache the email-health panel | ~2 hours | 1,000 queries per dashboard load |
| 5 | Redis rate-limit store; scheduler lock or own container | ~2 days | Cannot run a second instance safely |
| 6 | Batched, resumable migration runner | ~1 day | Deployments get long and fragile |

Call it **a week**, and it should be done before the customer count passes about
fifty — not because fifty is a limit, but because every one of these is far
cheaper to fix on a quiet platform than on a busy one.

> [!NOTE]
> **How to prove it rather than trust this document.** None of the above has been
> load tested — the numbers for connections are measured, the rest is read from
> the code. Before launch, provision 500 empty tenant databases on a staging
> Azure instance and run a scripted load against them. That is a day of work and
> it converts every estimate here into a measurement. Section 26.1 of the
> architecture document already lists load testing as outstanding; this is the
> shape it should take.

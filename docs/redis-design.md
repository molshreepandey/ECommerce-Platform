# Redis design

Status: **approved by the project owner on 2026-11-07, with the conditions below. Not implemented yet** (implementation starts in Wave 2). Redis is an additional project requirement from the owner; it is not in the original plan (`ECOMMERCE_PLATFORM_PLAN.md`), which stays unchanged. This document decides where Redis is used, where it is deliberately not used, and in which wave each piece lands.

### Owner's approval conditions (2026-11-07)

1. PostgreSQL remains the single source of truth.
2. Redis is used for caching, TTL, rate limiting and appropriate non-critical coordination.
3. Cache invalidation goes through a reliable database-backed mechanism (the Postgres outbox, §5.2).
4. No dependence on Redis locks for inventory, orders, payments or idempotency correctness.
5. Critical business operations use PostgreSQL transactions, row locks, constraints and guarded updates.
6. Redis failure and recovery scenarios are documented (§7).

Every section below follows these conditions; a change that would break one needs the owner's approval first.

## 1. Ground rules

1. **PostgreSQL is the only source of truth.** Every fact the business depends on (stock, reservations, orders, payments, coupons, sessions, idempotency keys, webhook receipts, audit) is written to and read from Postgres. Redis holds copies and counters that can be thrown away at any moment.
2. **Losing all of Redis must never lose or corrupt data.** A `FLUSHALL`, a restart without persistence, or a failover that drops recent writes may make the app slower or briefly staler. It must not cause oversell, a duplicate order, a wrong payment state or a lost invalidation that never heals.
3. **Redis is never on the correctness path for inventory, orders, payments or coupons.** Those paths use Postgres guarded `UPDATE … WHERE` with row counts, unique constraints, CHECK constraints and transactions (plan §6, §10 rule 5, §10A). Redis locks are not used there at all, not even as an extra layer, so there is no temptation to rely on them later.
4. **The app runs when Redis is down.** Cache reads become misses, cache writes are skipped, rate limiting falls back to Postgres. The store keeps selling. Health reporting follows the approved rule in §1.1.
5. **No secrets or personal data in Redis.** No session tokens, OTP codes, passwords, addresses or phone numbers in keys or values. Cached values are public catalogue data or aggregate numbers.
6. **No network calls inside a DB transaction** (plan §10 rule 8) applies to Redis too: cache invalidation runs after commit.

### 1.1 Health status rule (approved 2026-11-07)

| Dependency    | Down means                                      | `/api/health`                                                      |
| ------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| PostgreSQL    | No critical operation can run                   | **503**, `status: "unavailable"`                                   |
| Elasticsearch | Search must use the PostgreSQL fallback         | **200**, `status: "degraded"`, **only while the fallback is safe** |
| Redis         | Caches are bypassed, rate limits use PostgreSQL | **200**, `status: "degraded"`, **only while the bypass is safe**   |
| All up        |                                                 | 200, `status: "ok"`                                                |

- The response lists every dependency separately: `{"status": …, "checks": {"postgres": {"status": "up", "critical": true}, …}}`.
- Each probe has a 2 s timeout, so a hung dependency reports `down` instead of hanging the endpoint.
- "Never report healthy when a critical operation cannot safely function": a dependency is only non-critical while its fallback exists and is tested. Elasticsearch is non-critical in Wave 1 because nothing uses it yet; **Wave 6 must ship and test the PostgreSQL search fallback in the same wave, or mark Elasticsearch critical.** Redis is added to the report in Wave 2, as non-critical only once the cache bypass and the PostgreSQL rate-limit fallback are tested.
- Implemented for PostgreSQL and Elasticsearch in Wave 1 (`src/lib/health.ts`, `src/app/api/health/route.ts`).

## 2. Versions and clients

| Item                | Choice                                                                                                      | Notes                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server (local, CI)  | `redis:8.x` Docker image, pinned to an exact tag when implemented (newest tag seen on 2026-11-07: `8.10.3`) | Redis 8 is available under AGPLv3 among other licences; fine for a self-hosted dev/CI container. Valkey 9 (BSD) is a drop-in alternative if licensing matters. |
| Node client         | `redis` (node-redis, official), v6.3.1 on 2026-11-07                                                        | Re-check its API at implementation time; v6 is newer than the version this design was reasoned from.                                                           |
| Hosted (Wave 15)    | A free-tier managed Redis (e.g. Upstash or Redis Cloud) over TLS                                            | Free-tier limits and pricing must be verified at Wave 15; they change.                                                                                         |
| Next.js integration | `cacheHandlers` in `next.config.ts` (`remote` handler) + `'use cache: remote'`                              | Documented in `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/cacheHandlers.md` for Next 16.4.5.                              |

## 3. Caching strategies considered

| Strategy                           | What it is                                               | Use here?                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Cache-aside (lazy loading)         | App reads cache, on miss reads Postgres and fills cache  | **Yes**, for report aggregates (§5.3)                                                                                     |
| Read-through                       | A cache layer loads on miss transparently                | **Yes**, this is what `'use cache: remote'` with a Redis handler does for catalogue reads                                 |
| Write-through                      | Every DB write also writes the cache synchronously       | **No**: couples writes to Redis availability and adds a dual-write consistency problem; invalidation is simpler and safer |
| Write-behind                       | Writes go to Redis first, flushed to DB later            | **Never**: makes Redis a source of truth and loses data on Redis failure                                                  |
| Stale-while-revalidate             | Serve a stale value while refreshing in the background   | **Yes**, via Next `cacheLife` (`stale` / `revalidate` / `expire`) for catalogue reads                                     |
| Refresh-ahead                      | Proactively refresh hot keys before expiry               | **No** for now: not needed at this scale                                                                                  |
| Negative caching                   | Cache "not found"                                        | **No** for product slugs: a newly created product would 404 until the TTL ends; the DB index lookup is cheap              |
| Request coalescing (single-flight) | One recomputation while concurrent callers wait or reuse | **Yes**, only for expensive report queries (§6.3)                                                                         |

## 4. What gets cached and what does not

### Cached

| Data                                                                          | Mechanism             | Key / tag                                                | Freshness (revalidate / expire)                         | Invalidated by                                                                                       |
| ----------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Category tree (L1–L4)                                                         | `'use cache: remote'` | tag `categories`                                         | 1 h / 1 day                                             | category create, rename, move, (de)activate (W4 writes; handler lands in W6)                         |
| Product types + attribute definitions                                         | `'use cache: remote'` | tag `product-types`                                      | 1 h / 1 day                                             | product type / attribute changes (W3)                                                                |
| Store settings + branding                                                     | `'use cache: remote'` | tag `settings`                                           | 10 min / 1 day                                          | settings save (W7, W11)                                                                              |
| Product page static data (name, media, attributes, MRP/price, group swatches) | `'use cache: remote'` | tags `product:{id}`, `product-group:{id}`                | 5 min / 1 h                                             | outbox processor after commit (same outbox row that drives the ES sync)                              |
| Home sections, collections, banners                                           | `'use cache: remote'` | tag `merchandising`                                      | 5 min / 1 h                                             | admin save; banner start/end times are handled by the short TTL plus filtering on dates at read time |
| Dashboard report aggregates                                                   | cache-aside           | `report:v1:{reportName}:{fromDate}:{toDate}`             | 60 s if the range includes today, 1 h for closed ranges | TTL only (plus a version bump in the key when the query changes)                                     |
| Rate-limit counters                                                           | atomic counter        | `ratelimit:v1:{action}:{hashedIdentifier}:{windowStart}` | window length                                           | expiry                                                                                               |

All TTLs get ±10% jitter so many keys do not expire in the same second.

### Deliberately not cached

| Data                                    | Why not                                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stock, availability, reservations       | Must be exact at add-to-cart and checkout; Postgres is the authority, and storefront listings already get availability from the Elasticsearch read model. A cached availability number would only add a third place to be wrong.                                                                            |
| Prices at cart/checkout time            | Checkout re-prices from Postgres inside the transaction (plan §10A rule 4); PDP prices may be up to 5 min stale on screen, and the cart shows "price changed" (C26).                                                                                                                                        |
| Carts                                   | Plan keeps carts in Postgres (C22); they are per-customer writes, not hot reads.                                                                                                                                                                                                                            |
| Sessions                                | Lookup is one unique-index read on `sessions(token_hash)`. Caching would delay "logout everywhere" and staff deactivation by the TTL, and would put session material in Redis. Revisit only if profiling shows session lookup is a bottleneck; then cache for ≤ 30 s with explicit delete on logout/revoke. |
| Idempotency keys                        | The unique constraint `orders(customer_id, idempotency_key)` is the guarantee; a Redis marker could expire or be lost and adds nothing.                                                                                                                                                                     |
| Orders, payments, shipments, webhooks   | Correctness-critical, low read volume per row.                                                                                                                                                                                                                                                              |
| OTP challenges and attempt counts       | Attempt limits must survive restarts; codes must never leave Postgres (stored hashed).                                                                                                                                                                                                                      |
| Search results                          | Elasticsearch is fast and the URL space is huge (filters × sort × page); hit rate would be low.                                                                                                                                                                                                             |
| Anything personalised or behind a login | A shared cache must never serve one user's data to another.                                                                                                                                                                                                                                                 |

## 5. Invalidation and TTL

### 5.1 Tag-based invalidation for catalogue reads

The Redis `remote` cache handler implements the Next.js handler contract:

- `set()` stores the serialised entry with `PX = expire` so Redis evicts it on its own.
- `get()` returns `undefined` (a miss) on any Redis error; the page renders from Postgres. The framework does **not** catch errors from `get()`, so this must be handled in the handler.
- `updateTags(tags)` writes `tag:{name} = now` and adds the tag to a set; called by `revalidateTag`.
- `refreshTags()` (once per request) syncs tag timestamps from Redis into the instance.
- `getExpiration(tags)` returns the newest invalidation timestamp; an entry created before it is treated as stale.

Timestamp-based tags avoid the classic cache-aside race (a slow reader loads the old row, the writer commits and deletes the key, then the slow reader writes the old value back). Here the late write still carries an old `timestamp`, which is older than the tag's invalidation time, so it is ignored.

### 5.2 Invalidations are durable because they come from Postgres

`revalidateTag` is a network call, so it cannot run inside the transaction, and it can fail if Redis is down at that moment. To make sure an invalidation is never lost:

1. The admin write commits its business rows **and** a `search_outbox` row in one transaction (this already exists for the ES sync).
2. The outbox processor (`after()` + `npm run search:sync`) syncs Elasticsearch, then calls `revalidateTag` for the affected tags, then marks the row processed.
3. If `revalidateTag` fails, the row stays unprocessed and is retried. Worst case, staleness is bounded by the entry's `expire` TTL.

For rarely changing reference data (categories, product types, settings) the route handler also calls `revalidateTag(tag, 'max')` directly after commit for immediate effect; the outbox path remains the safety net. (`updateTag` only works in Server Actions; route handlers use `revalidateTag` with a profile, per the Next 16 docs.)

### 5.3 Cache-aside for reports

- Key includes a schema version (`report:v1:…`) so a changed query never reads old shapes.
- Short TTL for ranges that include today (numbers keep changing), longer for closed ranges.
- The **reconciliation panel (D7) is never served from cache**: its whole point is comparing live sums.

### 5.4 Eviction and memory

- `maxmemory` set explicitly; `maxmemory-policy volatile-lru` (every key has a TTL, so all keys are candidates).
- No persistence needed for local dev and CI (cache is disposable). In hosted Redis keep the provider default; correctness never depends on it.
- If rate-limit keys are evicted under memory pressure, that window's count resets (fails open for one window). Acceptable for abuse throttling; documented as a known trade-off.

## 6. Distributed coordination: only where genuinely needed

| Need                                                                                                                         | Mechanism                                                            | Why this one                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Cache invalidation across many app instances (Vercel runs many)                                                              | Redis tag timestamps (§5.1)                                          | Genuinely shared state that only needs to be eventually consistent; Postgres outbox guarantees it eventually happens |
| Rate limits shared across instances                                                                                          | Redis atomic counter, Postgres fallback                              | Per-request writes are cheaper in Redis; Postgres table `rate_limit_counters` already exists for fallback            |
| Single recomputation of an expensive report                                                                                  | Redis single-flight lock (§6.3)                                      | **Efficiency only**: if the lock fails, the report is computed twice, which is harmless                              |
| Draining the search outbox from several instances                                                                            | Postgres `SELECT … FOR UPDATE SKIP LOCKED`                           | Rows are claimed transactionally; no Redis needed                                                                    |
| Only one full reindex at a time (D48)                                                                                        | Postgres `pg_try_advisory_lock`                                      | Held by the DB session, released automatically if the process dies                                                   |
| Inventory reservation, coupon redemption, idempotent checkout, order/shipment transitions, COD payment state, webhook dedupe | Postgres guarded updates, unique and CHECK constraints, transactions | **No Redis involvement at all** (rule 3)                                                                             |

### 6.1 Why Redis locks are not trusted for correctness

A Redis lock is a key with a TTL. The holder can lose it without knowing:

- a GC pause, CPU starvation or slow network outlasts the TTL, the key expires, a second process takes the lock, and the first process resumes and writes;
- a primary fails over before replicating the lock key, and the replica grants it again;
- multi-node schemes (Redlock) still depend on timing assumptions and do not provide fencing tokens that the database checks.

The only thing that makes "two writers at once" safe is the database rejecting the stale writer: a conditional `UPDATE … WHERE` on the current state, a unique constraint, or a row lock inside a transaction. Our critical paths already have exactly that, so a Redis lock there adds latency and a new failure mode without adding safety.

### 6.2 Rate limiting

- Fixed window per plan §10B (login, OTP send/verify, register, checkout), keyed by action + SHA-256 of `IP + identifier` (no raw phone/email in keys).
- One atomic Lua script: `INCR` then `PEXPIRE` only when the counter was just created, returning the count; avoids the "INCR succeeded, EXPIRE never ran" immortal-key bug.
- On Redis error: fall back to the Postgres `rate_limit_counters` upsert (`INSERT … ON CONFLICT … DO UPDATE SET count = count + 1 RETURNING count`). Rate limiting must not fail open just because Redis is down, since it protects login and OTP.

### 6.3 Single-flight for reports

```
SET lock:report:{key} {randomToken} NX PX 10000
  acquired → compute from Postgres, SET result with TTL, release with a Lua compare-and-delete on {randomToken}
  not acquired → wait up to ~2 s for the result key; if still missing, compute anyway
```

The compare-and-delete release stops a slow holder from deleting a lock that has since expired and been taken by someone else. The "compute anyway" fallback is what keeps this an efficiency measure, not a correctness one.

## 7. Failure and recovery scenarios

Detection everywhere: every Redis call has a short timeout and is wrapped so an error becomes a cache miss, a skipped write or a Postgres fallback; the error is logged with the request id, and `/api/health` reports `redis: down` (200, degraded) while it lasts.

| #   | Scenario                                              | What users see                                                                   | What protects correctness                                                                                              | Recovery                                                                                                                                                              |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Redis unreachable when the app starts                 | Normal pages, a little slower (catalogue reads go to Postgres)                   | Nothing correctness-related reads Redis                                                                                | Client reconnects with bounded backoff; caches refill on demand; health returns to `ok`                                                                               |
| 2   | Redis drops in the middle of a request                | That request is served from Postgres                                             | Handler `get()` returns a miss on error; `set()` errors are swallowed                                                  | Next request uses Redis again once reachable                                                                                                                          |
| 3   | Redis hangs (accepts connections, never answers)      | Requests wait at most the command timeout, then fall back                        | Timeouts on connect and on every command; no unbounded offline queue                                                   | Same as 2; health shows `down` after its 2 s probe timeout                                                                                                            |
| 4   | Admin edits a product while Redis is down             | Old catalogue data may show until recovery                                       | The edit and its outbox row are committed in Postgres; the outbox row stays unprocessed while `revalidateTag` fails    | Outbox processor retries; once Redis is back the tag is invalidated. Staleness is bounded by the retry interval after recovery and never exceeds the entry's `expire` |
| 5   | Redis restarts empty (no persistence, or flushed)     | Cold cache: slower first requests                                                | Values were copies; tag timestamps are lost along with every entry                                                     | Caches refill from Postgres on demand                                                                                                                                 |
| 6   | Redis fails over and the replica misses recent writes | A few entries may be older than they should be; some rate-limit counts may reset | Checkout, inventory, payments and idempotency never read Redis                                                         | Entries expire by TTL; on a detected reconnect the outbox processor re-issues invalidations for rows processed in the last few minutes                                |
| 7   | Memory full                                           | Some entries evicted early; cache writes may fail                                | Eviction policy `volatile-lru`; write failures ignored                                                                 | Automatic; raise `maxmemory` if the hit rate drops                                                                                                                    |
| 8   | Rate-limit keys lost (flush, eviction, failover)      | A client may get extra attempts for one window                                   | Login and OTP also have Postgres-side protections (OTP attempt count on the challenge row, bcrypt cost)                | Next window starts normally                                                                                                                                           |
| 9   | Redis down **and** Postgres down                      | `/api/health` 503; the store cannot take orders                                  | Nothing is written anywhere                                                                                            | Recover Postgres first; Redis is optional                                                                                                                             |
| 10  | Report single-flight lock holder crashes              | One slower report request                                                        | The lock has a TTL; waiters compute the report themselves after ~2 s                                                   | Lock expires on its own                                                                                                                                               |
| 11  | Cached product page shows an old price                | Price on the product page may be up to its TTL old                               | Cart and checkout re-price from Postgres; checkout returns 409 `PRICE_CHANGED` if the total differs (plan §10A rule 4) | Entry revalidated by tag or TTL                                                                                                                                       |

**Never affected by any Redis failure:** stock levels and reservations, order creation and idempotency, coupon redemption counts, payment states, shipment transitions, webhook dedupe, sessions, audit log. These live only in PostgreSQL and are protected by transactions, row locks (`SELECT … FOR UPDATE` where a row must be held), guarded `UPDATE … WHERE` with affected-row checks, and unique and CHECK constraints.

**Recovery drills (Wave 14):** stop Redis during the full test suite; `docker compose pause redis` (hang) under load; `FLUSHALL` mid-run; restart Redis after an admin edit made while it was down and confirm the outbox retry invalidates the page.

Client settings: short connect and command timeouts (≈200–500 ms), bounded reconnect backoff, no unbounded offline queue (fail fast so requests fall back to Postgres instead of hanging).

## 8. Wave placement

The plan's waves stay as they are; Redis work is added to the wave that first needs it.

| Wave                          | Redis work                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2** Identity, access, audit | Add `redis` service (pinned 8.x) to `docker-compose.yml` and CI; `REDIS_URL` in the env schema and `.env.example`; `lib/redis.ts` client with timeouts; Redis in `/api/health` as non-critical (§1.1); rate limiter (Redis Lua counter + Postgres fallback) used by login/register (OTP and checkout reuse it later) |
| 3–5                           | No Redis. Admin writes already emit outbox rows, which later drive invalidation                                                                                                                                                                                                                                      |
| **6** Search and storefront   | Redis `remote` cache handler (`cacheHandlers`), `'use cache: remote'` on category tree, product types, product page static data; outbox processor calls `revalidateTag` after the ES sync                                                                                                                            |
| **7** Cart, pricing, settings | Settings and branding cached with tag `settings`; cart and prices explicitly not cached                                                                                                                                                                                                                              |
| **8** Checkout                | **No Redis.** Concurrency acceptance tests (10 parallel checkouts, 5× same idempotency key, coupon exhaustion) are also run with the Redis container stopped to prove checkout does not depend on it                                                                                                                 |
| 9                             | No Redis (webhook dedupe stays a Postgres unique key)                                                                                                                                                                                                                                                                |
| **10** Dashboard and reports  | Cache-aside + single-flight for report aggregates; reconciliation panel uncached                                                                                                                                                                                                                                     |
| 11                            | Merchandising (home sections, collections, banners) cached with tag `merchandising`                                                                                                                                                                                                                                  |
| 12                            | OTP rate limits reuse the Wave 2 limiter; OTP state stays in Postgres                                                                                                                                                                                                                                                |
| 13                            | Reindex single-flight uses a Postgres advisory lock, not Redis                                                                                                                                                                                                                                                       |
| **14** Hardening              | Failure drills: stop Redis during the full test suite; flush Redis mid-run; check p95 latency with and without cache                                                                                                                                                                                                 |
| **15** Deploy                 | Managed Redis over TLS with a restricted ACL user; document limits; Redis listed in README and technical report                                                                                                                                                                                                      |

## 9. Tests to add when implementing

- Cache handler: hit, miss, tag invalidation across two handler instances, entry older than tag rejected, `get()` returns miss on Redis error, `set()` swallows errors.
- Invalidation: admin edit → outbox processed → product page shows the new value; Redis down during edit → value fresh after Redis returns and outbox retries.
- Rate limiter: limit reached → 429; window rolls over; Redis down → Postgres fallback still returns 429 at the limit; key never lacks a TTL.
- Single-flight: 20 concurrent report requests → one Postgres aggregate query (count via query log); lock holder crash → others still get a result.
- Independence: checkout, cancellation, RTO and webhook tests pass with Redis stopped; health shows `redis: down` with HTTP 200 and `status: "degraded"` (§1.1).

# Technical decisions

Each record says what was decided, why, what else was considered, and the trade-offs. Newest decisions
are added at the end. The original plan (`ECOMMERCE_PLATFORM_PLAN.md`) is not edited; where a decision
changes it, the record says so.

---

## TD-001 Modular monolith, two sites from one codebase

- **Decision:** one Next.js 16 application serves the customer store and the admin panel, routed by host
  name in `src/proxy.ts`. Business code is split into modules (`src/modules/*`, from Wave 2B) with
  schema, service, repository and error files.
- **Why:** the brief says a modular monolith is sufficient; one deployment, one database transaction
  boundary, shared types.
- **Alternatives:** microservices (rejected: distributed transactions for checkout, more operations work,
  no benefit at this scale); two separate apps (rejected: duplicated components and auth code).
- **Trade-offs:** one deploy unit; module boundaries are enforced by convention and review, not by the
  network.

## TD-002 Runtime configuration: JSON per environment, read at server start

- **Decision:** non-secret settings live in `config/config.<APP_ENV>.json` (development, test, staging,
  production) and are **read from disk when the server starts**, validated with Zod
  (`src/lib/config/`). Secrets and connection strings come only from environment variables
  (`src/lib/env.ts`). `APP_CONFIG_PATH` can point at a different file at runtime.
- **Why runtime, not build-time:** anything imported into code is frozen into the build by Next.js. If
  the JSON were imported, changing a staging timeout or host would need a rebuild, and one artifact
  could not be promoted from staging to production. Reading the file at start-up means the same build
  runs in every environment.
- **How Next.js 16 fits in:**

  | Kind of value                                                               | When it is fixed                                 | Where it lives here                                                                                                 |
  | --------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
  | `NEXT_PUBLIC_*` variables, anything imported into client code               | `next build`                                     | none used                                                                                                           |
  | Prerendered pages (`○` in the build output)                                 | `next build`                                     | static marketing text only; no config values rendered into them                                                     |
  | `next.config.ts` `headers()`                                                | `next build` (compiled into the routes manifest) | only headers identical in every environment (`nosniff`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`) |
  | Server code (route handlers, proxy, server components rendered per request) | each server start                                | hosts, timeouts, TTLs, rate limits, CSP sources, HSTS, log level, pool sizes                                        |
  - `APP_ENV` chooses the file. It is separate from `NODE_ENV` because `next start` always runs with
    `NODE_ENV=production`, including in staging.
  - The proxy runs on Node.js by default in Next 16, so it can read the file. Startup validation runs in
    `src/instrumentation.ts`, which loads Node-only code through `process.env.NEXT_RUNTIME === 'nodejs'`
    (Next compiles instrumentation for both Node and Edge).
  - `outputFileTracingIncludes: { '/*': ['./config/*.json'] }` makes deployments ship the files
    (verified in the build traces).
  - An invalid file stops the process with exit code 1 instead of serving errors.

- **Evidence:** one build, started twice: default config served `store.localhost`; with `APP_CONFIG_PATH`
  pointing at a copy with a different store host, the same build (same `BUILD_ID`) served the new host
  and returned 404 for the old one. An invalid file made `next start` exit with code 1.
- **Alternatives:** environment variables only (rejected: dozens of variables, no types or review in
  Git); JSON imported at build time (rejected: rebuild per environment); a remote config service
  (rejected: extra moving part, cost).
- **Trade-offs:** four files must stay valid (a unit test validates all of them, including HTTPS and HSTS
  rules for staging and production); staging and production hosts are placeholders until Wave 15.

## TD-003 Redis client: pinned server, app-level deadlines, circuit breaker

- **Decision:** Redis `8.10.3` pinned by tag **and** multi-arch digest
  (`sha256:1f88291b…`); Node client `redis` (node-redis) `6.3.1`, exact version. Every command goes
  through `runRedisCommand()` in `src/lib/redis.ts`, which enforces a reply deadline, discards a client
  that stopped replying, and opens a short circuit-breaker cooldown so callers fall back immediately.
- **Why:** measured on this machine with Redis frozen (`docker compose pause`):

  | Mechanism                               | Result                                                                                        |
  | --------------------------------------- | --------------------------------------------------------------------------------------------- |
  | `commandOptions.timeout`                | still pending after 4 s                                                                       |
  | `withCommandOptions({ timeout })`       | still pending after 4 s                                                                       |
  | `abortSignal: AbortSignal.timeout(500)` | still pending after 4 s                                                                       |
  | `socket.socketTimeout: 500`             | rejected after 514 ms, **but** also dropped idle connections (5 reconnects in 3 idle seconds) |
  | `runRedisCommand` deadline (chosen)     | rejected after ~503 ms; idle connections untouched                                            |

  Before the circuit breaker, every request during a Redis outage waited the 500 ms connect timeout
  (2,281 ms for 6 rate-limit calls); with it, only the first does (745 ms for 6).

- **Alternatives:** ioredis (similar behaviour, would also need checking); trusting library timeouts
  (rejected by the measurements above).
- **Trade-offs:** for one cooldown period (5 s, configurable) after a failure, Redis is skipped even if it
  has recovered; health may show `redis: down` for those seconds.

## TD-004 Rate limiting: fixed window, Redis first, Postgres fallback

- **Decision:** `src/lib/rate-limit/`. Key = action + SHA-256 of the identifier + window start. Redis path
  is one atomic Lua script (`INCR`, set expiry on creation, repair a missing expiry). Postgres path is one
  `INSERT … ON CONFLICT DO UPDATE … RETURNING` on `rate_limit_counters`. Any Redis error falls back to
  Postgres; if both fail the request fails (never skips the limit). Fallback warnings are throttled to one
  per 30 s with a count.
- **Why:** plan §10B asks for DB-backed limits; the approved Redis design asks for Redis with a
  fallback. Fixed windows are simple to explain and test exactly.
- **Alternatives:** sliding window log or token bucket (more precise at window edges, more state);
  in-memory limits (wrong with several server instances).
- **Trade-offs:** a client can send up to 2× the limit across a window boundary; Postgres rows for old
  windows need periodic clean-up (not built yet).

## TD-005 Integration tests run against real services with a strict target guard

- **Decision:** `npm run test:integration` uses the real Postgres and Redis. Every migration, truncation
  and clean-up first checks that the database name ends with `_test` (URL check) and that
  `current_database()` also ends with `_test` (connection check). Redis clean-up deletes only keys under a
  prefix ending in `test:` (never `FLUSHDB`).
- **Why:** mocks would not prove constraints, locking or Lua atomicity; the guard makes it impossible for a
  test run to touch the development database.
- **Trade-offs:** tests in different files run one after another (shared database).

## TD-006 Security headers and same-origin checks

- **Decision:** a Content-Security-Policy **without nonces**, built from config and set per request in the
  proxy; HSTS only for HTTPS origins with a positive max-age; `nosniff`, `Referrer-Policy`,
  `X-Frame-Options: DENY`, `Permissions-Policy` from `next.config.ts`. API requests that change data
  (`POST`, `PUT`, `PATCH`, `DELETE`) must send an `Origin` equal to the site's configured public origin.
- **Why:** Next 16 documents that nonce-based CSP requires dynamic rendering for every page and is
  incompatible with Partial Prerendering, which this app uses. The `Origin` check plus `SameSite`
  cookies blocks cross-site form posts.
- **Alternatives:** nonces (rejected: lose static rendering); experimental SRI hashes (not adopted while
  experimental).
- **Trade-offs:** `script-src` keeps `'unsafe-inline'` (Next's inline bootstrap scripts), so CSP
  limits where scripts load from but does not stop an injected inline script. Output escaping (React)
  remains the main XSS defence.

## TD-007 Health status rule (approved by the owner, 2026-11-07)

PostgreSQL down → 503 `unavailable`. Elasticsearch or Redis down → 200 `degraded`, only while a tested
fallback exists. Each dependency is reported separately with a `critical` flag; every probe has a time
limit. Details: `docs/redis-design.md` §1.1.

## TD-008 Payments: Razorpay Test Mode behind a provider interface, with a local simulator

- **Decision (approved, built in Wave 8B):** a `PaymentProvider` interface with two adapters,
  `RazorpayProvider` (Test Mode keys only; start-up refuses any key not starting `rzp_test_`) and
  `SimulatedProvider` (no network). `payments.onlineProvider` in config selects one; tests and CI always
  use the simulator. Payment state changes only through guarded Postgres updates.
- **Local webhook delivery, kept isolated (owner correction 4):**
  1. Day-to-day development does **not** need webhooks: after checkout the server verifies Razorpay's
     signature and fetches the payment from Razorpay's API (outbound calls work from a laptop), and a
     reconciliation sweeper catches anything missed.
  2. Automated tests never use the network: recorded webhook payloads are signed locally with the test
     webhook secret and posted to the handler.
  3. To see real Test Mode webhooks, run a short-lived HTTPS tunnel (for example `cloudflared` or
     `ngrok`) only for the duration of the test, and register its URL in the Razorpay **Test Mode**
     dashboard. The tunnel host is added to a separate `webhookHosts` list in the development config;
     `src/proxy.ts` will route that host to `/api/webhooks/payments/*` **only** and return 404 for
     everything else, so the store, admin pages and other APIs are never reachable through the tunnel.
  4. Every webhook is HMAC-verified on the raw body and deduplicated by event id; unsigned or
     wrongly-signed requests get 401 and change nothing.
  5. Secrets (`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) stay in the local `.env`; the tunnel only
     carries Razorpay's signed requests. Close the tunnel and delete the dashboard webhook afterwards.
- **Trade-offs:** real webhooks are verified manually (and recorded for the demo video), not in CI.

## TD-009 Password hashing: Argon2id (approved for Wave 2B)

Argon2id via `@node-rs/argon2`, at or above OWASP's minimum (19 MiB memory, 2 iterations,
parallelism 1), subject to compatibility and timing tests in Wave 2B. bcrypt (the plan's original choice)
remains the fallback if those tests fail.

## TD-010 Custom 404 pages with several root layouts

`src/app/global-not-found.tsx` (behind `experimental.globalNotFound`) renders the store or admin 404
based on the `x-surface` header set by the proxy. Per-surface catch-all routes were tried first and
returned 200 or an empty shell; the full investigation is in `IMPLEMENTATION_PROGRESS.md`.

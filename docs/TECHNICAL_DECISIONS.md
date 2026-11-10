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

## TD-009 Password hashing: Argon2id (benchmark gate passed, 2026-11-07)

- **Decision:** Argon2id through `@node-rs/argon2` **2.2.2** (pinned exactly), memory **19,456 KiB**, **2**
  iterations, parallelism **1** (OWASP Password Storage Cheat Sheet minimum). Only the asynchronous `hash` and
  `verify` functions are used. bcrypt (the plan's original choice) was the fallback if the gate failed; it
  passed, so bcrypt is not used.
- **Why:** OWASP lists Argon2id as the preferred algorithm (memory-hard, so GPU cracking is expensive) and
  bcrypt as a legacy option with a 72-byte password limit.
- **Gate (owner criterion: verify p95 ≤ 250 ms on the owner's Mac, at least 50 samples):** passed.

  | Platform                                                                 | Native binding           | Verify p95          | Hash p95           | 10 concurrent logins, per-login p95 | Async event-loop gap p99 |
  | ------------------------------------------------------------------------ | ------------------------ | ------------------- | ------------------ | ----------------------------------- | ------------------------ |
  | macOS arm64 (Apple M2, 8 GiB, Low Power Mode on), 3 runs × 50            | `argon2-darwin-arm64`    | 8.7 / 17.8 / 8.7 ms | 8.8 / 9.7 / 9.1 ms | 40.3 / 41.1 / 39.4 ms               | 1.5–2.7 ms               |
  | Linux arm64, native container `node:26.13.0`                             | `argon2-linux-arm64-gnu` | 11.8 ms             | 11.2 ms            | 48.5 ms                             | 5.4 ms                   |
  | Linux x64, container `node:26.13.0` (`linux/amd64`, emulated by Rosetta) | `argon2-linux-x64-gnu`   | 23.4 ms             | 24.0 ms            | 80.0 ms                             | 3.8–4.5 ms               |
  - Correctness on every platform: output `$argon2id$v=19$m=19456,t=2,p=1`; correct password verifies;
    wrong, empty and off-by-one passwords are rejected; unique salts; Unicode and 128-character passwords work.
  - No install scripts on any platform.
  - Event loop: with async verify the main thread stayed responsive (p99 gap ≤ 2.7 ms on the Mac). The same
    instrument measured a 44 ms freeze for five blocking `verifySync` calls, which validates the measurement.
  - Memory: about +61 MiB peak during bursts of 10 concurrent logins (Node runs at most 4 hashes at a time
    on its default worker pool).
  - Linux x64 numbers come from emulation and only prove compatibility, not speed.

- **Consequences:**
  - Hashing shares Node's worker pool (`UV_THREADPOOL_SIZE`, default 4) with file and DNS work. Login bursts
    are limited by the Wave 2A rate limiter; raise the pool size only if measurements show contention.
  - Production images must install the package inside the image so the correct Linux binding (glibc or
    musl) is chosen (Wave 15).
- **Method notes:**
  - The first event-loop measurement (`monitorEventLoopDelay`) could not detect a known 44 ms block, so it
    was discarded and replaced by a 1 ms timer-gap measurement.
  - "Worst p95 of three runs" is reported because individual samples were not kept.

## TD-010 Custom 404 pages with several root layouts

`src/app/global-not-found.tsx` (behind `experimental.globalNotFound`) renders the store or admin 404
based on the `x-surface` header set by the proxy. Per-surface catch-all routes were tried first and
returned 200 or an empty shell; the full investigation is in `IMPLEMENTATION_PROGRESS.md`.

## TD-011 Sessions: opaque tokens stored as hashes in PostgreSQL (Wave 2B)

- **Decision:** a session is a row in `sessions`. The browser holds a random token (32 bytes from
  `crypto.randomBytes`, base64url); the database stores only its SHA-256 (`token_hash`). Customer sessions
  last 30 days, staff sessions 12 hours (`authentication.*` in the config file).
- **Cookies:** `store_session` on the store host and `admin_session` on the admin host. Both are `HttpOnly`,
  `SameSite=Lax`, `Path=/`, without `Domain`. In staging and production `secureCookies` is `true`, which
  adds `Secure` and the `__Host-` name prefix (a config test enforces this).
- **Why not JWT:** sign-out, sign-out everywhere, blocking a customer and deactivating staff must take effect
  on the next request. With a database row that is one `UPDATE`; with a self-contained token it needs a
  deny-list, which is a session table again.
- **Every request** looks the hash up together with the account (`LEFT JOIN customers / staff_users`), so a
  blocked customer or deactivated staff member loses access immediately even with an unexpired session.
- **Wrong account type:** a customer token presented on the admin API gets 403 `WRONG_ACCOUNT_TYPE`; the
  store cookie is never read on the admin host (401).
- **Pages:** `src/proxy.ts` makes an _optimistic_ check, looking only at whether a cookie is present.
  - Store `/account*` without a cookie redirects to `/login?next=…`.
  - Every admin page except `/login` redirects to `/login` without a cookie (deny by default, so a page
    added in a later wave cannot be left unprotected by forgetting a list entry).
  - The page itself verifies the session in a Server Component inside `<Suspense>` (the Next 16 pattern
    for Cache Components) and redirects if it is invalid.
  - APIs always verify.
- **Consequence:** a signed-out visitor to an unknown admin URL now sees the sign-in page instead of a 404
  (it no longer reveals which admin URLs exist). The Wave 1 admin 404 tests now sign in first.
- **Open-redirect protection:** `?next=` is used only if it is a same-site path (`src/lib/safe-next-path.ts`).
- **Clean-up:** expired rows are filtered by `expires_at` (indexed); deleting old rows is a Wave 14 job.

## TD-012 Account enumeration trade-off (owner decision, Wave 2B)

- **Sign-in:** unknown email, wrong password, blocked customer, deactivated staff and (outside development
  and test) refused demo credentials all return the same 401 body (`INVALID_CREDENTIALS`, "The email or password is incorrect."). For an unknown email the server
  still runs one Argon2id verification against a dummy hash, so response time does not reveal whether the
  account exists. An HTTP test sends all six cases (store: unknown, wrong, blocked; admin: unknown, wrong, deactivated) to the
  running server and requires identical status, body and headers (apart from `x-request-id` and `date`).
- **Registration:** a duplicate email returns 409 `EMAIL_ALREADY_REGISTERED` (owner decision: clear feedback
  for shoppers). This does reveal that an address is registered.
- **Mitigation:** registration is rate-limited per client IP (10 per hour in development and production),
  and sign-in per IP + email (5 per minute). How the client IP is found: TD-015.
- **Alternative not taken:** always answer "check your email" and send a message. That needs an email
  provider, which the project does not have.

## TD-013 Demo passwords: one known password, development and test only (Wave 2B)

- **Decision:** the 8 seeded accounts use `DemoPass!2026`:
  - 5 staff and 3 customers;
  - all on the reserved domain `demo-store.test`;
  - hashed with Argon2id when seeded.

  The password and domain live in `src/modules/identity/demo-credentials.ts` (shared by the seed and the
  sign-in code). They are listed in the README, labelled development/demo only.

- **Layer 1, seeding (allowlist):** `assertDemoCredentialsAllowed(APP_ENV)` permits only `development` and
  `test`. It refuses `production`, `staging`, a typo such as `prod`, a different letter case
  (`Production`) and an empty value. Both `npm run db:seed` and `npm run db:seed:demo-passwords` call it
  before any database work.
  - Unit tests: `demo-credentials.test.ts`.
  - Command-level proof (journal, final checks): 8 refused runs against the test database, exit 1, no change.
  - _Correction:_ until the final checks this guard refused only the exact value `production`, and the
    "test" cited here was a manual rehearsal. Both are now fixed.
- **Layer 2, sign-in (runtime):** credentials are refused unless **both** of these hold:
  1. `authentication.demoAccountsAllowed` is `true` (it is `false` in the staging and production configs,
     enforced by a config test);
  2. `APP_ENV` is `development` or `test`.

  When refused:
  - any sign-in with an `@demo-store.test` email or with the demo password answers the ordinary 401
    after a dummy hash check (timing unchanged);
  - registration with either answers 400 with a field error.

  This protects production even if demo rows arrive by accident, for example in a copied database dump.
  Proven with the real build running `APP_ENV=production` and the production config against a database
  containing all 8 demo accounts:
  - all 8 sign-ins → 401, while the same database under the test config → 200;
  - registration with the demo password or domain → 400.

- **Changing existing databases without side effects:** `applyDemoPasswordHashes` updates only
  `password_hash`, with a raw `UPDATE … WHERE email = …`. Prisma's `update()` would also change `updated_at`.
  It skips accounts whose hash already verifies, so a second run changes nothing.
- **Residual risk:**
  - The seed scripts load `.env`. Running `db:seed` on a production database from a developer machine whose
    `.env` says `APP_ENV=development` would pass layer 1. Layer 2 still refuses every demo sign-in on the
    production server.
  - Wave 15 deployment notes must state that seeds are never run against production.
- **Future password changes** (none exist yet) must apply the same refusal.

## TD-014 Audit logging (Wave 2B)

- **Events:**
  - `customer.registered`
  - `customer.profile_updated`
  - `customer.address_created`, `customer.address_updated`, `customer.address_archived`
  - `customer.default_address_changed`
  - `customer.logout_everywhere`
  - `staff.login_succeeded`, `staff.login_failed`
- **Same transaction:** each audit row is written in the transaction that makes the change, so a rolled-back
  change never leaves an audit row behind (integration test).
- **Failed staff sign-ins** are written on their own, since there is no change to attach them to:
  - actor `SYSTEM`;
  - the staff user's id, or `unknown`;
  - the email tried;
  - a reason: `UNKNOWN_EMAIL`, `WRONG_PASSWORD`, `ACCOUNT_DEACTIVATED` or `DEMO_CREDENTIAL_REFUSED`
    (TD-013).

  The reason is visible only to people with `audit.read`; the client always gets the identical 401.

- **No secrets:**
  - `recordAuditEvent` removes any key matching `pass(word)?|hash|token|secret|otp|cookie|session|credential`
    before writing.
  - Data is flat (no nested objects), so nothing can hide one level down.
  - Address events record which fields changed plus city and pincode, never street lines or phone numbers.
  - Tests scan every audit row for these keys, for `$argon2`, and for the raw password and session token
    used in the test.
- **Consequence found by the tests:** the filter also removed a harmless key, `revokedSessionCount`. The key
  is now `revokedCount`; the filter stays strict.
- **IP address:** stored only if it parses as an IP; see TD-015 for where it comes from.

## TD-015 Client IP for rate limits and audit (Wave 2B, revised in final check 7)

- **Where the IP is used:** sign-in rate limits (`ip|email`), the registration rate limit (`ip`) and
  `audit_logs.ip_address`. All of them get it from one function, `clientIpAddress` in
  `src/lib/client-ip.ts`, called only by `requestMetadata` in `access-control.ts`.
- **Setting:** `authentication.trustedProxyHopCount`, a required whole number from 0 to 5 (strict schema;
  the old `trustProxyHeaders` key is refused).
  - `0`: `X-Forwarded-For` is never read. The IP is unknown.
  - `N ≥ 1`: the client IP is the entry N places from the **right**. If there are fewer than N entries,
    or that entry is not a valid IP, the IP is unknown. It never falls back to another entry.
- **Why from the right:** each proxy appends the address it received the connection from, so entries on
  the left are whatever the client sent. The first version used the leftmost entry. Behind any proxy that
  appends (nginx `$proxy_add_x_forwarded_for`, AWS ALB, most ingress controllers), that let a client
  choose a new IP on every request: unlimited sign-in guesses per account, no registration limit, and a
  forged IP in the audit trail. Found by an independent review; red/green tests in
  `tests/integration/client-ip-trust.test.ts`.
- **Next.js detail:** the Next server sets `x-forwarded-for` to the socket address only when the request
  has no such header (`??=` in `base-server.js`). A client-supplied header passes through unchanged, so
  with no proxy in front the header is entirely client-controlled. That is why the default is 0.
- **When the IP is unknown** (development, test, and staging/production until the topology is known):
  - registration uses one shared bucket (`unknown-client`);
  - sign-in uses a bucket per email.
    In local development that means about 10 registrations per hour across all local users. The test
    config raises registration to 50 per minute so repeated HTTP and browser runs do not trip it.
- **Staging and production are set to 0 on purpose; this is a deployment requirement, not a finished
  production setting.** No hosting platform has been chosen or verified, so
  no proxy is trusted. Before the first hosted deployment the hop count must be set from evidence about
  the real topology (see DEPLOYMENT_GUIDE). For example, a platform that overwrites the header with the
  client address, or a single appending proxy, needs 1; a CDN in front of a load balancer needs 2.
- **Not done (separate decision):** a per-account sign-in limit keyed on email alone (L20).

## TD-016 Catalogue integrity: schema rules and the lifecycle contract (Wave 3)

Migration `20261110093000_catalogue_integrity` (additive). Reverse script:
`prisma/rollbacks/20261110093000_catalogue_integrity.down.sql` (Prisma has no down migrations).

- **Enforced by the database:**
  - `products.version` (starts at 0, never negative): an edit sends the version it read, and the update
    is `… WHERE id = $id AND version = $read`, setting `version = version + 1`. Zero rows means someone
    else saved first: 409 `STALE_PRODUCT`. `updated_at` cannot do this job, because the database stores
    microseconds and JavaScript dates have milliseconds.
  - `product_media(product_id, variant_id)` references `product_variants(product_id, id)`, with update
    and delete restricted. An image cannot point at another product's variant, and a variant with images
    can be neither deleted nor moved to another product. Product-level images (no variant) are unaffected.
  - `status = 'ARCHIVED'` exactly when `archived_at` is set.
  - Formats: slugs `^[a-z0-9]+(-[a-z0-9]+)*$`, type and attribute codes `^[a-z][a-z0-9_]{0,39}$`, SKUs
    `^[A-Z0-9]+(-[A-Z0-9]+)*$` (at most 64 characters).
  - ENUM and MULTI_ENUM attributes have a non-empty array of allowed values; other types have none;
    variant options must be ENUM.
  - Image positions start at 0 and every image has non-blank alt text (the column default `''` was
    removed, so the generated types require it).
- **Enforced by the Wave 3 services, with tests (owner requirements, 2026-11-10):**
  1. **An ACTIVE product always has at least one ACTIVE variant.** Archiving or deactivating its last
     active variant is refused (409) until the product is moved to DRAFT. Activating a product needs at
     least one active variant (422). Both run inside the transaction that holds the product row lock.
  2. **Archiving never touches inventory.** Archiving a product or variant only changes its status. It
     never deletes, edits or releases `inventory_levels` rows or reservations, never deletes
     `inventory_movements`, and never changes order lines, carts, reviews or collection links. Open
     orders keep their reservations and are fulfilled normally. Tests assert those rows are byte-identical
     before and after an archive with reserved stock.
  3. **Image deletion is audited in full.** The audit row's `before` keeps the image id, product id,
     variant id (or null), URL, alt text and position. Order lines keep their own `image_url` snapshot.
  4. **SKUs, variant option values and a product's type are never changed after creation.** A product's
     slug changes only while it is a DRAFT. Update schemas do not accept these fields.
- **Why not database triggers for 1 and 4:** the project has none, and these rules span rows (rule 1) or
  are simplest as "the update statement never includes the column" (rule 4). Service tests prove them.
- **Kept for later waves:** see `docs/DATABASE_DESIGN.md`, "Integrity requirements for later waves"
  (the order-item composite key and the weight and dimension snapshot, both mandatory in Wave 8).

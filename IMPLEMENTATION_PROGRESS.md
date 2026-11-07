# Implementation Progress

Spec: `~/Downloads/ECOMMERCE_PLATFORM_PLAN.md` (read-only). Waves follow plan section 12.

## Waves

- [x] Wave 1 — Foundation (approved by the owner on 2026-11-07; commit `fa6ebd6` on `main`, on GitHub (private); CI result not yet verified)
- [x] Wave 2A — Platform groundwork (approved by the owner on 2026-11-07; committed locally on `main`, not pushed; not yet tested by CI)
- [ ] Wave 2B — Identity, access, audit (not started; waits for approval of Wave 2A)
- [ ] Waves 3–16 (not started; revised order in `docs/REQUIREMENTS_TRACEABILITY.md`)

## Environment decisions (2026-11-07)

| Item    | Plan           | This machine                                  | Decision                                                               |
| ------- | -------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| Node    | v26.5.1        | only v20.19.6 installed                       | Installed v26.13.0 via nvm (user choice), pinned in `.nvmrc`           |
| Infra   | Docker Compose | Docker not installed; Postgres.app 18 present | User chose Docker/OrbStack + `docker-compose.yml`                      |
| Prisma  | Prisma ORM     | npm `latest` tag points at 8.0.0-rc.33        | Pinned stable 7.10.1 (`prisma-client` generator, `@prisma/adapter-pg`) |
| Next.js | 16.4.5         | available                                     | 16.4.5 with `cacheComponents: true`                                    |

## Wave 1 — verified so far

### Unit tests

```
$ npx vitest run src/lib
 Test Files  3 passed (3)
      Tests  25 passed (25)
```

Covers proxy host routing (`src/lib/host-routing.test.ts`), Money helper (`src/lib/money.test.ts`), env schema (`src/lib/env.test.ts`).

### First Docker attempt (2026-11-07) — BLOCKED, since resolved

Step 1, `docker compose up -d`:

```
$ which docker && docker version ...
docker not found
```

Investigation:

```
$ ls ~/.orbstack/bin
ls: ~/.orbstack/bin: No such file or directory
$ ls -la /var/run/docker.sock
ls: /var/run/docker.sock: No such file or directory
$ ls /Applications | grep -i -E 'orb|docker|podman|colima'
(no output)
$ ls /usr/local/bin/orb /opt/homebrew/bin/docker
No such file or directory (both)
$ ps aux | grep -i -E 'orbstack|dockerd'
(no output)
$ mdfind -name OrbStack.app
(no output)
```

Result at that time: OrbStack was not installed. Resolved later the same day; see "Live infrastructure verification" below.

### UI foundation (2026-11-07)

Tailwind `@theme` tokens, ThemeProvider and status maps, 19 atoms, layouts, and per-surface root layouts, home, not-found, loading and error pages exist. Known gap at the time: URLs that matched no route showed Next's default 404 (fixed in the Wave 1 follow-up).

```
$ npm run typecheck        # next typegen && tsc --noEmit
✓ Types generated successfully
(no tsc errors)
$ npx eslint src --max-warnings 0
(no output — clean)
```

Fixed along the way: `prisma.config.ts` failed `exactOptionalPropertyTypes` (`url: string | undefined`), so the datasource URL is now only set when `DATABASE_URL` is defined.

Rendering on both hosts was verified later under `next dev` and `next build` (see below).

### Database schema, migration, seed (2026-11-07)

Files: `prisma/schema.prisma`, `prisma/migrations/20261107000000_init/migration.sql`, `prisma/seed/*`, `docs/er-diagram.svg`.

As reported by the schema sub-agent (not observed directly in the main session): checked against a temporary PostgreSQL 18.1 started from `/Library/PostgreSQL/18` binaries on port 54329 (removed afterwards), **not** the Docker container. Every claim below was later re-verified on Docker (see Live infrastructure verification and Final review).

- `prisma migrate deploy` applied the migration with no errors; a diff between the database and the schema came back empty (no drift).
- Running the seed twice gave identical row counts (idempotent).
- Data checks:
  - reserved stock = quantity in unshipped shipments (10 = 10)
  - each inventory level = its last ledger row
  - Σ order totals = Σ payment amounts (₹94,894)
  - all 9 order states seeded
- Not run: `npm run db:reset`. Prisma 7 refuses `migrate reset` from an AI agent unless the user consents, and this was not bypassed.

Plan deviations (reasons in `prisma/schema.prisma`): no `INCLUDE` on the inventory PK (Prisma would treat it as drift); `categories.path` uses a GIN trigram index instead of `text_pattern_ops` (same reason); `rate_limit_counters` table added for section 10B; seeded password hashes are placeholders until bcrypt arrives in Wave 2.

### Full check after merging (2026-11-07)

```
$ npm run typecheck      → ✓ route types generated, tsc: no errors
$ npm run lint           → clean (0 warnings allowed)
$ npm run format:check   → All matched files use Prettier code style!
$ npm test               → 3 files, 25 tests passed
$ npx next build         → ✓ Compiled successfully
  Route (app): ○ /_not-found  ○ /admin  ƒ /api/health  ○ /store   · ƒ Proxy (Middleware)
```

## Live infrastructure verification (2026-11-07, OrbStack)

### 1. Docker availability

```
$ docker version --format 'client {{.Client.Version}} / server {{.Server.Version}} ({{.Server.Os}}/{{.Server.Arch}})'
client 29.8.2 / server 29.8.2 (linux/arm64)
$ docker compose version
Docker Compose version v5.5.0
$ docker context ls          → orbstack * (unix://~/.orbstack/run/docker.sock)
```

### 2. Configuration checks before starting anything

```
$ docker compose config --quiet      → valid
$ docker compose config --services   → elasticsearch, postgres
$ diff .env .env.example             → identical
$ ls prisma/migrations               → 20261107000000_init, migration_lock.toml
```

- Redis: **not configured and not part of the plan.** Sessions, rate limits and the search outbox are Postgres-backed (plan §10B), so nothing was started or added for Redis.
- `lsof` showed nothing on 5432/9200/3000, but that check turned out to be incomplete (see failure 1).

### 3. Start containers

```
$ docker compose up -d --wait        (1m52s, mostly image pulls)
 Container ecommerce-platform-postgres-1 Healthy
 Container ecommerce-platform-elasticsearch-1 Healthy
$ docker compose ps
ecommerce-platform-elasticsearch-1   elasticsearch:9.5.5   Up (healthy)   0.0.0.0:9200->9200/tcp
ecommerce-platform-postgres-1        postgres:18.6         Up (healthy)   0.0.0.0:5432->5432/tcp   (later 5433, see failure 1)
```

### 4. PostgreSQL and Elasticsearch checks

```
$ docker compose exec -T postgres psql -U ecommerce -d ecommerce -tAc "select version();"
PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
$ ... -tAc "select datname from pg_database where datname like 'ecommerce%'"
ecommerce
ecommerce_test
$ ... -tAc "select uuidv7();"
01a1b556-fb0c-7549-bc62-17da934607ce

$ curl -s localhost:9200            → cluster docker-cluster, version 9.5.5 (default flavour)
$ curl -s 'localhost:9200/_cluster/health?pretty'
  "status" : "green", "number_of_nodes" : 1, "active_shards_percent_as_number" : 100.0
```

### 5. Migrations

**Failure 1: P1000 authentication failed**

```
$ npm run db:deploy
Datasource "db": PostgreSQL database "ecommerce", schema "public" at "localhost:5432"
Error: P1000: Authentication failed against database server, the provided database credentials for `ecommerce` are not valid.
```

Investigation: the same credentials worked inside the container, so the host connection was reaching a different server.

```
$ netstat -anv -p tcp | grep '\.5432 .*LISTEN'
tcp4  *.5432  LISTEN  postgres:563
tcp6  *.5432  LISTEN  postgres:563
$ ls /Library/LaunchDaemons | grep -i postgres
postgresql-18.plist
```

Root cause: a native EDB PostgreSQL 18 service (pid 563, owned by the `postgres` user) listens on `*:5432`, so `localhost:5432` from the host hits it instead of the container. The earlier `lsof` check runs as the current user and cannot see processes owned by other users, which is why it missed this.

Fix (no system changes; the native service was left running): published the container on host port **5433**.

- `docker-compose.yml`: `'5433:5432'`
- `.env` and `.env.example`: `DATABASE_URL=postgresql://ecommerce:ecommerce@localhost:5433/ecommerce`
- README notes the port
- CI unchanged: the runner's service container still uses 5432 on a clean host

After the fix:

```
$ npm run db:deploy
Datasource "db": PostgreSQL database "ecommerce", schema "public" at "localhost:5433"
Applying migration `20261107000000_init`
All migrations have been successfully applied.          (exit 0)
$ npx prisma migrate status
Database schema is up to date!
$ npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- This is an empty migration.                           (no drift)
```

Database objects created by the migration:

| Check                                        | Result                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base tables (excluding `_prisma_migrations`) | 45                                                                                                                                               |
| CHECK constraints                            | 32                                                                                                                                               |
| Indexes                                      | 133                                                                                                                                              |
| `inventory_levels.available_quantity`        | `GENERATED ALWAYS AS (on_hand_quantity - reserved_quantity)`                                                                                     |
| `order_number_seq`                           | start 100001                                                                                                                                     |
| `pg_trgm`                                    | 1.6                                                                                                                                              |
| Columns defaulting to `uuidv7()`             | 38                                                                                                                                               |
| BRIN / jsonb_path_ops / partial indexes      | `audit_logs_created_at_brin_idx`, `products_attributes_path_idx`, `customer_addresses_one_default_per_customer`, `search_outbox_unprocessed_idx` |

### 6. Seed

```
$ npm run db:seed
Seeded 193 variants, 40 products and 57 order stock events.     (exit 0, 3.8s)
$ npm run db:seed          (second run)
Seeded 193 variants, 40 products and 57 order stock events.
$ diff counts-after-run-1 counts-after-run-2
IDENTICAL row counts after second run
```

Row counts: products 40, product_variants 193, product_media 120, categories 36, brands 8, product_types 4, attribute_definitions 23, warehouses 3, inventory_levels 348, inventory_movements 405, orders 20, order_items 32, shipments 24, shipment_items 32, shipment_tracking_events 43, payments 20, order_status_history 76, customers 3, customer_addresses 6, staff_users 5, roles 5, permissions 19, role_permissions 45, coupons 4, coupon_redemptions 1, courier_partners 2, courier_serviceable_pincodes 32, reviews 4, banners 3, collections 2, store_settings 7, search_outbox 40, carts 1, cart_items 2.

Data consistency checks (all pass):

| Check                                             | Result                                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Σ reserved stock vs unshipped shipment quantity   | 10 = 10                                                                                                                             |
| Reserved stock mismatches per variant × warehouse | 0                                                                                                                                   |
| Σ order totals vs Σ payment amounts               | 9,489,400 = 9,489,400 paise                                                                                                         |
| Order statuses seeded                             | all 9 (PLACED 2, CONFIRMED 1, PROCESSING 2, PARTIALLY_SHIPPED 1, SHIPPED 3, PARTIALLY_DELIVERED 1, DELIVERED 7, CANCELLED 2, RTO 1) |
| Rows with negative stock                          | 0                                                                                                                                   |
| Categories per level                              | L1 4, L2 8, L3 13, L4 11                                                                                                            |
| Staff                                             | one per role (SUPER_ADMIN, CATALOGUE_MANAGER, INVENTORY_MANAGER, ORDER_OPS, SUPPORT)                                                |
| Coupons                                           | SAVE10 valid, FLAT150 expired, BIGSALE25 exhausted (100/100), WELCOME20 first order only                                            |

### 7. Tests (Wave 1 scope)

```
$ npm test
 Test Files  3 passed (3)
      Tests  25 passed (25)
```

### 8. Dev server and health endpoint

```
$ npm run dev
▲ Next.js 16.4.5 (Turbopack)  ✓ Ready in 225ms  - Cache Components enabled

$ curl -i -H 'Host: store.localhost:3000' http://127.0.0.1:3000/api/health
HTTP/1.1 200 OK
x-request-id: d2d87ee8-d687-4917-889e-bde27ea085ba
{"status":"ok","checks":{"postgres":"up","elasticsearch":"up"}}
$ curl -H 'Host: admin.localhost:3000' http://127.0.0.1:3000/api/health
{"status":"ok","checks":{"postgres":"up","elasticsearch":"up"}}
```

To confirm the health check really probes Elasticsearch, it was stopped and restarted:

```
$ docker compose stop elasticsearch
$ curl .../api/health → HTTP 503 {"status":"degraded","checks":{"postgres":"up","elasticsearch":"down"}}
$ docker compose start elasticsearch && docker compose up -d --wait elasticsearch
$ curl .../api/health → HTTP 200 {"status":"ok",...}
```

Two-domain routing:

| Host                                    | Path                  | HTTP                              | Expected                                    |
| --------------------------------------- | --------------------- | --------------------------------- | ------------------------------------------- |
| store.localhost:3000                    | `/`                   | 200 (`<title>Demo Store</title>`) | store home                                  |
| admin.localhost:3000                    | `/`                   | 200 (`<title>Admin</title>`)      | admin home                                  |
| store.localhost:3000                    | `/admin`              | 404                               | admin page hidden on store host             |
| store.localhost:3000                    | `/api/admin/anything` | 404                               | admin API hidden on store host              |
| admin.localhost:3000                    | `/api/store/anything` | 404                               | store API hidden on admin host              |
| localhost:3000                          | `/`                   | 404                               | unknown host                                |
| localhost:3000                          | `/api/health`         | 404                               | unknown host                                |
| real DNS `http://store.localhost:3000/` |                       | 200 (::1)                         | `*.localhost` resolves without `/etc/hosts` |
| real DNS `http://admin.localhost:3000/` |                       | 200 (::1)                         | same                                        |

Dev server log: no errors or warnings.

Side effect: `next dev` generated `AGENTS.md` in the project root (Next.js agent rules; the file says it is re-created if removed). Left in place and uncommitted.

## Wave 1 "Done when" status

| Criterion                                 | Status                                                                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose up` works                 | ✅ verified                                                                                                                                   |
| Migrations + seed from a clean database   | ✅ verified with `db:deploy` + `db:seed` on new Docker volumes                                                                                |
| `npm run db:reset`                        | ⚠️ not run by the agent: Prisma 7 blocks `migrate reset` from AI agents without explicit user consent. User to run `! npm run db:reset` once. |
| `npm run dev`, both hosts render          | ✅ verified                                                                                                                                   |
| Health endpoint                           | ✅ verified (200 when up, 503 when ES is down)                                                                                                |
| Typecheck / lint / format / tests / build | ✅ re-verified in Final review (all exit 0)                                                                                                   |
| ER diagram generates                      | ✅ re-run in Final review: `npm run docs:erd` exit 0, regenerated in 1.88s                                                                    |
| CI green                                  | ❌ not verified: the repo has no commits and no GitHub remote yet                                                                             |

## Final review before Wave 1 approval (2026-11-07)

Everything below was re-run from scratch in the main session; nothing is carried over from earlier sections.

### Containers

```
$ docker compose ps
elasticsearch   elasticsearch:9.5.5   Up (healthy)   0.0.0.0:9200->9200/tcp
postgres        postgres:18.6         Up (healthy)   0.0.0.0:5433->5432/tcp
$ docker inspect ... → both health=healthy, restarts=0
$ docker compose exec -T postgres pg_isready → accepting connections; server_version 18.6
$ curl localhost:9200/_cluster/health → status green, nodes 1, unassigned 0
```

Redis: no service in `docker-compose.yml`, no container on the Docker host, no reference in code or `.env.example`. Not part of the plan; nothing to verify.

### Schema and migrations

```
$ npx prisma migrate status → 1 migration found, Database schema is up to date!
$ npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- This is an empty migration.
```

- All **44 tables from plan §9.2** exist; the only extras are `rate_limit_counters` (deliberate) and Prisma's `_prisma_migrations`.
- All **40 index requirements from plan §9.4** were matched against `pg_indexes`: 40/40 OK. A first run of this check wrongly reported 14 unique indexes missing because of a bug in my match pattern; rerun with the fixed pattern: 14/14 OK.
- Constraints rejected bad writes (inside a rolled-back transaction):

| Attempted write                                               | Result                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------- |
| reserved > on hand                                            | rejected, `inventory_levels_quantities_check`                  |
| negative on hand                                              | rejected, `inventory_levels_quantities_check`                  |
| price above MRP                                               | rejected, `product_variants_price_check`                       |
| category level 5                                              | rejected, `categories_level_check`                             |
| second default address                                        | rejected, unique `customer_addresses_one_default_per_customer` |
| writing `available_quantity`                                  | rejected, "can only be updated to DEFAULT"                     |
| valid guarded reservation (`... AND on_hand - reserved >= 1`) | `UPDATE 1`                                                     |

### Seeded records

Consistency checks from the earlier sections still hold. Re-verified here for the first time on Docker (previously only the sub-agent's claim):

```
inventory_levels: 348 · with a ledger row: 348 · without: 0 · level ≠ last ledger row: 0
```

### Quality gates (Node v26.13.0)

| Command                | Exit | Result                                                            |
| ---------------------- | ---- | ----------------------------------------------------------------- |
| `npm run typecheck`    | 0    | route types generated, no tsc errors                              |
| `npm run lint`         | 0    | no findings, `--max-warnings 0`                                   |
| `npm run format:check` | 0    | all files formatted                                               |
| `npm test`             | 0    | 3 files, 25 tests passed                                          |
| `npx next build`       | 0    | compiled; routes `/store` ○, `/admin` ○, `/api/health` ƒ, proxy ƒ |
| `npm run docs:erd`     | 0    | `docs/er-diagram.svg` regenerated in 1.88s                        |

Test report (`npx vitest run --reporter=verbose`), all ✓:

- `host-routing.test.ts` (13): case-insensitive host match; unknown host → null; store home rewrite; nested store rewrite; `/admin` on store host stays in store surface; store APIs + health allowed; admin APIs + webhooks 404 on store; admin page rewrite; admin APIs + webhooks allowed; store APIs 404 on admin; unknown host 404 for pages and APIs; missing Host header 404; lookalike prefixes (`/api/healthcheck`, `/api/storefront`) 404.
- `money.test.ts` (6): integer-only paise (rejects fractions, NaN, unsafe ints); add/subtract; integer quantity only; basis points half-up rounding incl. negatives; min/max; ₹ formatting in en-IN grouping.
- `env.test.ts` (6): valid env + host normalisation; every missing variable reported; non-Postgres URL rejected; empty host list rejected; same host on both surfaces rejected; unknown log level rejected.

Integration tests: **none existed at this point** (HTTP and browser tests were added in the follow-up below; DB-backed integration tests still do not exist). The plan's Wave 1 test list is unit-only (proxy routing, Money, env schema). The `ecommerce_test` database exists but is empty (0 tables) and Supertest is not installed yet; both are first needed in Wave 2.

### Health endpoint (dev server)

```
$ curl http://store.localhost:3000/api/health → 200 {"status":"ok","checks":{"postgres":"up","elasticsearch":"up"}} in 0.078s
$ curl http://admin.localhost:3000/api/health → 200 (same body)
```

Routing matrix re-checked: store `/` 200, admin `/` 200, store `/admin` 404, store `/api/admin/x` 404, admin `/api/store/x` 404, `localhost:3000/` 404, store `/no-such-page` 404.

### Code rule scan (plan §10, §10E)

No hex colours outside the `@theme` block, no arbitrary Tailwind values, no inline `style`, no `any`, no lint/TS suppressions, no JSDoc/TODO. One cast (`amountPaise as Paise` in `Money.fromPaise`, the validated boundary), three one-line "why" comments. All 19 Wave 1 atoms and the 3 layouts exist.

### Dependency audit

- `npm audit --omit=dev`: 0 vulnerabilities.
- `npm audit` (incl. dev): 13 (5 low, 8 moderate), all in dev tooling: `@mermaid-js/mermaid-cli` (ER diagram), `eslint-config-next`, `typescript-eslint` and their dependencies. npm's suggested fix for the lint packages is a downgrade to an older major version, so it was not applied.

### Open items found in this review

1. ✅ **Resolved in the follow-up below** (the suggested catch-all fix turned out not to work; see "How the fix was found"). Original finding: **unmatched URLs showed Next's default 404 page**, not the store/admin `not-found.tsx`. Status codes are correct, but the page is unstyled. Cause: there is no top-level layout, so a URL that matches no route never enters a surface layout. Small fix (not applied, awaiting approval): add a catch-all `[...unmatched]/page.tsx` in each surface that calls `notFound()`.
2. **`npm run db:reset` not run**: Prisma 7 blocks `migrate reset` from AI agents without user consent.
3. **CI not run**: no commits, no GitHub remote.
4. **Fresh-clone install (`npm ci` on a clean checkout) not tested**: the repo has no commits to clone.
5. **Seeded passwords are placeholders**; no one can log in until Wave 2 (by design).
6. **Not built yet (by plan, later waves)**: TypedSQL queries, security headers and Origin checks, auth, integration tests.
7. ✅ `AGENTS.md` inspected and kept (see Owner decisions).

## Wave 1 follow-up: custom 404 pages, tests, Redis design (2026-11-07)

Requested before Wave 1 approval: fix the custom 404 pages, test them over HTTP and in a browser (Playwright), plan Redis, and document the missing integration tests and the dev-only advisories. Not done, by instruction: no commit, no Wave 2, no `db:reset`.

### Final 404 implementation

| File                                                                                     | Role                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/app/global-not-found.tsx` (new)                                                     | Handles every URL that matches no route. Static `<html>/<body>` shell; inside `<Suspense>` it reads the `x-surface` header set by `src/proxy.ts` and renders the store or admin view, with a per-surface `<title>` from `generateMetadata`. The Suspense fallback is a centred `Spinner` labelled "Loading". |
| `next.config.ts`                                                                         | `experimental.globalNotFound: true`. `partialPrefetching` stays `true` (it was briefly set to `false` during the investigation and restored).                                                                                                                                                                |
| `src/app/store/store-not-found-view.tsx`, `src/app/admin/admin-not-found-view.tsx` (new) | The two 404 views, each inside its own layout (`StoreLayout` header and footer / `AdminLayout` dark sidenav). Shared by the global page and the per-surface `not-found.tsx`, so there is one copy of each view.                                                                                              |
| `src/app/store/not-found.tsx`, `src/app/admin/not-found.tsx`                             | Now render the shared views (used when a page inside a surface calls `notFound()` during client navigation).                                                                                                                                                                                                 |
| `src/components/atoms/EmptyState`                                                        | New optional `headingLevel?: 1 \| 2` prop (default 2), so the store 404 has an `<h1>`; the admin 404's `<h1>` comes from the `AdminLayout` header.                                                                                                                                                           |

Result: an unmatched URL returns **HTTP 404** with the right surface's page rendered **on the server** (title, `<h1>`, navigation, back link), on the first request and every repeat. The two home pages still return 200.

### How the fix was found (attempts that failed, with evidence)

1. **Catch-all `[...unmatchedPath]/page.tsx` calling `notFound()`** in each surface → `next dev` returned **200**, with `NEXT_HTTP_ERROR_FALLBACK;404` inside a `<template>`. Cause: the root `loading.tsx` in each surface wraps every page in a Suspense boundary, so the 200 shell is streamed before `notFound()` runs. Moving `loading.tsx` aside fixed the status (404), confirming the cause.
2. **Same catch-all, checked on a production build** (`next build && next start`) → 404, but the HTML was a 1,227-byte error shell (`<html id="__next_error__">`, empty `<body>`), with no title or content without JavaScript.
3. **Catch-all with `generateStaticParams` + `await params`** (the pattern Next's docs give for Cache Components) → **first request 200** with an empty body, repeat requests 404. The docs say this pattern only gives blocking 404s without Partial Prefetching. With `partialPrefetching: false` the status was consistently 404, but the HTML was still the empty error shell.
4. **Bisect on the build output**: with a one-line `not-found.tsx` (no layout, no metadata), and with the not-found moved under a nested `(site)` route-group layout, the prerendered `__unmatched.html` was still the error shell, while the RSC payload did contain "Page not found" / "Back to the store". Conclusion: with several root layouts and no top-level layout, Next has no root 404 page to render on the server and falls back to client rendering. Next's docs name `global-not-found.js` for exactly this case ("Your app has multiple root layouts").
5. **`global-not-found.tsx` reading `headers()` directly** → build failed: `Route "/_not-found": Next.js encountered uncached or runtime data during prerendering.` Fixed by moving the header read inside `<Suspense>`.
6. **Testing mistake, caught and corrected**: one probe returned an error shell because an older `next start` (pid 41409) was still on port 3000 and the new server had died with `EADDRINUSE`; that result was discarded. After killing it, every later run checks the server log for `EADDRINUSE` and a `Ready` line before testing.
7. **Screenshots showed a blank page** although the first browser tests passed. Diagnosis: the per-host content streams inside Suspense and React reveals it after about 300–500 ms (measured: no visible text at 100 ms, 167 characters at 500 ms and after; no page errors). The first tests asserted during that window. Fixes: a visible "Loading" fallback, and tests that wait for `networkidle` and also assert the loading spinner is gone and no uncaught page errors occurred.

Steps 2–4 and 6 rebuilt or deleted `.next/` (regenerable build output); `.next/dev` was also deleted once because stale route types from the earlier dev server broke `tsc` after files moved.

### Tests added

| Command                                                                                                           | File                                                | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:http` (Vitest + Supertest; needs a running app; `APP_BASE_URL` defaults to `http://127.0.0.1:3000`) | `tests/http/not-found.http.test.ts` (11 tests)      | Store paths `/no-such-page`, `/deep/nested/missing/path`, `/admin`, `/admin/orders` → 404 + `text/html` + `<title>Page not found · Demo Store</title>` + `<h1>Page not found</h1>` + store markers and no admin markers, in the server HTML with scripts stripped; repeat request still 404; admin paths `/no-such-page`, `/orders/missing-order`, `/store` → 404 + `Page not found · Admin` + `<nav` + admin markers and no store markers; home pages 200; unknown host → plain 404; admin API on store host → 404 JSON error envelope |
| `npm run test:e2e` (Playwright 1.65.0, Chromium)                                                                  | `e2e/not-found.spec.ts` (9 tests × 2 projects = 18) | Real browser on `*.localhost`, desktop and 360 px wide: status 404, document title, visible `<h1>`, store banner / admin `navigation` landmark, other-surface text absent, loading spinner gone, **no uncaught page errors** after `networkidle`; "Back to the store" / "Back to the dashboard" links navigate to the home pages (200)                                                                                                                                                                                                  |

`npm test` (unit) stays server-free: `vitest.config.ts` excludes `tests/http/**`. `playwright.config.ts` starts `npm run start` itself when nothing is on port 3000 and reuses a running server otherwise. CI (`.github/workflows/ci.yml`) now also runs `build`, starts the app, then `test:http`, installs Chromium and runs `test:e2e`, uploading the server log and Playwright report on failure. **CI has still never run** (no commits, no remote).

### Mutation check: the tests fail without the fix

`global-not-found.tsx` removed and `globalNotFound: false`, rebuilt, served, tested, then both restored:

```
test:http → 8 failed, 3 passed   (the 3 that pass are home pages 200, unknown host, wrong-host API: unaffected by the fix)
test:e2e (desktop) → 8 failed, 1 passed   (the 1 that passes is "home pages still return 200")
```

### Visual check

Screenshots after `networkidle`, saved in `docs/evidence/wave-1/`: `store-404-desktop.png`, `admin-404-desktop.png`, `store-404-360.png`, `admin-404-360.png`. Store: header "Demo Store" + Home, "Page not found", "Back to the store", footer. Admin: dark sidenav (Admin, Dashboard), header "Page not found", "This admin page does not exist", "Back to the dashboard"; at 360 px the sidenav stacks on top. Horizontal overflow measured as `false` on all four.

### Final verification run (2026-11-07 ~09:57 UTC, Node v26.13.0)

| Check                                                                 | Command                                                                     | Result                                                                                                                                                         |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Containers                                                            | `docker compose ps`                                                         | postgres 18.6 healthy (host port 5433), elasticsearch 9.5.5 healthy; ES cluster green                                                                          |
| Redis container                                                       | `docker compose config --services`                                          | not present (design only, see below)                                                                                                                           |
| Migrations                                                            | `prisma migrate status` / `migrate diff`                                    | up to date / empty diff                                                                                                                                        |
| Seeded records                                                        | SQL                                                                         | orders 20, payments 20, products 40, variants 193, inventory_levels 348; Σ order totals = Σ payments: true; reserved = unshipped: true; negative stock rows: 0 |
| Type check                                                            | `npm run typecheck`                                                         | exit 0                                                                                                                                                         |
| Lint                                                                  | `npm run lint`                                                              | exit 0                                                                                                                                                         |
| Format                                                                | `npm run format:check`                                                      | exit 0                                                                                                                                                         |
| Unit tests                                                            | `npm test`                                                                  | exit 0, 25/25                                                                                                                                                  |
| Production build                                                      | `npx next build`                                                            | exit 0; `◐ /_not-found`, `○ /admin`, `○ /store`, `ƒ /api/health`, proxy                                                                                        |
| HTTP tests (production server, fresh; log: 0 `EADDRINUSE`, 1 `Ready`) | `npm run test:http`                                                         | exit 0, 11/11                                                                                                                                                  |
| Browser tests (same server)                                           | `npx playwright test`                                                       | exit 0, 18/18 (desktop + 360 px)                                                                                                                               |
| Health                                                                | `curl …/api/health` on both hosts                                           | 200 `{"status":"ok","checks":{"postgres":"up","elasticsearch":"up"}}`                                                                                          |
| Dev server                                                            | `npm run dev`, then `playwright --project=chromium-desktop` and `test:http` | 9/9 and 11/11; dev log has no errors                                                                                                                           |

### Redis (additional owner requirement)

Full design: **`docs/redis-design.md`**. Nothing is implemented yet: no Redis container, client, env variable or code exists. Summary:

- PostgreSQL stays the only source of truth; Redis holds disposable copies and counters, and the app must keep selling when Redis is down.
- Redis is **never** used on the inventory, order, payment, coupon, idempotency or webhook paths, not even as an extra lock. Those rely on Postgres guarded updates, unique and CHECK constraints and transactions.
- Cached, with tag invalidation driven by the Postgres outbox: category tree, product types, settings and branding, product-page static data, merchandising (Next `cacheHandlers` + `'use cache: remote'`), plus report aggregates (cache-aside with single-flight). Explicitly not cached: stock, checkout prices, carts, sessions, idempotency keys, orders and payments, OTP, search results.
- Coordination: Redis tag timestamps for cross-instance invalidation, Redis rate limits with a Postgres fallback, a Redis single-flight lock for reports (efficiency only); Postgres `SKIP LOCKED` for the outbox and a Postgres advisory lock for reindexing.
- Wave placement: **W2** infra, client, health and rate limiter; **W6** cache handler and invalidation; **W7** settings; **W8** checkout tests rerun with Redis stopped; **W10** reports; **W11** merchandising; **W14** failure drills; **W15** managed Redis.
- **Open decision for the owner** (doc §1 rule 4): health status code when Elasticsearch or Redis is down.

### Missing integration tests (precise)

| Exists now                                                                                              | Does not exist yet                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 25 unit tests (no I/O)                                                                                  | Integration tests against a real Postgres test database (plan §1: "Vitest unit + integration on a real Postgres test DB"); the `ecommerce_test` database exists but has 0 tables, and there is no setup that migrates and truncates it per test file (plan §12A) |
| 11 HTTP tests (Supertest against a running app) and 18 Playwright tests, covering routing and 404s only | Any test that writes to or reads from Postgres or Elasticsearch through the app (none possible yet: Wave 1 has no data endpoints besides `/api/health`)                                                                                                          |
| Health endpoint verified manually (200, and 503 with ES stopped)                                        | An automated test for `/api/health` up/down                                                                                                                                                                                                                      |
| Schema constraints verified manually with rolled-back SQL (Final review)                                | Automated constraint tests (they belong with the services that rely on them, from Wave 2 on)                                                                                                                                                                     |
| Seed consistency verified manually with SQL                                                             | An automated seed-invariant test                                                                                                                                                                                                                                 |

Plan: Wave 2 adds the integration test harness (migrate `ecommerce_test` in global setup, truncate per file, unique ES index prefix) together with its first DB-backed tests (auth, sessions, rate limits, address default). The health and seed-invariant checks can move into that harness then.

### Dev-only dependency advisories (13: 5 low, 8 moderate, 0 high, 0 critical)

`npm audit --omit=dev` → **0 vulnerabilities**. All 13 come from two upstream advisories in build/lint tooling that is not shipped:

| Package                                | Severity | Direct?    | Root advisory                                                                       | Pulled in by                              | npm's suggested fix                                                                                              |
| -------------------------------------- | -------- | ---------- | ----------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@mermaid-js/mermaid-cli`              | low      | direct     | via mermaid/katex                                                                   | ER diagram rendering (`npm run docs:erd`) | upgrade to 12.2.0 (major); **blocked**: `prisma-erd-generator@3.2.1` declares peer `@mermaid-js/mermaid-cli ^11` |
| `mermaid`                              | low      | transitive | via katex                                                                           | mermaid-cli                               | same                                                                                                             |
| `@mermaid-js/layout-elk`               | low      | transitive | via mermaid                                                                         | mermaid-cli                               | same                                                                                                             |
| `@mermaid-js/layout-tidy-tree`         | low      | transitive | via mermaid                                                                         | mermaid-cli                               | same                                                                                                             |
| `katex` 0.16.47                        | low      | transitive | **GHSA-238p-pmpm-9mq7**: existing prototype pollution can bypass trust restrictions | mermaid                                   | same                                                                                                             |
| `eslint-config-next`                   | moderate | direct     | via typescript-eslint                                                               | lint                                      | "15.5.29": a **downgrade** from 16.4.5 to an older major, not applied                                            |
| `typescript-eslint`                    | moderate | direct     | via @typescript-eslint/*                                                            | lint                                      | "8.36.0": a **downgrade** from 8.72.1, not applied                                                               |
| `@typescript-eslint/eslint-plugin`     | moderate | transitive | via parser/utils                                                                    | typescript-eslint                         | same                                                                                                             |
| `@typescript-eslint/parser`            | moderate | transitive | via typescript-estree                                                               | typescript-eslint                         | same                                                                                                             |
| `@typescript-eslint/type-utils`        | moderate | transitive | via typescript-estree/utils                                                         | typescript-eslint                         | same                                                                                                             |
| `@typescript-eslint/typescript-estree` | moderate | transitive | via minimatch                                                                       | typescript-eslint                         | same                                                                                                             |
| `@typescript-eslint/utils`             | moderate | transitive | via typescript-estree                                                               | typescript-eslint                         | same                                                                                                             |
| `minimatch` (7.0.0–11.0.0 range)       | moderate | transitive | **GHSA-g3hv-75wg-m249**: potential denial of service via globparts amplification    | @typescript-eslint/typescript-estree      | same                                                                                                             |

Correction to the Final review above: it said npm's suggested fixes were downgrades. That is true for the two lint packages but not for mermaid-cli, whose fix is a major **upgrade** that the ERD generator's peer range does not yet allow.

Risk: both advisories need attacker-controlled input to tooling run on a developer machine or in CI (KaTeX math in diagrams, crafted glob patterns in lint config). Neither package is in the production bundle. Re-check at Wave 14.

### Other changes in this follow-up

- New dev dependencies: `@playwright/test` 1.65.0, `supertest` 7.3.x, `@types/supertest`. Chromium headless shell downloaded to `~/Library/Caches/ms-playwright`.
- `npm install-scripts deny fsevents`: its install script is a native-build fallback; prebuilt binaries are used. Recorded in `package.json` `allowScripts`.
- `.gitignore`, `.prettierignore`, ESLint ignores: `playwright-report/`, `test-results/`.
- `README` unchanged in this follow-up.

### Still open before approval

1. `npm run db:reset`: not run. Owner decided on 2026-11-07 not to run it yet (see Owner decisions).
2. CI has never run: no commit, no GitHub remote.
3. Fresh-clone `npm ci`: not tested (nothing to clone yet).
4. `experimental.globalNotFound` is an **experimental** Next.js flag; re-check on every Next upgrade (the HTTP and Playwright tests will catch a regression).
5. **Not yet verified:** `notFound()` called from inside a real page (e.g. an unknown product slug in Wave 6). This follow-up verified unmatched URLs only. Wave 6 must test that a missing product returns 404 with server-rendered content, keeping in mind finding 1 above (a `loading.tsx` above a page that calls `notFound()` turns the 404 into a 200).
6. ✅ Redis design and health-status rule approved by the owner (see Owner decisions).
7. ✅ `AGENTS.md` inspected and kept (see Owner decisions).

## Owner decisions and final Wave 1 check (2026-11-07)

### Decisions recorded

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                 | Where it is applied                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Health check**: PostgreSQL down → 503; Elasticsearch down → 200 `degraded` while a safe fallback exists; Redis down → 200 `degraded` while the cache can be bypassed safely; report each dependency separately; never report healthy when a critical operation cannot work                                                                                             | `src/lib/health.ts`, `src/app/api/health/route.ts`, `docs/redis-design.md` §1.1, README                                                                           |
| 2   | **Redis design approved with conditions**: Postgres single source of truth; Redis for caching, TTL, rate limiting and non-critical coordination; database-backed (outbox) invalidation; no Redis locks for inventory, orders, payments or idempotency; transactions, row locks, constraints and guarded updates for critical operations; failure and recovery documented | `docs/redis-design.md`: status line, "Owner's approval conditions", §1.1, §7 (11 failure and recovery scenarios, plus the list of what is never affected)         |
| 3   | **Do not run `npm run db:reset`**; keep the existing database and seed                                                                                                                                                                                                                                                                                                   | Not run. Fingerprints below show the data is unchanged. README now names `db:deploy && db:seed` as the verified path and warns that `db:reset` drops the database |
| 4   | **AGENTS.md**: keep it if useful and free of temporary or machine-specific content                                                                                                                                                                                                                                                                                       | Kept (assessment below)                                                                                                                                           |
| 5   | Documentation                                                                                                                                                                                                                                                                                                                                                            | This section, `docs/redis-design.md`, README                                                                                                                      |
| 6   | No commit, no Wave 2 until the owner approves the final Wave 1 report                                                                                                                                                                                                                                                                                                    | Respected                                                                                                                                                         |

### Health check implementation

- `summarizeHealth()` in `src/lib/health.ts` is a pure function, with a `criticalDependencies` map (`postgres: true`, `elasticsearch: false`):
  - any critical dependency down → `unavailable` / 503
  - otherwise any dependency down → `degraded` / 200
  - otherwise `ok` / 200
- `probeWithTimeout()` turns a thrown error, a `false` result or a probe that runs past the timeout into `down`. The route uses a 2,000 ms timeout per dependency and sends `Cache-Control: no-store`.
- Response shape (changed from Wave 1's flat `"postgres": "up"`):

  ```json
  {
    "status": "degraded",
    "checks": {
      "postgres": { "status": "up", "critical": true },
      "elasticsearch": { "status": "down", "critical": false }
    }
  }
  ```

- No Redis entry yet: Redis does not exist until Wave 2, and reporting a dependency the app does not have would be misleading.
- Elasticsearch counts as non-critical only because nothing uses it in Wave 1. Wave 6 must ship and test the PostgreSQL search fallback in the same wave, or mark Elasticsearch critical (recorded in `docs/redis-design.md` §1.1).
- An earlier draft of `summarizeHealth` used two `as` casts (rule 22); they were removed before the final run.

### Health drills (production build, `next start`, confirmed started: 0 `EADDRINUSE`, 1 `Ready`)

| Scenario                                | How                                  | Response                            | HTTP    | Time                  |
| --------------------------------------- | ------------------------------------ | ----------------------------------- | ------- | --------------------- |
| A. all up                               |                                      | `ok`, both `up`                     | 200     | 0.006 s               |
| B. Elasticsearch stopped                | `docker compose stop elasticsearch`  | `degraded`, elasticsearch `down`    | **200** | 0.006 s               |
| C. Elasticsearch and Postgres stopped   | `docker compose stop postgres`       | `unavailable`, both `down`          | **503** | 0.007 s               |
| D. Postgres stopped, Elasticsearch back | `start` + `up --wait elasticsearch`  | `unavailable`, postgres `down`      | **503** | 0.046 s               |
| E. all back                             | `start` + `up --wait postgres`       | `ok` (twice), no app restart needed | 200     | 0.017 s               |
| F. Elasticsearch frozen                 | `docker compose pause elasticsearch` | `degraded`, elasticsearch `down`    | 200     | **2.010 s** (timeout) |
| G. Postgres frozen                      | `docker compose pause postgres`      | `unavailable`, postgres `down`      | 503     | **2.008 s** (timeout) |
| H. after unpause                        | `unpause`                            | `ok` (twice)                        | 200     | 0.019 s               |

After the pauses Docker briefly showed both containers `unhealthy` (their own healthchecks had failed while frozen); `docker compose up -d --wait` returned both to `healthy`.

### Database safety

A content fingerprint (row count plus an MD5 of every row, per table) was taken before this round, after the stop and pause drills, and after the final test run:

```
before:            84956ffb57af5da58ba41b5ea154611d  (46 tables, 1,625 rows)
after drills:      84956ffb57af5da58ba41b5ea154611d  IDENTICAL
after final tests: 84956ffb57af5da58ba41b5ea154611d  IDENTICAL
```

`npm run db:reset` was not run. Stopping and pausing Postgres used `docker compose stop` / `pause`, which keep the named volume.

### AGENTS.md assessment

- Content: one block managed by Next.js (`<!-- BEGIN/END:nextjs-agent-rules -->`, 679 bytes). It tells AI coding agents that this Next.js version differs from their training data and to read the bundled guides in `node_modules/next/dist/docs/` before writing code.
- No machine-specific or temporary content: no paths, hosts, dates, secrets or user names. It is byte-identical to the file `create-next-app@16.4.5` generates, so every machine produces the same file.
- Useful: yes. In this wave alone, the route-handler caching, `notFound()` streaming and multiple-root-layout 404 behaviour all differed from what an agent would assume, and the bundled docs gave the answers.
- Limitation: it is Next.js-version guidance, not project guidance. It does not mention the plan, port 5433 or the `db:reset` rule. Next only manages the text between its markers, so project notes could be added outside them later if wanted.
- Decision: **keep it and include it in the commit.** Deleting it would only make `next dev` re-create it as an untracked file.

### Final test results (2026-11-07 10:19 UTC, Node v26.13.0; no source changed after the build under test)

| Check            | Command                                  | Result                                                                                   |
| ---------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| Type check       | `npm run typecheck`                      | exit 0                                                                                   |
| Lint             | `npm run lint`                           | exit 0                                                                                   |
| Format           | `npm run format:check`                   | exit 0                                                                                   |
| Unit tests       | `npm test`                               | exit 0, **4 files, 34 tests** (25 earlier + 9 new in `src/lib/health.test.ts`)           |
| HTTP tests       | `npm run test:http`                      | exit 0, **2 files, 13 tests** (11 not-found + 2 new in `tests/http/health.http.test.ts`) |
| Browser tests    | `npx playwright test`                    | exit 0, **18 passed** (desktop + 360 px)                                                 |
| Production build | `npx next build`                         | exit 0                                                                                   |
| Containers       | `docker compose ps`                      | postgres 18.6 and elasticsearch 9.5.5 healthy                                            |
| Migrations       | `prisma migrate status` / `migrate diff` | up to date / empty                                                                       |

### Commit candidates checked

- `git status --porcelain --ignored`: ignored are `.env`, `.next/`, `next-env.d.ts`, `node_modules/`, `playwright-report/`, `src/generated/`, `test-results/`, `tsconfig.tsbuildinfo`.
- `.env.example` **is** a commit candidate (`?? .env.example`). `git check-ignore` exits 0 for it only because it matches the negation rule `!.env.example`, which un-ignores it.
- 164 files would be committed (about 2.5 MB; the largest is `docs/er-diagram.svg` at 1.5 MB, a plan deliverable). A scan for hard-coded keys, secrets or passwords found nothing.

### Outstanding risks (Wave 1)

| Risk                                                | Impact                                                                            | Mitigation / owner action                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| CI has never run                                    | Workflow problems (service images, Chromium install, server start) are unknown    | First push will show; logs and the Playwright report are uploaded on failure          |
| `npm run db:reset` unverified                       | The README quick-start command has not been executed by us                        | Owner decided not to run it; README names the verified `db:deploy && db:seed` path    |
| Fresh-clone `npm ci` untested                       | A missing file or install-script approval would surface only on a clean machine   | Test right after the first commit (clone to a temp dir, `npm ci`, run the gates)      |
| `experimental.globalNotFound`                       | Experimental flag may change in a Next.js upgrade                                 | HTTP and Playwright 404 tests fail if it regresses (proven by the mutation check)     |
| `notFound()` from inside a real page not yet tested | A future page could return 200 instead of 404 (for example under a `loading.tsx`) | Wave 6 must test unknown product slugs for 404 and server-rendered content            |
| Elasticsearch marked non-critical                   | Correct only while nothing depends on ES                                          | Wave 6 must ship and test the Postgres search fallback, or mark ES critical           |
| Redis not implemented                               | The design is approved but untested                                               | Wave 2 brings it in with the tests listed in `docs/redis-design.md` §9                |
| No DB-backed integration tests                      | Constraints and seed invariants are checked manually only                         | Wave 2 adds the integration test harness                                              |
| 13 dev-only advisories (5 low, 8 moderate)          | Build and lint tooling only; 0 in production dependencies                         | Re-check at Wave 14; mermaid-cli upgrade blocked by `prisma-erd-generator` peer range |
| Native PostgreSQL service on :5432                  | Docker Postgres must stay on host port 5433 on this machine                       | Documented in README and `.env.example`                                               |
| Seeded passwords are placeholders                   | No one can log in yet                                                             | By design until Wave 2 (bcrypt)                                                       |

### Recommended Git commit (not made, waiting for approval)

- Branch: the repo is on `master` with no commits, and the main branch is configured as `main`. Suggest `git branch -m master main`, then commit (or commit on `master` if you prefer).
- Include: every untracked, non-ignored file (`git add -A` gives exactly the 164 files above, since ignored paths are excluded).
- Exclude (already ignored): `.env`, `node_modules/`, `.next/`, `src/generated/`, `test-results/`, `playwright-report/`, `next-env.d.ts`, `tsconfig.tsbuildinfo`.
- Message (the plan says no Claude co-author or attribution lines):

```
Wave 1: foundation for two-domain e-commerce platform

- Next.js 16.4.5 app with proxy-based store/admin host routing and per-surface 404s
- PostgreSQL 18 schema (all plan tables, constraints, indexes) with init migration and idempotent seed
- Core lib: env validation, error envelope, API handler, logger, Money, branded ids, health check
- Tailwind design tokens, 19 atoms, store/admin/auth layouts
- Docker Compose (Postgres, Elasticsearch), CI workflow
- Unit, HTTP (Supertest) and browser (Playwright) tests
- Redis design (approved, not yet implemented) and implementation progress journal
```

## Wave 1 commit preparation (2026-11-07)

The owner approved Wave 1 for committing. Push is **not** done (no remote configured or verified). Wave 2 does not start until the owner approves it.

### Branch

- `git branch -m master main` failed (`error: refname refs/heads/master not found`): on a repository with no commits the branch ref does not exist yet. The unborn branch was renamed with `git symbolic-ref HEAD refs/heads/main`. `git status` → `On branch main`, `No commits yet`.
- Git on this machine is **2.15.0** (2017, `/usr/local/bin/git`), which is old (for example it has no `git branch --show-current`). It works for this repository; consider upgrading.

### Commit identity

- `user.email` is not set in any Git config scope, so Git would have generated an author address from the local user name and host name. The commit was held until the owner chose the identity to use.

### Files inspected (164 candidates)

- By type: 101 `.ts`, 37 `.tsx`, 5 dotfiles, 4 `.png`, 4 `.md`, 3 `.json`, 2 `.yml`, 2 `.sql`, 1 each of `.toml`, `.svg`, `.prisma`, `.mjs`, `.ico`, `.css`.
- No build output, test output, generated client, logs, archives, key files, OS junk or temporary scripts. Binary files: the four 404 screenshots in `docs/evidence/wave-1/` (19–25 KB each) and `src/app/favicon.ico`.
- `docs/er-diagram.svg` (1.5 MB) is generated, but it is a plan deliverable (§12B), so it is committed on purpose.
- Ignored and **not** committed: `.env`, `.next/`, `next-env.d.ts`, `node_modules/`, `playwright-report/`, `src/generated/`, `test-results/`, `tsconfig.tsbuildinfo`.

### Secrets

- No private keys, cloud/API tokens, GitHub tokens or JWTs (pattern scan over all 164 files).
- The only credential is the **local development** Postgres login `ecommerce` / `ecommerce`, used for disposable local and CI containers: in `.env.example`, `docker-compose.yml`, `.github/workflows/ci.yml`, one unit-test fixture (`src/lib/env.test.ts`) and this journal. It must never be used for a hosted database (Wave 15 uses provider-generated credentials kept in environment variables only).
- Seeded staff and customer password hashes are the literal placeholder `SEED_PLACEHOLDER_PASSWORD_HASH_REPLACED_IN_WAVE_2`.
- `.env.example` contains only: `NODE_ENV`, `LOG_LEVEL`, the local `DATABASE_URL`, `ELASTICSEARCH_URL=http://localhost:9200`, `ELASTICSEARCH_INDEX_PREFIX=dev`, `STORE_HOSTS`, `ADMIN_HOSTS`.
- The real `.env` is ignored (`.gitignore:34: .env*`; `!.env.example` on line 44 re-includes only the template) and currently holds the same values as the template.

### Local machine paths

Two lines of this journal contained the home directory (`/Users/<name>/.orbstack/...`) in recorded command output; they now use `~/.orbstack/...`. After that, a scan for home paths, user name, host name and session temp paths across all candidates found nothing. Standard macOS locations remain where they explain a decision (`/Library/PostgreSQL/18`, `/Library/LaunchDaemons/postgresql-18.plist`); they contain no user or host name.

### Security fix found during inspection: container ports were open to the local network

- Before: `docker compose ps` showed `0.0.0.0:5433->5432` and `0.0.0.0:9200->9200`. Postgres used the well-known development password, and Elasticsearch runs with security disabled, so other devices on the same network could have reached both.
- Change: `docker-compose.yml` now publishes `127.0.0.1:5433:5432` and `127.0.0.1:9200:9200`.
- Verified after `docker compose up -d --wait` recreated both containers (named volumes kept):
  - both healthy, ports shown as `127.0.0.1:…`
  - from the machine's LAN address neither 5433 nor 9200 accepts connections; `127.0.0.1:5433` does
  - Prisma (`DATABASE_URL` with `localhost:5433`), the Postgres driver adapter and the Elasticsearch client (`localhost:9200`) still connect
  - database fingerprint `84956ffb57af5da58ba41b5ea154611d` unchanged (46 tables, 1,625 rows)
- CI is unaffected: GitHub service containers are configured separately in the workflow.

### All outstanding risks (carried forward; none closed by the commit)

| #   | Risk                                                                                                | Status / next step                                                                               |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | CI has never run                                                                                    | Runs on the first push after the remote is configured and verified                               |
| 2   | `npm run db:reset` unverified                                                                       | Owner decision: do not run yet. Verified path: `db:deploy && db:seed` on an empty database       |
| 3   | Fresh-clone `npm ci` untested                                                                       | Test after the commit: clone to a temp dir, `npm ci`, run the gates                              |
| 4   | `experimental.globalNotFound` is experimental                                                       | The 404 HTTP and Playwright tests catch a regression (mutation-checked)                          |
| 5   | `notFound()` from inside a real page untested; a `loading.tsx` above it can turn the 404 into a 200 | Wave 6: test unknown product slugs for 404 with server-rendered content                          |
| 6   | Elasticsearch is non-critical in health only because nothing uses it yet                            | Wave 6: ship and test the Postgres search fallback, or mark Elasticsearch critical               |
| 7   | Redis approved but not implemented                                                                  | Wave 2 onwards, with the tests in `docs/redis-design.md` §9                                      |
| 8   | No DB-backed integration tests (the `ecommerce_test` database is empty)                             | Wave 2 adds the harness                                                                          |
| 9   | 13 dev-only advisories (5 low, 8 moderate; 0 in production dependencies)                            | Re-check at Wave 14; the mermaid-cli upgrade is blocked by the `prisma-erd-generator` peer range |
| 10  | A native PostgreSQL service owns :5432 on this machine                                              | Docker Postgres stays on host port 5433                                                          |
| 11  | Seeded passwords are placeholders                                                                   | Wave 2 (bcrypt)                                                                                  |
| 12  | Local development credentials are committed in the template and compose file                        | Development only; hosted credentials go in environment variables, never in the repo              |
| 13  | Git 2.15.0 is old                                                                                   | Upgrade recommended; no current blocker                                                          |
| 14  | Git `user.email` is not configured on this machine                                                  | Set it before the next commit (the Wave 1 commit used the identity the owner chose)              |

## Wave 1 commit, remote and first push (2026-11-07)

### Commit

- `fa6ebd63828f6d6bc653ee874adeb6c55f0ffe84` on `main`: "Wave 1: foundation for two-domain e-commerce platform", 164 files, 25,026 insertions.
- Author and committer: `molshree <149938122+molshreepandey@users.noreply.github.com>`, set in the repository's local Git config only (`git config --local user.email`); the global Git config is unchanged.
- After the commit: `nothing to commit, working tree clean`; `git fsck` clean; containers healthy; database fingerprint unchanged (`84956ffb57af5da58ba41b5ea154611d`, 46 tables, 1,625 rows).

### Remote setup and checks before pushing

- No `gh` CLI and no SSH keys (`git@github.com: Permission denied (publickey)`). That SSH test added GitHub's host key to `~/.ssh/known_hosts` (harmless side effect). The macOS Keychain holds an HTTPS GitHub login for `molshreepandey`.
- The owner created an empty **private** repository `molshreepandey/ECommerce-Platform` on github.com.
- `origin` = `https://github.com/molshreepandey/ECommerce-Platform.git` (fetch and push).
- `git ls-remote origin` → exit 0, 0 refs (empty, readable with the Keychain login).
- Anonymous checks: `git ls-remote` with the credential helper disabled → `could not read Username` (refused); web page → 404. The anonymous API check was rate-limited (`0 of 60` for the network's shared IP), so it was inconclusive and not relied on.
- `git push --dry-run origin main` → exit 0 (`[new branch]`), nothing sent, still 0 refs afterwards.

### First push attempt: rejected

```
$ git push -u origin main
 ! [remote rejected] main -> main (refusing to allow a Personal Access Token to create or update workflow `.github/workflows/ci.yml` without `workflow` scope)
```

- Nothing reached GitHub (0 refs afterwards); local `main` unchanged.
- **Verification gap:** the dry run proved general push access but not GitHub's extra check for workflow files, which only runs when objects are actually sent. Future token checks should include this permission explicitly.
- Fix, done by the owner: a new fine-grained token with **Contents: read and write** and **Workflows: read and write**, stored in the Keychain (Keychain entry modified 2026-11-07).

### Second push

```
$ git ls-remote origin            → 2 refs already present
$ git push -u origin main
Everything up-to-date
Branch 'main' set up to track remote branch 'main' from 'origin'.
```

`main` was already on GitHub when this retry ran (the remote had 2 refs before the command), so the objects were not sent by this command; Git only set up tracking. Verified what is on the remote:

| Check                                     | Result                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| Remote refs                               | `HEAD` → `refs/heads/main`; `refs/heads/main` = `fa6ebd63828f6d6bc653ee874adeb6c55f0ffe84` |
| Remote `main` = local `main` = `fa6ebd6…` | ✅ match (`git fetch`, `git rev-parse`)                                                    |
| Commits on `origin/main`                  | 1                                                                                          |
| Ahead/behind                              | 0 / 0; `Your branch is up to date with 'origin/main'`                                      |
| Visibility (GitHub API, authenticated)    | `private: true`, `visibility: "private"`, `default_branch: "main"`                         |
| Anonymous access                          | Git refused; web page 404                                                                  |

### CI (GitHub Actions): NOT verified

Every read path for CI results returned **403 "Resource not accessible by personal access token"**: `/actions/runs`, `/actions/workflows`, `/actions/permissions`, `/commits/{sha}/check-runs`, `/commits/{sha}/check-suites`, `/commits/{sha}/status`. The token has Contents and Workflows permissions but not **Actions: read**, so from this machine it is unknown whether the push triggered a CI run and whether it passed. **CI is still unverified.**

To verify, either give the fine-grained token **Actions: read-only** (the token value stays the same, so the Keychain needs no change), or check github.com/molshreepandey/ECommerce-Platform/actions and report the run's status and failing step.

A testing mistake on the way: one probe script named a shell loop variable `path`, which in zsh overwrites `PATH`, so `curl` and `python3` "were not found". The script was rerun with a different variable name; the 403 results above come from that rerun.

### Database

Not modified. No `db:reset`, no migrations, no seed runs in this step.

### Outstanding risks (updated)

| #   | Risk                                                                      | Status                                                                                                                                             |
| --- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | CI has never been observed running                                        | **Open.** The push succeeded, but the CI result cannot be read with the current token (needs Actions: read)                                        |
| 2   | `npm run db:reset` unverified                                             | Open, by owner decision                                                                                                                            |
| 3   | Fresh-clone `npm ci` untested                                             | Open. Now possible: clone from `origin` into a temp directory                                                                                      |
| 4   | `experimental.globalNotFound`                                             | Open; guarded by the 404 tests                                                                                                                     |
| 5   | `notFound()` inside a real page untested                                  | Open; Wave 6                                                                                                                                       |
| 6   | Elasticsearch non-critical only until the Postgres search fallback exists | Open; Wave 6                                                                                                                                       |
| 7   | Redis approved, not implemented                                           | Open; Wave 2 onwards                                                                                                                               |
| 8   | No DB-backed integration tests                                            | Open; Wave 2                                                                                                                                       |
| 9   | 13 dev-only advisories                                                    | Open; Wave 14                                                                                                                                      |
| 10  | Native Postgres on :5432                                                  | Mitigated (Docker Postgres on 127.0.0.1:5433)                                                                                                      |
| 11  | Seeded passwords are placeholders                                         | Open; Wave 2                                                                                                                                       |
| 12  | Local development credentials in the template and compose file            | Accepted for development; never for hosted databases                                                                                               |
| 13  | Git 2.15.0 is old                                                         | Open; upgrade recommended                                                                                                                          |
| 14  | Git `user.email` not configured                                           | **Resolved for this repository** (repo-local no-reply address); global email still unset                                                           |
| 15  | Token permissions                                                         | New. The Keychain token cannot read Actions results; any token used here must include Workflows (write) for pushes that touch `.github/workflows/` |

## Housekeeping before Wave 2 (2026-11-07)

| Step                                                          | Result                                                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Push `d7e3a0e`                                                | ✅ `fa6ebd6..d7e3a0e main -> main`; remote `main` = `d7e3a0e`; 0 ahead / 0 behind                                          |
| Verify GitHub Actions                                         | ❌ still blocked: `GET /actions/runs` → 403 "Resource not accessible by personal access token" (token lacks Actions: read) |
| Fresh-clone test (cloned from GitHub; dev database untouched) | ✅ with one bug found (below)                                                                                              |

Fresh-clone details:

- The clone's `HEAD` and tree were identical to local `d7e3a0e` (164 files).
- Docker Compose was **not** run from the clone: the fixed project name `ecommerce-platform` would have made Docker recreate the running containers.
- The clone used a throwaway database `ecommerce_freshclone_check`, which was dropped afterwards.
- **Bug:** following the README, `npm run db:seed` failed with `ERR_MODULE_NOT_FOUND … src/generated/prisma/client`, because nothing generated the Prisma client (CI only worked because it ran `db:generate` explicitly). **Fixed in Wave 2A item 1.**
- With `db:generate` added, everything passed in the clone:
  - `db:deploy`; `db:seed` twice
  - typecheck, lint, format; 34 unit tests; build
  - 13 HTTP and 18 browser tests against the clone's own server; health 200
- Seed reproducibility: row counts were identical to the dev database (1,625). With timestamp and UUID columns excluded, all 45 data tables had identical content.
  - An earlier claim that the differences were "only timestamps" was wrong and was corrected by that check.
- **Mistake caught during the test:** the first `npm ci` in the clone ran under Node 20 because `nvm use` had been piped into a subshell. That run was discarded and redone under Node 26.13.0. It exposed that nothing enforced the Node version (**fixed in Wave 2A item 1**).
- Dev database fingerprint before and after the test: `84956ffb57af5da58ba41b5ea154611d` (identical).

## Owner decisions for Wave 2A (2026-11-07)

1. Wave 2A approved, together with the Razorpay Test Mode + simulator architecture for Wave 8B.
2. Configuration must separate build-time from runtime, so staging and production change settings without a rebuild (TD-002).
3. Redis pinned to an exact tested version (TD-003).
4. The integration-test database guard must be strict and run before migrations, truncation and cleanup (TD-005).
5. Local Razorpay webhook testing must be isolated (TD-008).
6. Argon2id for Wave 2B, subject to compatibility and performance tests (TD-009).
7. The requirements matrix is kept in `docs/REQUIREMENTS_TRACEABILITY.md`.
8. No destructive database operations, commits or pushes without approval.

## Wave 2A: platform groundwork (2026-11-07, complete, awaiting owner approval)

### What was built, by work item

| #   | Item                                 | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fresh-clone fix and Node enforcement | `postinstall: prisma generate`; `.npmrc` `engine-strict=true`; README setup uses `db:deploy` + `db:seed` and warns about the shared Compose project name. Verified in a scratch copy: Node 26 `npm ci` generates the client; Node 20 `npm ci` is refused with `EBADENGINE` before installing                                                                                                                                                                                                                                                        |
| 2   | Runtime configuration                | `config/config.{development,test,staging,production}.json`; `src/lib/config/` (Zod schema with strict objects, loader, `getConfig()`); `src/lib/env.ts` reduced to `APP_ENV`, `APP_CONFIG_PATH`, `DATABASE_URL`, `ELASTICSEARCH_URL`, `REDIS_URL`; `outputFileTracingIncludes` for `config/*.json`; startup validation through `src/instrumentation.ts` → `instrumentation-node.ts` (exits with code 1 when invalid). Hard-coded values moved: hosts, log level, Elasticsearch prefix/timeout/retries, health probe timeout, database pool settings |
| 3   | Redis                                | `redis:8.10.3@sha256:1f88291b…` in Compose (localhost only, no persistence, 128 MB, `volatile-lru`); `redis@6.3.1` exact; `src/lib/redis.ts` with app-level reply deadline, stuck-client discard and 5 s circuit-breaker cooldown; Redis in `/api/health` as non-critical                                                                                                                                                                                                                                                                           |
| 4   | Rate limiter                         | `src/lib/rate-limit/`: fixed windows; SHA-256-hashed identifiers; Redis Lua store; Postgres `INSERT … ON CONFLICT … RETURNING` store; fallback with throttled logging; fails closed if both stores fail; `RateLimitExceededError` → 429 + `Retry-After` (through a new `DomainError.responseHeaders()` hook)                                                                                                                                                                                                                                        |
| 5   | Integration harness                  | `tests/support/test-target-guard.ts` (URL and `current_database()` checks; Redis prefix check); `tests/support/test-database-setup.ts`; `vitest.integration.config.ts`; `npm run test:integration`                                                                                                                                                                                                                                                                                                                                                  |
| 6   | First integration tests              | `test-harness`, `database-constraints`, `rate-limit`, `rate-limit-redis-down` (18 tests)                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 7   | Security headers and origin check    | Runtime CSP/HSTS from config set in `src/proxy.ts` (unknown hosts get `default-src 'none'`); build-time invariant headers in `next.config.ts`; same-origin check for `POST`/`PUT`/`PATCH`/`DELETE` in `apiHandler`                                                                                                                                                                                                                                                                                                                                  |
| 8   | Test plumbing                        | `tests/support/test-app.ts` (URLs from `config.test.json`); `scripts/start-test-server.ts` (`npm run start:test`: guard, create and migrate test DB, start the built app with `APP_ENV=test` on port 3100); Playwright and HTTP tests read URLs from config; browser tests fail on CSP violations                                                                                                                                                                                                                                                   |
| 9   | CI                                   | Redis service (same pinned digest); new env variables; `npm ci` now generates the client itself; drift check `prisma migrate diff --from-config-datasource --to-schema … --exit-code`; integration tests; `start:test`; HTTP and browser tests                                                                                                                                                                                                                                                                                                      |
| 10  | Docs                                 | New: `docs/TECHNICAL_DECISIONS.md` (TD-001…010), `ARCHITECTURE.md`, `TESTING_STRATEGY.md`, `DEPLOYMENT_GUIDE.md`, `API_DOCUMENTATION.md`, `DATABASE_DESIGN.md`, `REQUIREMENTS_TRACEABILITY.md`, `walkthroughs/wave-2a.md`. Updated: `docs/redis-design.md` (pinned version, client findings), README                                                                                                                                                                                                                                                |

### Bugs and surprises found during Wave 2A, all fixed and verified

| Finding                                                                                | Evidence                                                                                                                     | Fix                                                                                                                                        |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Fresh clone could not seed (no Prisma client)                                          | `ERR_MODULE_NOT_FOUND` in the clone                                                                                          | `postinstall` generate; verified by `npm ci` in a scratch copy                                                                             |
| Wrong Node version only produced warnings                                              | `EBADENGINE` warnings under Node 20                                                                                          | `.npmrc` `engine-strict=true`; Node 20 install now refused                                                                                 |
| Build warned "Node.js API … not supported in the Edge Runtime" (3 warnings)            | Next compiles instrumentation for Edge too                                                                                   | Node-only startup code behind `NEXT_RUNTIME === 'nodejs'` dynamic import; build has 0 warnings                                             |
| Invalid config left the server running and answering 500                               | `next start` stayed up; requests returned 500                                                                                | `process.exit(1)` on invalid config; verified exit code 1 and nothing listening                                                            |
| node-redis command timeouts did not cancel a reply from a frozen Redis                 | `commandOptions.timeout`, per-call timeout and `AbortSignal` all still pending after 4 s; health took 2.01 s (probe timeout) | app-level deadline in `runRedisCommand`; frozen Redis now costs ~0.5 s                                                                     |
| `socket.socketTimeout` also dropped idle connections                                   | 5 reconnects in 3 idle seconds                                                                                               | not used; idle check with the final client: no reconnects                                                                                  |
| Every request waited 500 ms during a Redis outage; one stack-trace warning per request | 6 rate-limit calls took 2,281 ms; 6 warnings                                                                                 | 5 s circuit-breaker cooldown and throttled fallback log: 745 ms for 6 calls, 2 log lines                                                   |
| Browser tests against a **cold** `next dev` time out in a reload loop                  | 9/9 failed; 0 CSP violations recorded; HMR connected                                                                         | not a code bug: a warm dev server passed 9/9 twice with CSP checks. Documented as a limitation; CI and `test:e2e` use the production build |

### Mistakes made and corrected during Wave 2A (process)

- `nvm install 20` was run instead of `nvm use 20` during the engine test. It installed Node 20.20.2 and moved the default nvm alias. It was uninstalled at once; the default is back to v20.19.6.
- `timeout` does not exist on macOS, so the first "invalid config makes start exit" check never ran (exit code 127). It was rerun correctly: exit code 1.
- Prettier was given `.env.example`, failed, and stopped a chained command before tests ran. It was rerun without that file.

### Test results (final regression, 2026-11-07 13:18 UTC, Node v26.13.0)

| Check                                           | Command                             | Result                                                                                                                |
| ----------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Format                                          | `npm run format:check`              | exit 0                                                                                                                |
| Lint                                            | `npm run lint` (`--max-warnings 0`) | exit 0                                                                                                                |
| Type check                                      | `npm run typecheck`                 | exit 0                                                                                                                |
| Unit                                            | `npm test`                          | **99 / 99** (9 files)                                                                                                 |
| Integration (real Postgres test DB + Redis)     | `npm run test:integration`          | **18 / 18** (4 files)                                                                                                 |
| Build (`.next` deleted first)                   | `npx next build`                    | exit 0, **0 warnings**                                                                                                |
| Browser (Playwright starts `start:test` itself) | `npm run test:e2e`                  | **18 / 18** (desktop + 360 px, no CSP violations, no page errors)                                                     |
| HTTP                                            | `npm run test:http`                 | **19 / 19**                                                                                                           |
| Dev-config server                               | `npm run start`                     | health 200 `ok` on both hosts (Postgres, Elasticsearch, Redis up); pages 200; 404 correct; 5 security headers present |
| Containers                                      | `docker compose ps`                 | postgres 18.6, elasticsearch 9.5.5, redis 8.10.3 (digest): all healthy, all on `127.0.0.1`                            |

Integration evidence highlights:

- 20 parallel guarded reservations against 7 units → exactly 7 reserved, 13 refused, available = 0.
- 50 parallel rate-limit calls with a limit of 5 → exactly 5 allowed, with Redis and with Postgres alone. Postgres stored one row with `request_count = 50`; no raw identifiers in keys or rows.
- Redis unreachable (real connection to a closed port) → Postgres enforced the limit; 6 calls in 745 ms.
- The harness refused to truncate when `DATABASE_URL` pointed at the dev database, before any SQL ran.

Earlier item-level checks:

- Same build started with two runtime configs (store host switched with no rebuild; `BUILD_ID` unchanged).
- Redis stop, pause and recovery drills on health: 200 `degraded`; ~0.5 s when frozen; recovered without restart.

### Database verification

- Dev database fingerprint at the start of Wave 2A: `84956ffb57af5da58ba41b5ea154611d` (46 tables, 1,625 rows).
- At the end: **identical** (every table's row count and content hash).
- No `db:reset`, no migration applied to the dev database, no seed run against it.
- `ecommerce_test` now holds the migrated schema (46 tables) and is emptied by the tests.
- No Redis keys left over.

### Known limitations after Wave 2A

1. **CI not observed:** the token cannot read Actions results. The workflow is checked structurally, and every command in it was run locally.
2. **Origin check not exercised over HTTP:** it is unit-tested (13 cases), but no state-changing endpoint exists yet. A `POST` to `/api/health` gets 405 from Next.js before the check runs. Wave 2B must add HTTP tests for 403 `ORIGIN_NOT_ALLOWED`.
3. **Rate limiter not wired to any endpoint yet** (Wave 2B: login and register).
4. **Rate-limit window boundary:** a fixed window allows up to 2× the limit across a window boundary. Old Postgres counter rows are not cleaned up yet.
5. **CSP strength:** `script-src` keeps `'unsafe-inline'` (no nonces, because of Partial Prerendering).
6. **Cold dev server:** browser tests against a cold `next dev` time out; use `npm run test:e2e` (production build) or warm the dev server first.
7. **Redis cooldown:** for up to 5 s after a Redis failure, Redis is skipped even if it has recovered.
8. **Hosted config placeholders:** staging and production config files use `example.com` placeholder hosts until Wave 15.
9. **Webhook isolation not built yet:** the isolated local webhook routing (`webhookHosts`) is designed (TD-008) but built in Wave 8B.

### Outstanding risks (updated after Wave 2A)

| #   | Risk                                                                      | Status                                                                                                    |
| --- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | CI never observed                                                         | Open (token needs Actions: read)                                                                          |
| 2   | `npm run db:reset` unverified                                             | Open, by owner decision                                                                                   |
| 3   | Fresh-clone install                                                       | **Resolved**: tested, bug fixed, Node pinned                                                              |
| 4   | `experimental.globalNotFound`                                             | Open; guarded by tests                                                                                    |
| 5   | `notFound()` inside a real page                                           | Open; Wave 6                                                                                              |
| 6   | Elasticsearch non-critical only until the Postgres search fallback exists | Open; Wave 6                                                                                              |
| 7   | Redis approved, not implemented                                           | **Resolved for infrastructure** (client, health, rate limiter); caching is still to come (Waves 6, 7, 10) |
| 8   | No DB-backed integration tests                                            | **Resolved**: harness + 18 tests                                                                          |
| 9   | 13 dev-only advisories                                                    | Open; Wave 14 (re-check: `npm audit --omit=dev` still 0)                                                  |
| 10  | Native Postgres on :5432                                                  | Mitigated                                                                                                 |
| 11  | Seeded passwords are placeholders                                         | Open; Wave 2B                                                                                             |
| 12  | Local development credentials in template and compose file                | Accepted for development                                                                                  |
| 13  | Git 2.15.0 is old                                                         | Open                                                                                                      |
| 14  | Git `user.email`                                                          | Resolved for this repository                                                                              |
| 15  | Token cannot read Actions                                                 | Open                                                                                                      |
| 16  | Origin check not exercised over HTTP                                      | New; Wave 2B                                                                                              |
| 17  | node-redis timeout behaviour                                              | Mitigated by the app-level deadline; re-check on any client upgrade                                       |

## Wave 2A approval and CI status (2026-11-07)

- **Owner approved** the Wave 2A final checks and a local commit; **no push**.
- **CI, reported by the owner:** the GitHub Actions page shows two workflow runs with green marks.
- **CI, checked by the agent:** not possible. `GET /actions/runs`, `/commits/d7e3a0e…/check-runs` and `/commits/d7e3a0e…/status` all return 403 "Resource not accessible by personal access token" (the token still lacks Actions: read).
- **What the green runs can and cannot cover:** only `fa6ebd6` and `d7e3a0e` have ever been pushed, so they must be runs for those commits, using the **Wave 1 workflow** (no Redis service, no integration tests, no `start:test`). Each run's short SHA is visible in the Actions UI to confirm.
- **Wave 2A has not been tested by CI.** It is committed locally only; its new workflow first runs on the next approved push.

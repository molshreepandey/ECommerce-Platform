# Implementation Progress

Spec: `~/Downloads/ECOMMERCE_PLATFORM_PLAN.md` (read-only). Waves follow plan section 12.

## Waves

Current status (updated 2026-11-15). The dated headings of the journal entries below record the status when
each entry was written; this list is the current status.

- [x] Wave 1 — Foundation (approved by the owner on 2026-11-07; commit `fa6ebd6`, push record `d7e3a0e`; on GitHub (private))
- [x] Wave 2A — Platform groundwork (approved by the owner on 2026-11-07; commits `6863ad2`, `6d60892`; pushed to GitHub on 2026-11-10)
- [x] Wave 2B — Identity, access, audit (commit `f2c40ab`; pushed to GitHub on 2026-11-10)
- [x] Wave 3 — Modular catalogue (commits `24563ed`, `8b8ad00`, `800dd41`; pushed to GitHub on 2026-11-10)
- [x] Wave 4 — Category tree, tagging, product groups (commit `e0c3895`; pushed to GitHub on 2026-11-10)
- [x] Wave 5 — Warehouses and inventory (commits `f6c018b` … `9953124`, pushed 2026-11-10 to 2026-11-12).
- [x] Waves 6–10 (P0) — storefront, cart, checkout, fulfilment, customers and reports.
- [x] Waves 11–13 (P1) — merchandising, post-purchase and operations, admin power tools.
- [x] Wave 14 — hardening (test evidence, EXPLAIN review, rules and UI pass, security fixes TD-031 to TD-033).
      Not done: an acceptance run after `db:reset` on the development database (owner excluded it; the
      same sequence was rehearsed on a disposable database instead).
- [x] Wave 15 — documentation (README, OpenAPI + Swagger UI, ER diagram, technical report, test evidence,
      demo script, deployment guide). Not done: hosted deployment (blockers in `docs/DEPLOYMENT_GUIDE.md`)
      and the video (recorded by the owner).
- [x] Wave 16 (P2) — search autocomplete, notification log, nearest-PIN allocation (TD-030).
- Waves 6–16 committed as `29b9e64` and pushed on 2026-11-15 (fast-forward from `9953124`); E2E fix
  `d144a2f` pushed the same day. GitHub Actions: passing on `d144a2f` as reported by the owner (the
  local token cannot read Actions results, L11). Runs #4–#10 failed (lint before `next typegen`, fixed in
  `29b9e64`; a racy E2E assertion, fixed in `d144a2f`).
- Development database: still 5 migrations (fingerprint `9cec751c29cab1faab002a9308e23887`); it needs
  `20261114090000` and `20261114180000` before the current code runs against it
  (`docs/migrations/dev-migration-checklist.md`). The test database has all 7.

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

| Finding                                                                                | Evidence                                                                                                                     | Fix                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh clone could not seed (no Prisma client)                                          | `ERR_MODULE_NOT_FOUND` in the clone                                                                                          | `postinstall` generate; verified by `npm ci` in a scratch copy                                                                                                                                          |
| Wrong Node version only produced warnings                                              | `EBADENGINE` warnings under Node 20                                                                                          | `.npmrc` `engine-strict=true`; Node 20 install now refused                                                                                                                                              |
| Build warned "Node.js API … not supported in the Edge Runtime" (3 warnings)            | Next compiles instrumentation for Edge too                                                                                   | Node-only startup code behind `NEXT_RUNTIME === 'nodejs'` dynamic import; build has 0 warnings                                                                                                          |
| Invalid config left the server running and answering 500                               | `next start` stayed up; requests returned 500                                                                                | `process.exit(1)` on invalid config; verified exit code 1 and nothing listening                                                                                                                         |
| node-redis command timeouts did not cancel a reply from a frozen Redis                 | `commandOptions.timeout`, per-call timeout and `AbortSignal` all still pending after 4 s; health took 2.01 s (probe timeout) | app-level deadline in `runRedisCommand`; frozen Redis now costs ~0.5 s                                                                                                                                  |
| `socket.socketTimeout` also dropped idle connections                                   | 5 reconnects in 3 idle seconds                                                                                               | not used; idle check with the final client: no reconnects                                                                                                                                               |
| Every request waited 500 ms during a Redis outage; one stack-trace warning per request | 6 rate-limit calls took 2,281 ms; 6 warnings                                                                                 | 5 s circuit-breaker cooldown and throttled fallback log: 745 ms for 6 calls, 2 log lines                                                                                                                |
| Browser tests against `next dev` timed out in a reload loop (one run)                  | 9/9 failed; 0 CSP violations recorded; HMR connected                                                                         | **Corrected in the verification addendum below:** the "cold compile" explanation was disproven; the failure did not reproduce in 4 later runs on a truly cold dev server, and its root cause is unknown |

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
6. **Dev-server browser run (unexplained, not reproducible):** one run of the browser tests against `next dev` timed out in a reload loop; 4 later runs on a truly cold dev server passed. The root cause is unknown (see the verification addendum). The browser tests that gate CI and `npm run test:e2e` use the production build, which passed every run.
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

## Wave 2A verification addendum (2026-11-07, owner conditions 1–6)

The Wave 2A commit `6863ad24d95b95b47b1083b79ad13da589be39b2` already existed when these conditions arrived. It was created under the owner's previous instruction to commit locally. The conditions were therefore checked against that commit, and the corrections below are committed separately, so `6863ad2` is not rewritten. Nothing was pushed.

### 1. Exact file counts (correction)

- `git diff --name-status d7e3a0e 6863ad2`: **72 files = 27 modified + 45 added + 0 deleted**, no renames; 3,412 insertions, 175 deletions.
- The earlier report said "51 paths". That was the number of lines in `git status --short`, which shows each new directory as one line. 8 new directories holding 29 files appeared as 8 lines: 27 + (45 − 29 + 8) = 51 lines, versus 72 files.

### 2. No Wave 1 functionality or data lost

- `prisma/` (schema, migrations, seed) is unchanged since `fa6ebd6`.
- No files deleted.
- Wave 1 tests:
  - `host-routing.test.ts`, `money.test.ts` and `tests/http/not-found.http.test.ts` are unchanged.
  - The two removed browser assertions (home pages 200) were replaced by a stronger loop: 200 + no page errors + no CSP violations.
  - **Lost coverage found and restored:** when hosts and log level moved from env vars to config, the Wave 1 tests "empty host list rejected" and "unknown log level rejected" had no equivalent. Both are now in `src/lib/config/load-config.test.ts`.
- The Wave 1 seed still works with the Wave 2A code:
  - it ran against the guarded test database;
  - row counts matched the dev database in all 46 tables (1,625 rows);
  - content was identical in all 45 data tables once timestamps and UUIDs are excluded.
- Wave 1 behaviour on the development-config server:
  - health 200;
  - store and admin home pages 200;
  - wrong-host page and APIs 404; unknown host 404;
  - both custom 404 pages.
- Dev database fingerprint: **`84956ffb57af5da58ba41b5ea154611d`**, identical at the Wave 1 baseline, the Wave 2A start and now (46 tables, 1,625 rows).

### 3. Browser test results and the dev-server timeouts (correction)

- **Production build, exact result** (`npm run test:e2e`, Playwright starts `start:test` itself): **18 passed, 0 failed, 0 flaky, 0 skipped**. That is 9 tests × 2 projects (desktop and 360 px), every test asserting no page errors; the home-page test also asserts no CSP violations.
- **Dev server: the earlier explanation was wrong.** The journal and `docs/TESTING_STRATEGY.md` said "first-time page compiles on a cold dev server trigger reloads and tests time out". Re-tested with the dev cache deleted (truly cold):

  | Run                       | Result            |
  | ------------------------- | ----------------- |
  | cold, 1 worker            | 9 passed (11.6 s) |
  | cold, 4 workers           | 9 passed (6.3 s)  |
  | cold, 4 workers, repeat 2 | 9 passed (6.6 s)  |
  | cold, 4 workers, repeat 3 | 9 passed (6.1 s)  |

- The original failing run's server log shows pages served in about 200 ms (not compile-bound) and requested repeatedly, which is a reload loop.
- A second hypothesis (Playwright writing artifacts into `test-results/` inside the project triggers dev reloads) was tested directly: writes into `test-results/` and `playwright-report/` triggered **0** reloads.
- Measured fact: each page compiled for the first time reloads **once** about 20 ms after hot reload connects, then stays stable.
- **Conclusion:** one dev-mode run failed; the failure is not reproducible and its root cause is unknown. Both earlier statements were corrected in place. CI and `npm run test:e2e` use the production build.

### 4. Limitations still recorded

- Fixed-window rate limiting: up to 2× the limit across a window boundary; old Postgres counter rows not cleaned up (TD-004, limitation 4).
- Redis cool-off: up to 5 s skipped after a failure (TD-003, limitation 7).
- CSP keeps `'unsafe-inline'` for scripts (TD-006, limitation 5).
- Origin check not yet exercised over HTTP (limitation 2).
- CI not observed (limitation 1).

### 5. Final regression (2026-11-07 13:39 UTC, working tree = `6863ad2` + the corrections above)

| Check                                       | Result                                                                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check`                      | exit 1 on the first run: a journal table row edited during this verification was not re-formatted. Fixed with Prettier, rerun → exit 0 |
| `npm run lint` / `npm run typecheck`        | exit 0 / exit 0                                                                                                                        |
| `npm test`                                  | **101 / 101** (99 + 2 restored Wave 1 checks)                                                                                          |
| `npm run test:integration`                  | **18 / 18**                                                                                                                            |
| `npx next build` (`.next` deleted first)    | exit 0, 0 warnings                                                                                                                     |
| `npm run test:e2e` (production test server) | **18 / 18**                                                                                                                            |
| `npm run test:http`                         | **19 / 19**                                                                                                                            |
| Development-config server                   | health 200 `ok` (Postgres, Elasticsearch, Redis up); routing and 404 matrix as in Wave 1                                               |
| Dev database                                | identical to the Wave 2A start and the Wave 1 baseline                                                                                 |
| Redis                                       | 0 leftover keys                                                                                                                        |
| Containers                                  | postgres 18.6, elasticsearch 9.5.5, redis 8.10.3: healthy, localhost only                                                              |

## Wave 2B Step 0: Argon2id compatibility and performance gate (2026-11-07, passed and approved)

- **Setup:**
  - Isolated scratch project (the repository was not touched).
  - `@node-rs/argon2@2.2.2` pinned exactly; Argon2id, memory 19,456 KiB, 2 iterations, parallelism 1.
  - Owner criterion: verify p95 ≤ 250 ms on the owner's Mac, from at least 50 measurements.
- **Machine:** Apple M2 (4 performance + 4 efficiency cores), 8 GiB, macOS 27.0.1, Node v26.13.0, on AC power, **Low Power Mode on** (so these timings are pessimistic).
- **Results** (full table in `docs/TECHNICAL_DECISIONS.md` TD-009):
  - **macOS arm64:** verify p95 8.7 / 17.8 / 8.7 ms over three runs of 50 → **passes** (worst 17.8 ms).
  - Linux arm64 (native container): verify p95 11.8 ms.
  - Linux x64 (`node:26.13.0` amd64 container, emulated): installs the `linux-x64-gnu` binding and runs correctly; verify p95 23.4 ms. This proves compatibility only, not speed.
  - 10 concurrent logins on the Mac: per-login p95 about 40 ms; async event-loop gap p99 ≤ 2.7 ms; peak memory +61 MiB.
  - Correctness checks pass on every platform; no install scripts anywhere.
- **Measurement correction:** the first event-loop instrument (`monitorEventLoopDelay`) could not detect a known 44 ms block, so its numbers were discarded and replaced by a validated 1 ms timer-gap measurement.
- **Side effects on the machine:** the `node:26.13.0` Docker image (amd64 and arm64, about 1 GB); scratch results kept outside the repository.

## Wave 2B Step 1: dependency and identity-constraints migration on the test database (2026-11-07, awaiting owner approval)

Approved scope: add the dependency, create the additive migration, apply it to `ecommerce_test` **only**, test it, and record the Argon2id results. Not done, by instruction: no change to the development database, no seed run, no demo password change, no other Wave 2B code, no commit or push.

### Changes

| File                                                                  | Change                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`, `package-lock.json`                                   | `@node-rs/argon2` `2.2.2` (exact). Native binding `argon2-darwin-arm64`; no install scripts; `npm audit --omit=dev` 0 vulnerabilities                                                                                                                                                                                     |
| `prisma/schema.prisma`                                                | `@@index([expiresAt])` on `Session` (one line)                                                                                                                                                                                                                                                                            |
| `prisma/migrations/20261107150000_identity_constraints/migration.sql` | new, additive only: `CREATE INDEX sessions_expires_at_idx`; CHECK `customers_email_lowercase_check`, `staff_users_email_lowercase_check`, `customers_phone_format_check` (`^[6-9][0-9]{9}$`), `customer_addresses_phone_format_check`. A scan found no `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`, `ALTER COLUMN` or `RENAME` |
| `tests/integration/identity-constraints.test.ts`                      | new: 14 tests                                                                                                                                                                                                                                                                                                             |
| `docs/TECHNICAL_DECISIONS.md`                                         | TD-009 rewritten with the benchmark results                                                                                                                                                                                                                                                                               |
| `docs/REQUIREMENTS_TRACEABILITY.md`                                   | R1, R2 updated                                                                                                                                                                                                                                                                                                            |

- The index SQL was generated by `prisma migrate diff` against **the test database**, with the URL overridden and checked to end with `_test`. The CHECK constraints are hand-written (Prisma cannot express them).
- Read-only check before writing the migration: the development data has 0 rows violating any of the new constraints.

### Migration result

```
guard passed: target is a _test database distinct from development
$ DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy
Datasource "db": PostgreSQL database "ecommerce_test", schema "public" at "localhost:5433"
2 migrations found in prisma/migrations
Applying migration `20261107150000_identity_constraints`
All migrations have been successfully applied.          (exit 0)
$ (test DB) npx prisma migrate status   → Database schema is up to date!
$ (dev DB)  npx prisma migrate status   → Following migration have not yet been applied: 20261107150000_identity_constraints
$ (test DB) npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code   → exit 0 (no drift)
```

| Database          | Before                             | After                               | Objects added                                                                 |
| ----------------- | ---------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| `ecommerce_test`  | 32 CHECK, 133 indexes, 1 migration | 36 CHECK, 134 indexes, 2 migrations | exactly the 4 constraints, `sessions_expires_at_idx` and the migration record |
| `ecommerce` (dev) | 32 CHECK, 133 indexes, 1 migration | **unchanged**                       | none                                                                          |

### Tests

| Check                                                                              | Result                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:integration`                                                         | **32 / 32** (18 existing + 14 new). The new tests cover: migration recorded and index present; lower-case emails accepted and mixed case rejected for customers and staff; phones with `+91`, spaces, 9 or 11 digits, a leading 5 or letters rejected; valid 6–9 starting numbers accepted; the same rule on addresses |
| `npm test`                                                                         | **101 / 101**                                                                                                                                                                                                                                                                                                          |
| `npm run lint`, `npm run typecheck`, `npm run format:check`, `npx prisma validate` | all pass                                                                                                                                                                                                                                                                                                               |

### Pending owner approvals at the end of Step 1

Items 1–3 were approved on 2026-11-07 and are recorded below (Steps A, B and C). Committing and pushing are
still not approved.

1. Apply `20261107150000_identity_constraints` to the development database (`npm run db:deploy`).
2. Re-run the development seed with Argon2id hashes of the demo password (changes `password_hash` on 8 rows).
3. The remaining Wave 2B implementation.
4. Committing these Step 1 changes; pushing.

## Wave 2B Steps A and B: development database migration and demo password hashes (2026-11-07, done)

Owner conditions: preserve all existing data; no destructive operation; demo password for development only.

### Step A: `npm run db:deploy` on the development database

| Check                                          | Before                                        | After                                                                          |
| ---------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------ |
| Data fingerprint (46 tables, row counts + md5) | `84956ffb57af5da58ba41b5ea154611d`, 1625 rows | `452f5293880ecbb5767c41477d69cf05`, 1626 rows                                  |
| Tables whose content changed                   |                                               | `_prisma_migrations` only (1 → 2 rows)                                         |
| Schema objects                                 | 32 CHECK, 133 indexes                         | 36 CHECK, 134 indexes: exactly the 4 constraints and `sessions_expires_at_idx` |
| `prisma migrate diff` against the schema       |                                               | exit 0 (no drift)                                                              |

### Step B: `npm run db:seed:demo-passwords` (development)

A full re-seed was **not** used. A rehearsal on the test database showed a second full seed run changes
`updated_at` in 25 tables. A targeted script was written instead (TD-013), which updates only
`password_hash` with raw SQL and skips hashes that already verify.

- Rehearsal on `ecommerce_test` first:
  - the production refusal throws;
  - run 1 updated 8 rows, and with `password_hash` excluded every table was identical;
  - run 2 updated 0 rows (byte-identical database).
- Development run: `Demo password hashes: 8 updated, 0 already current, 0 missing.`

| Check                                   | Result                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Fingerprint                             | `452f5293…` → `3a6b72f9d53ed06b19f3f136d24b84a6`, 1626 rows (unchanged count)                            |
| Tables whose content changed            | `customers`, `staff_users`                                                                               |
| With `password_hash` excluded           | all 46 tables identical                                                                                  |
| Combined A + B versus the Wave 2B start | only `_prisma_migrations`, `customers`, `staff_users` changed                                            |
| Every account                           | 8 / 8 hashes start `$argon2id$v=19$m=19456,t=2,p=1$`; `DemoPass!2026` verifies, `DemoPass!2025` does not |

## Wave 2B: accounts, sessions, roles, addresses, audit (2026-11-07, complete, awaiting owner approval)

Not done, by instruction: no commit, no push. The development database was not used by any test; every
runtime test used `ecommerce_test` and the `ecom:test:` Redis prefix.

### What was built

| Area                               | Files                                                                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sessions                           | `session-token.ts`, `session.repository.ts`, `session.service.ts`, `src/lib/session-cookie.ts` (TD-011)                                                                                                        |
| Who is calling                     | `access-control.ts` (`requireCustomer`, `requireStaff`, `requirePermission`), `current-session.ts` (Server Components), `src/lib/client-ip.ts`                                                                 |
| Customer accounts                  | `customer-account.repository.ts` / `.service.ts`: register, sign in, sign out everywhere, profile                                                                                                              |
| Staff accounts                     | `staff-account.repository.ts` / `.service.ts`: sign in with success and failure audit, profile with roles and permissions                                                                                      |
| Addresses                          | `address.repository.ts` / `.service.ts` / `.errors.ts`: create, edit, archive, set default, customer-row lock                                                                                                  |
| Audit                              | `src/modules/audit/*` (TD-014)                                                                                                                                                                                 |
| Validation and errors              | `identity.schema.ts`, `identity.errors.ts`, `permissions.ts`, `src/lib/request-body.ts`, `isUniqueViolation` in `src/lib/db.ts`                                                                                |
| API routes (11 files, 14 handlers) | `src/app/api/store/auth/{register,login,logout,logout-all}`, `store/account/profile`, `store/account/addresses[/{id}[/default]]`, `admin/auth/{login,logout,me}`                                               |
| Proxy                              | sign-in redirects (`src/lib/sign-in-redirect.ts`, admin deny-by-default), `src/lib/safe-next-path.ts`                                                                                                          |
| Pages                              | store `/login`, `/register`, `/account`, `/account/addresses`; admin `/login`; admin dashboard now signed-in with a permission-filtered navigation                                                             |
| Components                         | molecules `FormField`, `PasswordField`, `ConfirmDialog`, `AddressCard`; organisms `LoginForm` (both sites), `RegisterForm`, `ProfileForm`, `AccountSessionActions`, `AddressBook`, `AdminSessionMenu`; 7 icons |
| Test fixtures                      | `tests/integration/support/identity-fixtures.ts`; `scripts/prepare-test-identity.ts` (run by `npm run start:test`)                                                                                             |
| Config                             | `config/config.test.json` rate limits raised (sign-in 20/min, registration 50/min; TD-015)                                                                                                                     |
| Docs                               | `docs/walkthroughs/wave-2b.md`, TD-011–TD-015, API docs, traceability (R1, R2, R15, T2, T4, T6, T8, X2), README demo accounts, testing strategy, architecture status                                           |

### Bugs and surprises found during Wave 2B, all fixed and verified

1. **The audit filter dropped `revokedSessionCount`.** It matched the word "session". Found by an
   integration test. The key was renamed to `revokedCount`; the filter stays strict.
2. **Next 16 keeps the previous page mounted but hidden** (React `<Activity>`). Browser tests then found two
   "Email" inputs; locators now match visible elements only. Not an app bug.
3. **Next's route announcer is also `role="alert"`.** Tests match alerts by text.
4. **Every registration over plain local HTTP shares one rate-limit bucket.** Route handlers cannot see the
   socket IP, and proxy headers are not trusted locally. Test limits were raised so repeated runs pass.
   Documented in TD-015.
5. **Empty optional address lines.** These would have been stored as `""` when cleared in the edit form.
   They are now stored as `NULL`, the same as a line that was never filled.
6. **ESLint flagged two Next/React deprecations,** both fixed: React 19.3 deprecates `FormEvent` (now
   `SubmitEvent`), and Next.js prefers `router.replace` over `window.location.assign`.

### Mistakes made and corrected (process)

- Two test bugs of my own:
  - an eager array of promises in the 404 address test caused unhandled rejections;
  - `getByText('Default')` also matched "Make default".
- One `as` cast (`permissions.ts`) and one `as keyof` cast in the first draft of the address form were
  removed; a scan of every changed TypeScript file now finds none.
- The README first described a demo customer as having orders without checking; it now states only what a
  read-only query confirmed (2 saved addresses each).

### Behaviour change to Wave 1 tests (intentional)

The admin site is now deny-by-default, so a signed-out visitor to an unknown admin URL is redirected to
sign-in instead of seeing a 404. The Wave 1 admin 404 tests were updated as follows:

- HTTP tests send a placeholder cookie.
- Browser tests sign in first.
- The "admin home returns 200" checks now target `/login`.

All original assertions about the 404 pages themselves are unchanged and pass.

### Test results (final regression, 2026-11-07 14:43 UTC, Node v26.13.0, final working tree)

| Command                    | Result                                                    | Change since Wave 2A                                                                                                                        |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check`     | exit 0                                                    |                                                                                                                                             |
| `npm run lint`             | exit 0, 0 warnings                                        |                                                                                                                                             |
| `npm run typecheck`        | exit 0                                                    |                                                                                                                                             |
| `npm test`                 | **147 / 147**                                             | +48 (session tokens, cookies, client IP, sign-in redirect, `next` safety, audit sanitiser, Argon2id, API client, navigation filter, config) |
| `npm run test:integration` | **70 / 70**                                               | +52 (identity constraints 14, sessions and access 9, customer accounts 12, addresses 10, staff sign-in 7)                                   |
| `npm run build`            | exit 0; account and admin pages are partial prerender (◐) |                                                                                                                                             |
| `npm run test:http`        | **38 / 38**                                               | +19 (identity API suite 17, sign-in redirect 2)                                                                                             |
| `npm run test:e2e`         | **40 / 40** (desktop + 360 px)                            | +22 (customer journey, field errors, password toggle, 5 staff roles, wrong password, customer on admin, keyboard)                           |

Stability: HTTP, browser and integration suites were run a second time straight away (inside the same
rate-limit window). All passed again.

### Database verification

| Database          | Result                                                                                                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ecommerce` (dev) | `3a6b72f9d53ed06b19f3f136d24b84a6`, 46 tables, 1626 rows: **identical to the post-Step-B baseline** after all of Wave 2B. `sessions` 0 rows, `audit_logs` 0 rows. 36 CHECK, 134 indexes, migrations `20261107000000_init`, `20261107150000_identity_constraints` |
| `ecommerce_test`  | reset by every `npm run start:test` and truncated by integration tests, as designed                                                                                                                                                                              |
| Redis             | 0 keys after the run (integration tests delete `ecom:test:*`; development wrote none)                                                                                                                                                                            |

### Known limitations after Wave 2B

- **Duplicate-email 409 reveals that an email is registered** (owner decision, TD-012).
- **No password reset or email verification** (no email provider). Not in the brief's MVP.
- **Expired sessions are not deleted yet**; they are filtered by the indexed `expires_at`. Clean-up job in
  Wave 14.
- **Locally, registration is limited per shared bucket, not per person** (TD-015). Production relies on a
  proxy setting `X-Forwarded-For`.
- **The audit trail has no admin screen yet** (Wave 10, `audit.read`).
- **Admin feature APIs do not exist yet.** `requirePermission` is tested directly; each later admin API
  must call it.
- **The development server was not exercised in this wave.** Signing in would add sessions and audit rows
  to the development database, which the fingerprint check is meant to keep unchanged. The production
  build was tested with the test configuration instead.

### Pending owner approvals (not done)

1. Review of Wave 2B.
2. Committing Wave 2B (Step 1 + Steps A/B + Stage C) locally; pushing.

## Wave 2B final checks requested by the owner (2026-11-07, done; commit deferred)

The owner approved Wave 2B subject to six checks, then asked to stop for the day **without committing**.
All six checks are done. Code changes made during the checks are listed under each one.

### 1. Identical sign-in errors

`tests/http/identity.http.test.ts` sends six failing sign-ins to the running server:

- store: unknown email, wrong password, blocked customer with the correct password;
- admin: unknown email, wrong password, deactivated staff with the correct password.

All six return 401 with byte-identical bodies and identical headers (ignoring `x-request-id` and `date`),
and none sets a cookie. The body is:
`{"error":{"code":"INVALID_CREDENTIALS","message":"The email or password is incorrect.","details":null}}`.

The blocked and deactivated states are set by `tests/http/support/test-database-writer.ts`, which works on
the guarded `*_test` database only.

### 2. Demo credentials cannot reach or work in production

Gaps found and fixed:

- The seed guard refused only the exact value `production`. It allowed `staging`, `prod`, `Production`
  and an empty `APP_ENV`.
- TD-013 cited "a test" that was really a manual rehearsal.
- There was no runtime defence.

What was built (TD-013):

| Layer             | Rule                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Seed (allowlist)  | `assertDemoCredentialsAllowed(APP_ENV)` permits only `development` and `test`                                                                                                                                                                                                                                                                                |
| Sign-in (runtime) | needs `authentication.demoAccountsAllowed` = true **and** `APP_ENV` in {development, test}. The flag is `false` in the staging and production configs (enforced by a config test). Otherwise `@demo-store.test` emails and `DemoPass!2026` get the ordinary 401 (staff refusals audited as `DEMO_CREDENTIAL_REFUSED`), and registration with either gets 400 |

A bug found by the new unit tests and fixed: a default parameter made `assertDemoCredentialsAllowed(undefined)`
fall back to `process.env.APP_ENV`. The environment is now an explicit argument.

| Evidence                                                                                                                             | Result                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests (`demo-credentials.test.ts`)                                                                                              | allowlist; refusal of `production`, `staging`, `prod`, `Production`, `''` and unset; both layers must agree                                                                                                                                                     |
| `npm run db:seed` and `db:seed:demo-passwords` with `APP_ENV` = production, staging, prod, Production (8 runs, aimed at the test DB) | all exit 1 before any database work; test DB fingerprint unchanged (`4fc1488b…`)                                                                                                                                                                                |
| Real build, `APP_ENV=production` + production config, on a test DB holding all 8 demo accounts with valid Argon2id hashes            | all 8 demo sign-ins 401 (5 staff refusals audited); the same database under the test config: 200. Registration with the demo password or domain: 400; an ordinary registration: 201. The 12 Redis keys this check created under `ecom:production:` were deleted |
| Integration (`demo-credentials-refused.test.ts`, 5 tests)                                                                            | refusal, identical 401, demo password on an ordinary email refused, audit reason, registration 400, ordinary accounts unaffected                                                                                                                                |

Residual risk (traceability L5): seed scripts read `.env`, so seeding a production database from a
developer machine would pass layer 1. Layer 2 still refuses every demo sign-in.

### 3. Development database fingerprint

- **Method:** for each of the 46 tables, the row count and the md5 of all rows (`string_agg` of the row
  text in sorted order). The fingerprint is the md5 of that 46-line list.
- **Baseline:** `84956ffb57af5da58ba41b5ea154611d`. This is the state after the Wave 1 seed, re-verified
  unchanged at every Wave 1, Wave 2A and Wave 2B Step 0/1 checkpoint, and taken immediately before Step A.

| Point                                                     | Fingerprint                        | Rows |
| --------------------------------------------------------- | ---------------------------------- | ---- |
| Wave 2B start (before Step A)                             | `84956ffb57af5da58ba41b5ea154611d` | 1625 |
| After Step A (migration)                                  | `452f5293880ecbb5767c41477d69cf05` | 1626 |
| After Step B, and at every check since (latest 15:05 UTC) | `3a6b72f9d53ed06b19f3f136d24b84a6` | 1626 |

Every table-level difference between the start and now, and nothing else:

| Table                | Change                                             | Intended by                  |
| -------------------- | -------------------------------------------------- | ---------------------------- |
| `_prisma_migrations` | 1 → 2 rows (`20261107150000_identity_constraints`) | Step A                       |
| `customers`          | content hash changed; 3 rows                       | Step B (`password_hash` × 3) |
| `staff_users`        | content hash changed; 5 rows                       | Step B (`password_hash` × 5) |

- With `password_hash` excluded (`to_jsonb(row) - 'password_hash'`), all 46 tables are identical to the
  state before Step B. That includes `updated_at`, which proves the raw `UPDATE` touched nothing else.
- Schema objects added by Step A: 4 CHECK constraints and `sessions_expires_at_idx` (32 → 36 CHECK,
  133 → 134 indexes).
- No test, smoke run or check ever connected the app to the development database. `sessions` and
  `audit_logs` there have 0 rows.

### 4. Development-server limitation and a safe smoke test

- New `npm run start:test:dev`: the same guarded reset of `ecommerce_test` as `start:test`, then `next dev`
  on port 3100 with the test config.
- New `npm run test:http:dev`: the HTTP suite, expecting the dev-only `'unsafe-eval'` in the CSP.
- Procedure documented in `docs/TESTING_STRATEGY.md`.
- Result: `test:http:dev` 39 / 39; `test:e2e` on `next dev` 40 / 40 in three consecutive runs, with no
  full reloads logged.

The smoke runs exposed two test-design problems, both fixed:

- **A Radix Toast duplicate.** A short-lived screen-reader copy of the toast text made one assertion
  ambiguous; it is now scoped to the Notifications region.
- **Staff sign-in rate limit.** The browser suite signs in as one staff account about 12 times per run,
  so back-to-back runs hit 429. The test config's staff sign-in limit is now 100/min (development and
  production unchanged).

The final regression then exposed one more:

- **The clock-aligned rate-limit window.** `rate-limit-redis-down.test.ts` failed once (counter 41 of 50
  at the 51st call): the higher test limits made "limit + 1" loops long enough to cross a minute
  boundary. The new `waitForFreshRateLimitWindow()` is used by the 4 such tests. A run started 8 s before
  a boundary passed.

### 5. Git diff (HEAD `6d60892`, nothing staged)

| Kind                   | Count                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Modified tracked files | 31 (1,185 insertions, 101 deletions)                                                |
| New files              | 103 (5,711 lines), plus `docs/SESSION_HANDOFF.md` added at the end of the day = 104 |
| Deleted files          | 0                                                                                   |

- Every file was reviewed: all are Wave 2B code, tests, docs, config or the migration.
- `package-lock.json` adds only `@node-rs/argon2` 2.2.2 and its 13 optional platform bindings.
- `AGENTS.md` is unchanged.
- Ignored artefacts (`.env`, `.next/`, `test-results/`, `playwright-report/`, `src/generated/`) are not
  included.

### 6. Final regression (2026-11-07 15:04–15:05 UTC, Node v26.13.0, final code)

| Command                                              | Result                                         |
| ---------------------------------------------------- | ---------------------------------------------- |
| `npm run format:check`, `lint`, `typecheck`, `build` | all exit 0                                     |
| `npm test`                                           | **159 / 159**                                  |
| `npm run test:integration`                           | **75 / 75**                                    |
| `npm run test:http`                                  | **39 / 39**                                    |
| `npm run test:e2e`                                   | **40 / 40** (desktop + 360 px)                 |
| Dev database afterwards                              | `3a6b72f9d53ed06b19f3f136d24b84a6` (unchanged) |

Outstanding limitations are listed in `docs/REQUIREMENTS_TRACEABILITY.md` ("Outstanding limitations", L1–L19).

### Not done, by owner instruction (end of day)

The local Wave 2B commit was approved after the checks, but the owner then asked to stop without
committing. Nothing is committed or pushed. Wave 3 is not started.

## Wave 2B final check 7: client IP behind proxies (2026-11-10, done; awaiting owner review)

An independent read-only review of the Wave 2B code found one should-fix security issue. The owner
approved fix A only (trusted proxy hop count). Fix B (per-account sign-in limit) is recorded as L20 and the
re-login session observation as L21; neither was implemented. Nothing committed or pushed.

### The issue

- `src/lib/client-ip.ts` used the **leftmost** `X-Forwarded-For` entry, and staging/production set
  `trustProxyHeaders: true`. Proxies that append (nginx, AWS ALB, most ingress controllers) put the real
  address on the right, so the leftmost entry is whatever the client sent.
- Effect behind such a proxy, or with `next start` exposed directly: a new forged IP per request gave
  unlimited sign-in guesses per account (staff included), no registration limit (each attempt costs one
  Argon2id hash) and a forged `audit_logs.ip_address`.
- Next.js detail: `base-server.js` sets `x-forwarded-for` from the socket only when the header is absent
  (`??=`), so a client-supplied header passes through unchanged.
- Not reachable in development or test (`trustProxyHeaders: false`).

### The fix

| File                                                       | Change                                                                                                                                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/client-ip.ts`                                     | `clientIpAddress(headers, trustedProxyHopCount)`: hop count < 1 (or not a whole number) → `null`; otherwise the entry N places from the right; fewer entries or an invalid entry → `null`, never another entry |
| `src/lib/config/config.schema.ts`                          | `authentication.trustedProxyHopCount`: required, `z.int().min(0).max(5)`; the old key is refused by the strict schema                                                                                          |
| `src/modules/identity/access-control.ts`                   | `requestMetadata` passes the hop count (the only caller; all 7 IP consumers use its result)                                                                                                                    |
| `config/config.{development,test,staging,production}.json` | `"trustedProxyHopCount": 0`. Staging and production stay at 0 until the hosting topology is verified (no platform assumed)                                                                                     |
| Docs                                                       | TD-015 rewritten, TD-012 cross-reference, L4 updated, L20 and L21 added, DEPLOYMENT_GUIDE step, TESTING_STRATEGY, T8 counts                                                                                    |

Rate-limit fallback behaviour (`unknown-client` registration bucket, per-email sign-in bucket, Redis →
Postgres store fallback) and audit logging are unchanged.

### Red/green evidence (Node v26.13.0)

Tests were written first and run against the unchanged implementation. For the integration run only, the
test's config override also set the old implementation's production value (`trustProxyHeaders: true`);
that one line was removed after the fix. No assertion changed between the runs.

| Run         | Command                                                                                          | Old implementation                                                         | Fixed   |
| ----------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------- |
| Unit        | `npx vitest run src/lib/client-ip.test.ts src/lib/config/load-config.test.ts`                    | 20 failed, 22 passed (e.g. `expected '198.51.100.99' to be '203.0.113.7'`) | 42 / 42 |
| Integration | `npx vitest run --config vitest.integration.config.ts tests/integration/client-ip-trust.test.ts` | 6 failed, 2 passed                                                         | 8 / 8   |

The six integration failures on the old code reproduce the attack: the over-limit sign-in returned 401
instead of 429 (customer and staff), the over-limit registration succeeded, the audit row stored the forged
`198.51.100.42`, and an invalid rightmost entry fell back to the leftmost. The two that passed are guards
(separate buckets for different real clients; the per-email fallback with no header). The new HTTP test
(`tests/http/client-ip.http.test.ts`, forged headers share one bucket when no proxy is trusted) is a guard
for the committed test configuration and passes on both.

### Full regression (2026-11-10 08:59–09:02 UTC, Node v26.13.0)

| Command                                              | Result                              |
| ---------------------------------------------------- | ----------------------------------- |
| `npm run format:check`, `lint`, `typecheck`          | all exit 0                          |
| `npm test`                                           | **179 / 179** (+20)                 |
| `npm run test:integration`                           | **83 / 83** (+8)                    |
| `npm run build`                                      | exit 0                              |
| `npm run test:http` (production build, `start:test`) | **40 / 40** (+1)                    |
| `npm run test:e2e` (production build)                | **40 / 40** (desktop + 360 px)      |
| `npm run test:http:dev` (`start:test:dev`)           | **40 / 40**                         |
| `npm run test:e2e` on `next dev`                     | **40 / 40**, no full reloads logged |

### Database and services

- Development database fingerprint before (08:57 UTC) and after (09:02 UTC):
  `3a6b72f9d53ed06b19f3f136d24b84a6`, per-table output identical. No migration.
- Redis: 0 development keys; 20 `ecom:test:` rate-limit counters left by the HTTP and browser runs, all
  with a TTL under 35 s.
- Test servers stopped; ports 3000, 3100 and 3200 free.

### Pending owner approvals

1. Review of check 7.
2. The local Wave 2B commit (now including check 7). Push not approved. Wave 3 not started.

## Wave 3 step 1: catalogue integrity migration on the test database (2026-11-10, done; awaiting owner review)

Approved scope: one additive migration, tested on `ecommerce_test` **only** (apply, rollback, re-apply,
drift, full seed, integration tests). Not done, by instruction: nothing applied to the development
database, no `db:reset`, no reseed of development, no commit or push, no other Wave 3 code.

Every test-database command ran through a wrapper that calls the project's `assertTestDatabaseUrl` guard
first (it printed `guard passed: target database ecommerce_test (development is ecommerce)` each time) and
never prints connection strings. The rollback script was run with `psql -d ecommerce_test` named
explicitly.

### Changes

| File                                                                 | Change                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                                               | `Product.version Int @default(0)`; `@@index([name, id])` on products; `@@unique([productId, id])` and a GIN `jsonb_path_ops` index on `product_variants.option_values`; `ProductMedia.variant` becomes a composite relation `(productId, variantId) → (productId, id)`, update/delete RESTRICT; `alt_text` loses its `''` default |
| `prisma/migrations/20261110093000_catalogue_integrity/migration.sql` | Prisma-generated DDL (from `migrate diff` against the test DB) + 11 hand-written CHECKs. Destructive-statement scan: only the planned FK swap and `DROP DEFAULT`                                                                                                                                                                  |
| `prisma/rollbacks/20261110093000_catalogue_integrity.down.sql`       | new reverse script (single transaction)                                                                                                                                                                                                                                                                                           |
| `tests/integration/catalogue-constraints.test.ts`                    | new: 26 tests                                                                                                                                                                                                                                                                                                                     |
| `tests/integration/identity-constraints.test.ts`                     | migration-list assertion now checks its own migration is present instead of the exact list of two                                                                                                                                                                                                                                 |
| Docs                                                                 | TD-016; `DATABASE_DESIGN.md` constraints and mandatory Wave 8 requirements; L22, L23; `er-diagram.svg` regenerated (`npm run docs:erd`)                                                                                                                                                                                           |

### Test database evidence

| Step                                                       | Result                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline                                                   | 36 CHECK, 55 FK, 134 indexes, 2 migrations; schema snapshot of 1,036 columns/constraints/indexes saved                                                                                                                                                                                |
| Seed before migrating (`db:seed`, `APP_ENV=test`, guarded) | exit 0. Catalogue, stock and order lines identical to development by natural keys and business columns (768 rows: types, attributes, brands, products, variants, images, stock, order lines). Raw hashes differ only because `uuidv7()` ids and timestamps are generated per database |
| `prisma migrate deploy`                                    | `Applying migration 20261110093000_catalogue_integrity`, exit 0                                                                                                                                                                                                                       |
| After apply                                                | 47 CHECK (+11), 55 FK (one replaced), 137 indexes (+3); schema diff shows exactly the planned objects; data unchanged (768 rows identical); `version = 0` on all 40 products; `migrate status` up to date; `migrate diff … --exit-code` 0 (no drift); no `NOT VALID` constraints      |
| Rollback (`psql -1 -v ON_ERROR_STOP=1`)                    | exit 0. Schema snapshot **identical** to the baseline (1,036 lines), data identical, counts 36/55/134, `migrate diff` against the committed `schema.prisma` exit 0, migration shown as pending                                                                                        |
| Re-apply                                                   | exit 0; schema identical to the first application; drift exit 0                                                                                                                                                                                                                       |
| Seed on the migrated database (new Prisma client)          | exit 0; data still identical to development; 0 violations of the new rules                                                                                                                                                                                                            |

### Tests (Node v26.13.0, 2026-11-10 09:36–09:38 UTC)

| Command                                                               | Result                                    |
| --------------------------------------------------------------------- | ----------------------------------------- |
| `format:check`, `lint`, `typecheck`, `prisma format --check`, `build` | all exit 0                                |
| `npm test`                                                            | 179 / 179                                 |
| `npm run test:integration`                                            | **109 / 109** (+26 catalogue constraints) |
| `npm run test:http` (production build)                                | 40 / 40                                   |
| `npm run test:e2e` (production build)                                 | 40 / 40                                   |

The 26 new tests cover: migration, indexes and composite FK present; version 0 and negative refused;
archived status/timestamp agreement; five bad product slugs and a bad brand slug; four bad type codes and a
bad attribute code; allowed-values rules (missing, empty, non-array, on TEXT; valid MULTI_ENUM and TEXT
accepted); variant options must be ENUM; five bad SKUs and a 64-character SKU accepted; negative image
position and blank alt text refused; product-level and own-variant images accepted; another product's
variant refused; a variant with images can be neither deleted nor moved.

### Development database (not touched)

- Fingerprint `3a6b72f9d53ed06b19f3f136d24b84a6` at 09:37 UTC, per-table output identical to the start of
  the session; still 2 migrations, 36 CHECK, no `products.version` column.
- `prisma migrate status` on development (read-only) now reports `20261110093000_catalogue_integrity` as
  not yet applied. Applying it needs the owner's separate approval. No runtime code reads catalogue
  tables yet, so the development server is unaffected meanwhile; the seed must not be run against
  development until the migration is applied there.

### Owner requirements recorded for the Wave 3 services (TD-016)

The last active variant of an ACTIVE product cannot be archived until the product is DRAFT; archiving
never deletes, edits or releases stock or reservations and leaves order snapshots, carts, movements,
reviews and collection links intact; image deletion keeps id, product, variant, URL, alt text and position
in the audit row. Each gets service-level tests when the services are built. The order-item composite
key (L22) and the weight and dimension snapshot (L23) are mandatory in Wave 8.

## Wave 3 step 2: catalogue integrity migration on the development database (2026-11-10, done)

Owner-approved with safeguards. Not done, by instruction: no seed against development, no `db:reset`, no
truncation, no business-data change, no other migration, no commit or push, no Wave 3 service code.
Evidence files (outside the repository): `~/ecommerce-backups/20261110-catalogue-integrity/`.

| Safeguard                                   | Result                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Read-only pre-checks (read-only session) | 0 violations of each of the 11 new rules (including images pointing at another product's variant); no `version` column yet; none of the 3 indexes existed; 0 other sessions on `ecommerce`; no app server running                                                                                                                                                                                                                       |
| 2. Baseline (11:08 UTC)                     | fingerprint `3a6b72f9d53ed06b19f3f136d24b84a6`, 46 tables, 1,626 rows; per-table baseline with `version` excluded; schema snapshot (1,036 objects); 768 natural-key rows; migration rows                                                                                                                                                                                                                                                |
| 3. Backup                                   | `pg_dump` 18.6, custom format: `ecommerce-dev-before-catalogue-integrity.dump` (193,445 bytes, mode 600, sha256 `5bfa8613e64ee935b58fde843e904f6fcfa02340f3bf04ba51d4b657f22ce8d6`). `pg_restore --list`: 46 TABLE DATA entries. **Restore verified:** restored into a throwaway database `ecommerce_restore_check`, whose fingerprint was `3a6b72f9…` (all 46 tables and the 1,036-object schema identical), then dropped              |
| 4. Pending migrations                       | exactly one: `20261110093000_catalogue_integrity`; file sha256 `607a8a95…` equals the checksum recorded on `ecommerce_test`                                                                                                                                                                                                                                                                                                             |
| 5. Apply                                    | `npm run db:deploy` (`prisma migrate deploy`) on `ecommerce`, 11:08:46–11:08:47 UTC, exit 0                                                                                                                                                                                                                                                                                                                                             |
| 6–7. Not run                                | seed, `db:reset`, truncation, data edits, other migrations                                                                                                                                                                                                                                                                                                                                                                              |
| 8. Status and drift                         | `migrate status`: up to date (3 migrations); `migrate diff --exit-code`: 0; 0 unvalidated constraints; no migration logs or rollbacks                                                                                                                                                                                                                                                                                                   |
| 9. Table-by-table comparison                | raw fingerprint now `04adce0841b9013d69f13b043ae4a245`: only `_prisma_migrations` (2 → 3 rows) and `products` (row text now includes `version`) differ. With `version` excluded, 45 of 46 tables are identical and only `_prisma_migrations` differs; its two earlier rows are unchanged. `version = 0` on all 40 products; no `updated_at` changed. The schema change is line-for-line identical to the one tested on `ecommerce_test` |
| 10. Dependent data                          | identical: stock levels (on hand 4,677, reserved 10), movements (405), orders (20), order lines and snapshots (32; 1 on an archived variant), carts and cart lines, reviews (4), collection links (9), search outbox, audit logs, sessions, all catalogue tables; 768 natural-key rows identical                                                                                                                                        |
| 11. Stop conditions                         | none hit                                                                                                                                                                                                                                                                                                                                                                                                                                |

**New development fingerprint baseline:** `04adce0841b9013d69f13b043ae4a245` (from now on). The seed can be
run against development again, but only with the owner's approval.

## Wave 3 step 3: catalogue services (2026-11-10, done; awaiting owner review, not committed)

Owner-approved scope: the catalogue service layer (sections 1–6). Not done, by instruction: no HTTP route
handlers or admin pages yet (L24), no development seed, no development database writes, no commit or push,
nothing from later waves (checkout, payment, orders, fulfilment). Mandatory Wave 8 items L22 and L23 are
unchanged.

### What was built

| Section                                  | Files (`src/modules/catalogue/` unless noted)                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared                                   | `catalogue.errors.ts`, `catalogue.schema.ts`, `catalogue-audit.ts`, `slug.ts`; `src/modules/search/search-outbox.repository.ts`; `assertStaffPermission` in `access-control.ts`; foreign-key helper in `src/lib/db.ts`; `BrandId`, `AttributeDefinitionId`, `ProductMediaId` in `src/lib/ids.ts`; 20 catalogue audit actions |
| 1–2 Types, definitions, brands, products | `attribute-validation.ts`, `product-type.repository.ts`, `product-type.service.ts`, `brand.repository.ts`, `brand.service.ts`, `product.repository.ts`, `product.service.ts`, `product-list-query.ts`                                                                                                                        |
| 3 Variants                               | `variant-generation.ts`, `variant.repository.ts`, `variant.service.ts`, `product-lifecycle.ts`                                                                                                                                                                                                                               |
| 4 Images                                 | `image-url.ts`, `media.repository.ts`, `media.service.ts`                                                                                                                                                                                                                                                                    |
| 5 Lifecycle                              | `changeProductStatus` in `product.service.ts`                                                                                                                                                                                                                                                                                |
| 6 Integrity                              | cross-cutting tests (below)                                                                                                                                                                                                                                                                                                  |

Decisions are in TD-016 ("implementation notes").

### Problems found while building, all fixed

1. **Synchronous throws.** Non-`async` service functions threw permission errors synchronously instead of
   rejecting. Found by an integration test; every entry point is now `async`.
2. **Paging precision.** The first keyset compared `created_at` from JavaScript (milliseconds) with
   Postgres (microseconds), which can skip or repeat rows. Newest/oldest now page by the `uuidv7` id.
3. **Wrong conflict codes.** Restoring a non-archived type and changing an archived definition first used a
   status-transition error with invented states; they now have their own codes.
4. Test mistakes of my own: a SKU-length boundary (60 + "-XXL" is exactly 64, which is valid), an error test
   that called factories without arguments, and two lint findings (`import()` types, `expect.any`).

### Tests (Node v26.13.0, 2026-11-10 12:07–12:09 UTC)

| Command                                      | Result                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `format:check`, `lint`, `typecheck`, `build` | all exit 0                                                                                    |
| `npm test`                                   | **258 / 258** (+79: validator, schemas, list query, slug, lifecycle, generator, image URLs)   |
| `npm run test:integration`                   | **184 / 184** (+75: types 13, products 16, variants 17, images 10, lifecycle 9, integrity 10) |
| `npm run test:http` (production build)       | 40 / 40                                                                                       |
| `npm run test:e2e` (production build)        | 40 / 40                                                                                       |

Owner requirements and their evidence:

| Requirement                                                                                | Test                                                                                                                              |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Activating without an active variant → 422                                                 | `catalogue-lifecycle`: "fails with 422 while there is no active variant"                                                          |
| Archiving the last active variant of an ACTIVE product → 409                               | `catalogue-variants`: "refuses to archive or deactivate the last active variant"                                                  |
| Row locking keeps the invariant under concurrency                                          | `catalogue-lifecycle`: activation racing an archive (6 rounds); two concurrent archives (4 rounds) — exactly one wins each time   |
| Optimistic locking                                                                         | `catalogue-products`: stale version 409; five concurrent updates from one version → one wins                                      |
| Archival never touches stock, reservations, movements, orders, carts, reviews, collections | `catalogue-lifecycle`: all 8 tables byte-identical after variant archive, product archive and restore; reservation still 3 of 10  |
| Images reference their own product's variants                                              | `catalogue-media`: another product's variant → 422 on add and update                                                              |
| Complete image-deletion audit                                                              | `catalogue-media`: `before` = image id, product id, variant id, URL, alt text, position                                           |
| Audit in the same transaction                                                              | `catalogue-integrity`: product rolled back when the outbox or audit write fails                                                   |
| Deny-by-default RBAC                                                                       | `catalogue-integrity`: all 5 seeded roles (write only for SUPER_ADMIN and CATALOGUE_MANAGER); no permissions → 403 even for reads |
| Predictable, non-leaking errors                                                            | `catalogue-integrity`: every catalogue error envelope free of SQL and constraint names                                            |

Not proven: the concurrency tests show the locks hold, but no run was made with the locks removed to show
the tests would then fail.

### Databases

Development fingerprint `04adce0841b9013d69f13b043ae4a245` before (12:07 UTC) and after (12:09 UTC) the
regression; 0 development Redis keys. All test setup ran on `ecommerce_test` through the existing guards.

### Pre-commit review (owner-approved commit, 2026-11-10 12:15 UTC)

- **Permissions:** a scan of every exported service function found all 24 entry points calling
  `assertStaffPermission` (6 × `catalogue.read`, 18 × `catalogue.write`); the 5 exports without it are
  helpers that need a caller's transaction client.
- **Atomicity:** no `getDatabase()` inside any `$transaction` block, no catalogue write outside one, and
  all 23 audit and outbox calls receive the transaction client.
- **Locks:** lock order traced for every operation (TD-016 notes); no wait cycle is possible.
- **Fixed in the review:** a SKU clash found by the generator returned `details: { sku: "" }` (the
  constraint error does not carry the SKU); it now returns no details, and a test asserts `details: null`.
- **Hygiene:** no secrets, home paths, debug output, focused or skipped tests, or files outside the module,
  search outbox, integration tests, four shared libs and docs. The one credential-like string added is the
  negative test `https://user:secret@picsum.photos/x.jpg`, which must be refused.
- **Checks (Node v26.13.0):** `git diff --check`, format, lint, typecheck, build all pass; unit 258 / 258;
  integration 184 / 184 (re-run because of the fix). Development fingerprint `04adce08…` before and after.

## Wave 3 step 4: catalogue admin API, admin pages, HTTP and browser tests (2026-11-10, done; awaiting owner review, not committed)

Owner-approved scope: admin route handlers on the existing services, the admin UI for product types,
attributes, brands, products, variants and images, HTTP tests and browser tests. Not done, by instruction:
no checkout, payment, order or pricing work (prices stay integer paise; L28), no development seed or
database change, no commit or push.

### What was built

| Area                              | Files                                                                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API (19 route files, 25 handlers) | `src/app/api/admin/{product-types,attribute-definitions,brands,products,variants,media}/**/route.ts`; `src/lib/request-query.ts`; `PUT` in `src/lib/api-client.ts` (which now also passes the error `details` to the UI)                                                        |
| Pages (6)                         | `src/app/admin/{product-types,product-types/[productTypeId],brands,products,products/new,products/[productId]}/page.tsx`; shared `admin-page-frame.tsx` (session, role-aware navigation, access-denied state) and `catalogue-page-parts.tsx`                                    |
| Components                        | `src/components/organisms/CatalogueAdmin/` (product types, attribute definitions, brands, product create form, product editor, variants, images, filters, action and failure helpers); `src/components/molecules/SelectField`; 7 icons; 3 navigation entries (`catalogue.read`) |
| Service additions                 | `listProductTypesWithDefinitions` (one query for all types, no N+1); plain-language "required" messages in the attribute validator                                                                                                                                              |
| Tests                             | `tests/http/catalogue.http.test.ts` (11); `e2e/catalogue.spec.ts` (4 × desktop and 360 px)                                                                                                                                                                                      |
| Docs                              | API documentation (catalogue section), traceability (R13, T6, T8; L24 resolved; L27–L29), testing strategy, Wave 3 walkthrough                                                                                                                                                  |

Every handler calls `requirePermission` first, then parses the path id (`z.uuid()`), the query or the body
with the shared strict schema, then calls the service (which checks the permission again).

### Problems found while building, all fixed

1. **Technical error text in the form.** A missing required attribute returned Zod's "Invalid input:
   expected string, received undefined". Found by the browser test; the validator now says "Choose a value",
   "Enter a value" or "Choose at least one value" (unit test updated).
2. **Unsaved edits would be lost.** A `key={product.version}` on the details form would have remounted it
   whenever a variant or image change moved the version; removed before testing.
3. **N+1 on the new-product page.** Loading each type's definitions separately was replaced by one query.
4. Lint findings fixed: JSX inside `try/catch` (React rule), a dynamic `delete`, unused values, a `Link`
   appearance that does not exist.
5. Test mistakes of my own: duplicate toasts and hidden duplicate content (Next 16 keeps a hidden copy, so
   assertions match visible elements, as the existing helpers do), the confirm dialog's role, and an
   intended API-client shape change (`details`) that the existing unit test now asserts. One shell slip: a
   loop variable named `path` cleared `PATH` in zsh for that command only.

### Tests (Node v26.13.0, 2026-11-10 12:30–12:39 UTC)

| Command                                      | Result                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `format:check`, `lint`, `typecheck`, `build` | all exit 0 (catalogue pages are partial prerender)                            |
| `npm test`                                   | 258 / 258                                                                     |
| `npm run test:integration`                   | 184 / 184                                                                     |
| `npm run test:http` (production build)       | **51 / 51** (+11)                                                             |
| `npm run test:e2e` (production build)        | **48 / 48** (+8); the catalogue spec also passed a second run with fresh data |

HTTP coverage: 401 without a session (read and write), 403 for a customer session and for read-only staff on
five kinds of write, 403 cross-site origin, 404 on the store host, 400 for malformed JSON, unknown fields, a
bad id and five bad query parameters, 404 unknown product, a full create → 422 → generate → image →
activate → list → 409 last variant → archive workflow, 409 duplicate code and SKU, five concurrent edits from
one version giving exactly one 200 and four 409 `STALE_PRODUCT`, and image reorder with a stale-order 409.

Browser coverage (desktop and 360 px, no page errors, no CSP violations, no horizontal overflow): a catalogue
manager creates a new product type with its own attributes, a brand, sees an inline error for a missing
required attribute, creates the product, is refused activation without a variant (reason shown), generates
size variants, adds an image, activates it and finds it with the list filters (the plan's Wave 3 "done
when"); support staff see the product with no write controls and get the access-denied state on the
new-product page; a save from a stale tab shows the conflict message; the last active variant cannot be
archived, and an archived product disappears from the list.

### Databases

Development fingerprint `04adce0841b9013d69f13b043ae4a245` at 12:38 UTC (unchanged); 0 development Redis
keys. Test servers stopped.

### Pre-commit review (owner-approved commit, 2026-11-10 12:55 UTC)

- **Routes:** a scan of all 19 files found 25 handlers, every one wrapped in `apiHandler` (so the
  same-origin check covers all 19 state-changing handlers), every one starting with `requirePermission`
  (`catalogue.read` for the 6 `GET`s, `catalogue.write` for the rest), every path id parsed with `z.uuid()`,
  and every body or query read only through `parseJsonBody` / `parseSearchParams` with a strict schema.
- **No UI bypass:** pages call services that check permissions again; the UI only calls these routes, and
  HTTP tests prove read-only staff get 403 on writes.
- **Form state:** a new browser check types an unsaved description, generates variants and adds an image
  (each moves the product version and refreshes the page), confirms the text is still there, and saves it
  successfully (no stale-version conflict), on desktop and 360 px.
- **Currency:** prices are integer paise, displayed only through the existing `Money.formatRupees`
  (`en-IN`, `INR`); no other currency and no pricing logic.
- **Hygiene:** no secrets, debug code, focused or skipped tests, TODOs, home paths, build artefacts or files
  outside the catalogue API, admin pages, catalogue components, the shared client helpers, tests and docs.
- **Checks (Node v26.13.0):** `git diff --check`, format, lint, typecheck, build pass; unit 258 / 258;
  integration 184 / 184; HTTP 51 / 51; browser 48 / 48. Development fingerprint `04adce08…` before and after.

## Wave 4: category tree, tagging and product groups (2026-11-10, done; awaiting owner review, not committed)

Owner-approved scope: category management and hierarchy, product groups and membership, assigning products
to categories and groups, validation (depth, cycles, duplicate slugs, invalid relationships), safe archive
and delete, search-outbox updates, RBAC, audit, transactional integrity, admin API, admin UI, HTTP and
browser tests. Not done, by instruction: no pricing, tax, discount, checkout, payment or order work; no
development seed, reset, truncate or data change; no commit or push. No schema change was needed: the
existing `categories` (path, level 1–4 CHECK, unique slug) and `product_groups` tables already fit.

### What was built

| Area                             | Files                                                                                                                                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Taxonomy module                  | `src/modules/taxonomy/`: `category-tree.ts` (pure: child paths, cycle and depth checks, subtree counts, name labels), schema, errors, `category.repository.ts`, `category.service.ts`, `tagging.repository.ts`, `tagging.service.ts`                             |
| Grouping module                  | `src/modules/grouping/`: `group-rules.ts` (capacity 50, same-member-set check), schema, errors, `product-group.repository.ts`, `product-group.service.ts`                                                                                                        |
| Shared additions                 | `lockProductsInIdOrder` and category/group fields in `product.repository.ts`; `enqueueProductsReindex` and `enqueueProductsInCategorySubtree` in the search outbox; `recordAuditEvents` / `recordCatalogueEvents` (several rows in one insert); 12 audit actions |
| API (9 route files, 15 handlers) | `src/app/api/admin/{categories,tagging,product-groups}/**/route.ts`                                                                                                                                                                                              |
| Pages (4)                        | `src/app/admin/{categories,tagging,product-groups,product-groups/[groupId]}/page.tsx`; category and group shown on the product page; 3 navigation entries (`catalogue.read`); 3 icons                                                                            |
| Components                       | `src/components/organisms/TaxonomyAdmin/` (`CategoryTreeManager`, `TaggingQueue`, `ProductGroupManager`, `ProductGroupEditor`)                                                                                                                                   |
| Tests                            | unit: `category-tree.test.ts` (10), `group-rules.test.ts` (2); integration: `taxonomy.test.ts` (19), `product-groups.test.ts` (12); HTTP: `taxonomy.http.test.ts` (5); browser: `e2e/taxonomy.spec.ts` (2 × desktop and 360 px); shared test helpers extracted   |

Permissions: reads use `catalogue.read`; every write uses the new `taxonomy.write` (SUPER_ADMIN and
CATALOGUE_MANAGER only), checked by `requirePermission` in the handler and again by the service.

### Rules

- **Tree:** at most 4 levels; moving a category under itself or a descendant → 409 `CATEGORY_MOVE_CYCLE`;
  a move or create that would put any node below level 4 → 422 `CATEGORY_TOO_DEEP`; slugs unique (409
  `CATEGORY_SLUG_TAKEN`, from the unique constraint). Products sit only on leaves: a category with products
  cannot get children (409 `CATEGORY_HAS_PRODUCTS`) and tagging to a non-leaf → 422 `CATEGORY_NOT_LEAF`.
- **Move and slug rename** rewrite the whole subtree's path and level in one `UPDATE`, and queue every
  product in the subtree for re-indexing in the same transaction.
- **Deactivate** cascades to the subtree; a child cannot be activated under an inactive parent (422). Tagging
  to an inactive category → 422. Products keep their category when it is deactivated.
- **Delete** only an empty leaf: children → 409 `CATEGORY_HAS_CHILDREN`; any product, archived included →
  409 `CATEGORY_HAS_PRODUCTS` (also mapped from the foreign-key error if a race slips past the count).
  Orders, carts, reviews and collections never reference categories, so they cannot be affected.
- **Tagging** is all-or-nothing for up to 100 products: unknown ids → 422 `PRODUCTS_NOT_FOUND`, archived →
  409 `PRODUCTS_ARCHIVED`, nothing changes. Only products whose category really changes get a version bump,
  an audit row and an outbox row.
- **Groups:** up to 50 members (422 `GROUP_FULL`); a product in another group → 409
  `PRODUCT_IN_ANOTHER_GROUP`; archived products cannot be added but can be removed; reorder and swatch
  labels need the exact current member set (409 `STALE_GROUP_MEMBERS`); deleting a group only ungroups its
  members (the audit row keeps the member list).

### Concurrency

Category writes take one transaction-scoped advisory lock for the tree, then row locks; tagging takes
`FOR SHARE` on the target leaf, so it serialises with child creation, moves and deletes of that leaf.
Every multi-product change (tagging, group add, remove, reorder, delete) locks the products in id order;
group changes lock the group row first. Integration tests race opposite moves (5 rounds, never a cycle),
tagging against child creation, overlapping bulk tags, two concurrent adds against the 50 cap, two groups
claiming one product, and group changes overlapping tagging (no deadlock).

### Permission tests

Support staff and a catalogue writer without `taxonomy.write` are refused (403) on all 12
write services (6 taxonomy, 6 grouping); the categories, groups, products, audit rows and outbox rows are
unchanged afterwards. Removing one service's permission check makes that test fail (checked, then restored).

### Problems found while building, all fixed

1. **Slugs in the Move dialog.** Parent choices read `western-mwapt0bsm`; both the Move dialog and the
   tagging page now use one `categoryNameLabels` ("Ethnic › Kurtas"), which stops at a missing parent and
   after four levels so bad data cannot loop (unit tests for root, nested, missing parent and cycle).
2. **Two form landmarks named like their own field** ("Find products to add", "Search groups"), which
   screen readers announce twice; the forms are now "Product search" and "Group search".
3. **Hidden duplicate inputs after reload** (Next 16 `<Activity>`): the swatch-label assertions now use
   `visibleField`, as the rest of the suite does; the assertion is unchanged.
4. A TypeScript error in the browser test (possibly-undefined array items under
   `noUncheckedIndexedAccess`), fixed by building each name directly, with no casts.
5. Earlier in the wave: a depth-test arithmetic mistake, a tree wrapped in `<nav>` (now a labelled
   `<section>`), JSX inside `try/catch`, unused destructured values in the audit sanitiser.
6. The machine slept mid-wave; a stale test server from before the sleep (on the test database) was found
   and stopped before rebuilding.
7. **Permission tests covered only "create".** The services already checked `taxonomy.write` on every write,
   but only creation was tested; the integration and HTTP tests now try every write (see above).

### Tests (Node v26.13.0, 2026-11-10 14:35–14:50 UTC)

| Command                                      | Result                                             |
| -------------------------------------------- | -------------------------------------------------- |
| `format:check`, `lint`, `typecheck`, `build` | all exit 0                                         |
| `npm test`                                   | **270 / 270** (+12)                                |
| `npm run test:integration`                   | **215 / 215** (+31)                                |
| `npm run test:http` (production build)       | **56 / 56** (+5)                                   |
| `npm run test:e2e` (production build)        | **52 / 52** (+4); the taxonomy spec also ran alone |

HTTP coverage: 401 without a session; 403 `PERMISSION_DENIED` for support and inventory staff on all 12
write handlers (reads allowed); 403 cross-site delete; 400 for bad ids and unknown fields; depth 422, cycle 409, non-leaf tagging 422, delete
refused with children or products and allowed on an empty leaf; a group add → reorder with swatches →
stale order 409 → second group 409 → remove → delete workflow; two groups claiming one product at once give
exactly one 200 and one 409.

Browser coverage (desktop and 360 px, no page errors, no CSP violations, no horizontal overflow): a catalogue
manager builds a tree, moves a subcategory (readable names in the dialog), tags two products to a leaf from
the queue (the non-leaf is not offered), sees no delete or add-child on a category with products, groups the
products, reorders them with swatch labels that survive a reload, and removes one; support staff see the
tree, queue and group with no write controls.

### Limitations recorded (traceability)

L30 audit UI deferred to Wave 10; L31 category and group snapshots on order lines **must be decided and
addressed before Wave 8 order implementation**; L32 unknown product-group page returns HTTP 200; L33 no
category reorder UI; L34 no database CHECK on category slug format; L29 (browser access-denied test) remains
open.

### Databases

Development fingerprint `04adce0841b9013d69f13b043ae4a245` (46 tables) after all tests, unchanged; 0
development Redis keys. Destructive tests used only `ecommerce_test`. Test servers stopped; ports 3000, 3100
and 3200 free.

## Wave 5 step 1: inventory ledger migration on the test database (2026-11-10, done; awaiting owner review, not committed)

Approved scope: the migration only, on `ecommerce_test` only. Not done, by instruction: nothing applied to
development, no development seed, reset or truncate, no inventory services, no commit or push. Decisions
recorded in TD-018 (idempotency design, TypedSQL deviation).

### Changes

| File                                                                | Change                                                                                                                                                                      |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                                              | `RECEIPT` movement type; ledger indexes with an `id` tiebreaker; reference index; partial low-stock index; model `InventoryChangeRequest` (unique per staff member and key) |
| `prisma/migrations/20261110150000_inventory_receipt_movement_type/` | `ALTER TYPE … ADD VALUE 'RECEIPT'` (own migration: a new enum value cannot be used in the transaction that adds it)                                                         |
| `prisma/migrations/20261110150100_inventory_ledger_integrity/`      | Prisma-generated DDL (from `migrate diff` against the test database; replacement indexes created before the old ones are dropped) + 5 hand-written CHECKs                   |
| `prisma/rollbacks/*.down.sql` (2)                                   | reverse scripts; the type rollback refuses to run before the ledger rollback, while RECEIPT rows exist, and the ledger rollback refuses while stock requests exist          |
| `tests/integration/inventory-ledger-constraints.test.ts`            | new: 11 tests                                                                                                                                                               |
| Docs                                                                | TD-018; `DATABASE_DESIGN.md` constraints; `er-diagram.svg` regenerated                                                                                                      |

Destructive statements: only the two replaced ledger indexes (`DROP INDEX`), each after its wider
replacement exists.

### Test database evidence

Database targets (from the session command log; URLs redacted): `DATABASE_URL` is
`postgresql://ecommerce:***@localhost:5433/ecommerce` (development) and `TEST_DATABASE_URL` is
`…/ecommerce_test`. Every `prisma migrate diff/deploy/status` and `db:seed` ran through the scratchpad
wrapper `with-test-db.sh`, which runs `assertTestDatabaseUrl` first (`set -e`) and only then sets
`DATABASE_URL` to the test URL; each TRUNCATE, rollback and rollback-guard check ran as
`psql -d ecommerce_test`, with the database named literally. Development was only read: schema snapshots and
natural-key comparisons with `default_transaction_read_only=on`, the SELECT-only fingerprint script, and a
read-only `prisma migrate status`.

| Step                                                                                    | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline                                                                                | test schema identical to development (1,075 lines incl. enums); 47 CHECK, 55 FK, 137 indexes, 3 migrations. **First attempt to empty the test tables failed** (15:14 UTC): the project helper `truncateAllTestTables` could not run from `tsx -e` (top-level await unsupported, then `InvalidEnvironmentError` because the full app environment was missing), and the `db:seed` chained after it in the same command still ran through the guarded wrapper into `ecommerce_test`, on top of rows left by the HTTP and browser runs (16 products, 6 staff, no stock). That output was piped through `tail -3`, so its "guard passed" line was not shown. Development was unaffected (405 movements, fingerprint unchanged). Then (15:15 UTC) the test tables were emptied with `psql -d ecommerce_test` and a `DO` block that aborts unless `current_database() = 'ecommerce_test'`, and seeded again; every comparison below starts from that clean seed |
| Seeded test data vs development                                                         | 802 natural-key lines identical (3 warehouses, 348 levels, 405 movements, 20 orders, 24 shipments, 2 cart items); timestamps differ by one constant 3 days because the seed dates rows relative to the day it runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `prisma migrate deploy`                                                                 | both migrations applied, exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| After apply                                                                             | 52 CHECK (+5), 56 FK (+1), 143 indexes (+8, −2); schema delta exactly the planned objects; every constraint validated; `migrate status` up to date; `migrate diff --exit-code` 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Data after apply                                                                        | the 802 lines identical including timestamps; every existing table's content hash identical (only `_prisma_migrations` +2 rows and the new empty table); 348 levels, 4,677 on hand, 10 reserved, 4,667 available, 405 movements                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Rollback guards                                                                         | type rollback first → refused; ledger rollback with a request row present → refused; type rollback with a RECEIPT row present → refused (each inside a transaction that was rolled back; nothing kept)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Rollback (ledger, then type; `psql -d ecommerce_test -v ON_ERROR_STOP=1 -1`, 15:20 UTC) | exit 0; schema identical to the baseline (enums included); data and every table hash, `_prisma_migrations` included, identical to the baseline. The re-apply below (15:20:38 UTC, guarded wrapper) is recorded in `ecommerce_test._prisma_migrations` (`started_at` 15:20:40); development has no rows for these migrations. These scripts were later hardened (next section)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Re-apply                                                                                | exit 0; schema identical to the first application; drift exit 0; data identical                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Seed on the migrated schema                                                             | exit 0; same 802 lines including timestamps; still identical to development by natural keys                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### Tests (Node v26.13.0)

| Command                                                               | Result              |
| --------------------------------------------------------------------- | ------------------- |
| `format:check`, `prisma format --check`, `lint`, `typecheck`, `build` | all exit 0          |
| `npm test`                                                            | 270 / 270           |
| `npm run test:integration`                                            | **226 / 226** (+11) |
| `npm run test:http` (production build, migrated test database)        | 56 / 56             |
| `npm run test:e2e` (production build, migrated test database)         | 52 / 52             |

The 11 new tests: migrations recorded, `RECEIPT` last in the enum, new indexes present and old ones gone, no
unvalidated constraint; impossible "after" quantities refused; each type's direction enforced (wrong sign
and 0 refused, right sign accepted); adjustments either way including 0; reason required for ADJUSTMENT and
RECEIPT (null, empty, blank); one key per staff member while another member or a new key with the same
content is accepted; malformed keys and fingerprints refused; 10 simultaneous inserts of one key keep
exactly one row; 10 concurrent transactions using `ON CONFLICT DO NOTHING` all resolve to the same single
request; unknown staff refused and a staff member with requests cannot be deleted; a request's movements
are found through the reference columns.

### Development database (not touched)

Fingerprint `04adce0841b9013d69f13b043ae4a245` (unchanged); schema snapshot and the 802 inventory and order
lines identical to the start of the step; still 3 migrations. `prisma migrate status` (read-only) lists the
two new migrations as not yet applied; applying them needs the owner's separate approval. No runtime code
uses the new objects yet. Test servers stopped; ports 3000, 3100 and 3200 free.

## Wave 5 step 1 hardening: rollback scripts, reason rule, idempotency tests (2026-11-10, done; awaiting owner review, not committed)

Owner-approved scope: harden both rollback scripts, refuse whitespace-only reasons, prove failure and
overlap behaviour of idempotent requests, document the fingerprint, expiry and direction rules, correct this
journal. Test database only; development not migrated, seeded, reset, truncated or modified. No services,
APIs or UI.

### Changes

| File                                                                        | Change                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/rollbacks/20261110150100_inventory_ledger_integrity.down.sql`       | `\set ON_ERROR_STOP on`; refuses without `-v expected_database`; explicit `BEGIN`/`COMMIT`; `current_database()` must equal `expected_database`; refuses if the migration is not applied; keeps the "no stock requests" guard; `DROP … IF EXISTS` replaced by strict drops (a missing object aborts) |
| `prisma/rollbacks/20261110150000_inventory_receipt_movement_type.down.sql`  | same hardening; keeps "ledger rolled back first" and "no RECEIPT rows" guards                                                                                                                                                                                                                        |
| `prisma/migrations/20261110150100_inventory_ledger_integrity/migration.sql` | reason CHECK: `btrim(reason) <> ''` → `reason ~ '[[:alnum:]]'` (at least one letter or digit, any script)                                                                                                                                                                                            |
| `tests/integration/inventory-ledger-constraints.test.ts`                    | reason test extended (14 refused values incl. tab, newline, CRLF, VT/FF, NBSP, ideographic, zero-width, BOM, punctuation; 5 accepted incl. Hindi and CJK); 4 new tests: forced overlap with commit, with different content, with rollback; failure rolls back the request                            |
| Docs                                                                        | TD-018 (rollback method, fingerprint includes operation type, no expiry, direction rule for future types, reason rule and locale); `DATABASE_DESIGN.md` reason row; this journal (first truncate attempt and database targets)                                                                       |

Why `[[:alnum:]]`: `[^[:space:]]` would still accept a non-breaking or zero-width space (PostgreSQL treats
them as non-space). `[[:alnum:]]` refuses every whitespace and invisible variant and punctuation-only text,
and accepts English, digits, Hindi, Tamil, accented Latin and CJK (checked read-only on the test database).
It depends on `LC_CTYPE`, which is `en_US.utf8` on development, test and the CI image.

### Test database evidence (all against `ecommerce_test`)

| Step                                                | Result                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Starting point                                      | schema = the step 1 applied schema; data = the clean seed (802 natural-key lines)                                                                                                                                                                                |
| Refusals                                            | ledger script without `expected_database` → refused, exit 3; with `expected_database=ecommerce` while connected to `ecommerce_test` → refused, exit 3; type script first → refused, exit 3; type script without the variable → refused, exit 3; schema unchanged |
| Injected late failure, ledger script                | another session held its `_prisma_migrations` row `FOR UPDATE`; with `lock_timeout=1500ms` the final `DELETE` failed after 14 DDL statements had run; exit 3; schema byte-identical to before                                                                    |
| Ledger rollback (real)                              | exit 0, `COMMIT`                                                                                                                                                                                                                                                 |
| Injected late failure, type script                  | the rename, new type, column change and drop of the old type all ran, then the final `DELETE` timed out; exit 3; schema byte-identical (RECEIPT still present, no leftover `…_with_receipt` type)                                                                |
| Type rollback (real)                                | exit 0; schema identical to the pre-migration baseline (enums included); data identical; every data table hash identical; `_prisma_migrations` back to its 3 original rows (same hash)                                                                           |
| Re-apply of the edited migrations (guarded wrapper) | both applied; up to date; drift exit 0; the only schema difference from step 1 is the reason CHECK (validated against the 405 seeded movements); data and every data table hash identical; recorded checksums match the files                                    |

### Tests (Node v26.13.0, test database only)

| Command                                                                      | Result                                               |
| ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| `vitest … inventory-ledger-constraints.test.ts database-constraints.test.ts` | 23 / 23 (15 ledger, 8 existing database constraints) |
| idempotency group repeated 5 times                                           | 10 / 10 each run                                     |
| `tsc --noEmit`, `eslint` on the test file, `prettier`                        | exit 0                                               |

The overlap tests use two connections: the first inserts the request and holds its transaction open; the
second starts only then, and a third connection polls `pg_blocking_pids` until PostgreSQL reports the second
blocked by the first, before the first is released. Commit: the second inserts nothing and finds the first
request (same id; with different content it sees the stored fingerprint, the basis for 422). Rollback: the
second becomes the only request. The failure test inserts a request and a referencing movement, then hits
the stock CHECK; and inserts a request, then a guarded update matches no row and the service throws; both
leave no request, movement or stock change, and a retry with the same key then succeeds.

### Development database (not touched)

Read-only check at the end of this step: fingerprint `04adce0841b9013d69f13b043ae4a245` (unchanged); schema snapshot and
the 802 inventory and order lines identical to the start of step 1; still 3 migrations. No test server was
started in this step.

## Wave 5 step 2: inventory ledger migrations on the development database (2026-11-10, done; awaiting owner review, not committed)

**Summary.** The development migration is complete. Fingerprint before: `04adce0841b9013d69f13b043ae4a245`;
after: `9cec751c29cab1faab002a9308e23887`. Development now has five migrations applied (`init`,
`identity_constraints`, `catalogue_integrity`, `inventory_receipt_movement_type`,
`inventory_ledger_integrity`). No unexpected data changes: every existing business table is identical; only
the two new `_prisma_migrations` rows and the new, empty `inventory_change_requests` table were added.

Owner-approved apply of `20261110150000_inventory_receipt_movement_type` and
`20261110150100_inventory_ledger_integrity` to `ecommerce`, with the Wave 3 safeguards. Not done, by
instruction: no seed, reset, truncate, rollback or restore; no business-data change; no services, APIs or UI;
no commit or push. Evidence and the full command log: `~/ecommerce-backups/20261110-inventory-ledger/`
(`apply-command-log.txt`).

| Safeguard                          | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target                             | `DATABASE_URL` → `localhost:5433/ecommerce` (OrbStack → container `ecommerce-platform-postgres-1`); the same server identifier (`7705359071680872490`) through the app URL and `docker exec`; no shell override of `DATABASE_URL` or `APP_ENV`; 0 other sessions; no app server                                                                                                                                                                                                                                                                                                       |
| Backup (preparation, 17:35:57 UTC) | `ecommerce-dev-before-inventory-ledger.dump`, `pg_dump` 18.6 custom format, 196,008 bytes, mode 600, sha256 `62ff93c1878299cf82d76194de5ecca29ddeac354fc8887105135b0d3db25a30` (re-checked OK before applying). Restore verified into a throwaway `ecommerce_restore_check` (fingerprint, 46 tables, schema, 802 + 768 natural-key lines and migration rows identical), then dropped                                                                                                                                                                                                  |
| Preflight (read-only)              | 0 violations of each new CHECK over the 405 movements; no name collisions; RECEIPT absent; replaced indexes present; `en_US.utf8`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Before                             | fingerprint `04adce0841b9013d69f13b043ae4a245` (46 tables, 1,627 rows), per-table identical to the preparation baseline; exactly the two migrations pending; file checksums `bfe5ded…` and `00ef855…` equal the tested ones                                                                                                                                                                                                                                                                                                                                                           |
| Apply                              | `npm run db:deploy` (`prisma migrate deploy`), both applied 17:49:25 UTC, exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Status and drift                   | `migrate status`: up to date (5 migrations); `migrate diff --exit-code`: no difference; all 6 new constraints validated; 0 unvalidated constraints                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Schema                             | the change (38 lines added, 3 removed: old enum list and the two replaced indexes) is identical to the one tested on `ecommerce_test`; the development schema is now identical to the test schema                                                                                                                                                                                                                                                                                                                                                                                     |
| Data                               | 45 of 46 existing tables identical (row count and content hash), including stock levels, movements, orders, order lines, shipments, shipment lines, carts, cart lines, sessions and audit logs. Only `_prisma_migrations` changed (3 → 5 rows; the 3 earlier rows byte-identical); new table `inventory_change_requests` with 0 rows. 802 inventory and order lines and 768 catalogue lines identical; all 19 baseline counts identical (348 stock rows, 4,677 on hand, 10 reserved, 405 movements, 20 orders, 32 order lines, 24 shipments, 32 shipment lines, 1 cart, 2 cart lines) |
| Stop conditions                    | none hit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**New development fingerprint baseline:** `9cec751c29cab1faab002a9308e23887` (47 tables) from now on. The
previous `04adce08…` is the state before these migrations.

## Wave 5 step 2: inventory services (2026-11-10 to 2026-11-11, complete; commits `ef16d46` and `9c1f691`, pushed)

Owner-approved plan with five decisions, four improvements, four follow-up decisions and the L0b lock-order
correction, implemented in six approved checkpoints, each stopped for review. Not done, by instruction: no
HTTP routes or pages, no dispatch, cancellation or order code, no schema or migration change, no write to
development. Committed as `ef16d46` after the N1 fix and a full regression, then pushed with its
documentation follow-up `9c1f691`, each step approved by the owner. Rules and the caller contract: TD-019; ledger and idempotency: TD-018.

### What was built

| Checkpoint | Scope                                                                                                                                       | New tests                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1          | input schemas, errors, `InventoryActor` mapping, stock rules, request fingerprint, 10 audit actions                                         | 49 unit                   |
| 2          | repositories, lock helpers, runtime lock-order tracker, real-staff fixtures, warehouse service                                              | 7 unit, 35 integration    |
| 3          | idempotency wrapper, add / remove / set (ADJUSTMENT), receipts (RECEIPT), low-stock thresholds                                              | 3 unit, 43 integration    |
| 4          | internal `reserveStock`, `releaseReservation`, `applyReservationChanges` (L0b first)                                                        | 1 unit, 27 integration    |
| 5          | stock matrix, low-stock list and count, ledger, storefront availability, catalogue stock filter (D30)                                       | 2 unit, 14 integration    |
| 6          | TD-019, this entry, traceability (R11, R13, T5, T8, A2, S4, L35–L50), testing strategy, architecture, database design, handoff, full review | none (documentation only) |

Files: `src/modules/inventory/` (29 files, 6 of them unit tests); changes to `audit.types.ts`,
`identity.schema.ts` (pincode rule extracted for reuse, behaviour identical on 16 inputs),
`search-outbox.repository.ts` (two enqueue helpers) and `catalogue/product-list-query.ts` (stock filter uses
the inventory definition); integration tests `warehouses`, `inventory-locks`, `stock-adjustments`,
`stock-idempotency`, `low-stock-thresholds`, `stock-reservations`, `inventory-queries`, one added catalogue
test, and support files `inventory-fixtures.ts` and `lock-probes.ts`.

### Tests (Node v26.13.0, guarded `ecommerce_test` only)

| Suite                      | Before step 2 | After checkpoint 5 (2026-11-11)       | Full regression before the commit (2026-11-11) |
| -------------------------- | ------------- | ------------------------------------- | ---------------------------------------------- |
| `npm test`                 | 270           | **332 / 332**                         | **332 / 332**                                  |
| `npm run test:integration` | 230           | **349 / 349**                         | **351 / 351** (2 N1 regression tests added)    |
| `npm run test:http`        | 56            | not re-run (no route or page changed) | **56 / 56** (production build)                 |
| `npm run test:e2e`         | 52            | not re-run (no route or page changed) | **52 / 52** (desktop and 360 px)               |

Repeat runs (each five times in a row, every run green): checkpoint 2 lock and warehouse files (35 tests),
checkpoint 3 adjustment, idempotency and threshold files (43), checkpoint 4 reservation file (27). Mutation
checks: removing the per-shipment release check made 4 reservation tests fail (after bystander reservations
were added to three tests that had passed without it); restoring the old catalogue stock filter made the new
inactive-warehouse test fail; each file was restored byte for byte. The app's reason rule was compared with
the database rule on 23 samples across scripts: never looser (0 unsafe), stricter in 2.

Checkpoint 6 changed documentation only and wrote to no database, so the integration, HTTP and browser
suites were not run in it; unit tests, format, lint and typecheck were (see the checkpoint 6 report). A
checksum manifest of `src/`, `tests/`, `e2e/` and `prisma/` (432 files) was identical at the start and end of
checkpoint 6.

### Full review (checkpoint 6, read-only)

| Area                | Result                                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lock hierarchy      | every service follows it in source order: adjustments and receipts L1 → L5; thresholds L2 → L3 → L5; reservations L0b → L2 → L3 → L4 → L5; warehouses L4; guarded updates only after their row is locked |
| Movement writers    | `insertMovements` is the only runtime writer and is called only by the adjustment, receipt and reservation services; the seed writes history directly (L49)                                              |
| Raw SQL             | tagged templates and `Prisma.sql` fragments only; no `*Unsafe` call or `Prisma.raw` in `src/`                                                                                                            |
| Read services       | no insert, update, delete or row lock in the query repository, service or availability module                                                                                                            |
| Index use           | `EXPLAIN` (read-only, development): low-stock query uses `inventory_levels_low_stock_idx`; ledger uses its `(created_at, id)` indexes                                                                    |
| Casts               | none in the inventory module; two `?? ''` fallbacks cannot pass silently (a missing movement throws; an empty uuid fails in SQL)                                                                         |
| Issues              | none critical or high; medium: L38, L43, L47; low: L37, L41, L44, L45, L46, L49, L50 and bounded per-line queries (L41)                                                                                  |
| Documentation fixes | the traceability matrix pointed at a missing `docs/test-evidence.md`; T8 and S4 now point at this journal and the testing strategy; ARCHITECTURE.md status line updated                                  |

### Final review finding N1 and fix (2026-11-11)

The final read-only review found one medium issue, N1: `applyReservationChanges` applied the lines on one
stock row in shipment-id order, so a RESERVE could run before a RELEASE on the same row when the reserving
shipment's id sorted first. With nothing else available, a valid re-allocation (release 2 from shipment B,
reserve 2 for shipment A, same variant and warehouse) failed with 409 `OUT_OF_STOCK`.

- Fix (`reservation.service.ts`, `lineOrder` only): lines are applied by stock key, then kind (every
  RELEASE before any RESERVE on the same stock row), then shipment id. The lock hierarchy is unchanged: each
  lock helper sorts its own keys, so the comparator only decides the order in which lines are applied.
  Guarded updates, per-shipment release limits, shipment checks and standalone reserve and release calls
  are unchanged.
- Regression tests (`stock-reservations.test.ts`, two cases): 4 on hand, 2 reserved for B and 2 for an
  unrelated shipment C (0 available); one call releases 2 from B and reserves 2 for A, once with A's id
  sorting before B's and once after. Both pass: RELEASE takes reserved from 4 to 2, then RESERVE from 2 to
  4; the stock row ends at 4 on hand and 4 reserved; four movements and four audit rows match; per shipment
  the ledger holds A 2, B 0 and C 2 (C untouched).
- Mutation check: with the old comparator restored temporarily, the case where A's id sorts first failed
  and the other passed; the fixed file was then restored byte for byte.

### Full regression, commit and push (2026-11-11)

Node v26.13.0, each suite run one after another on the guarded `ecommerce_test` (test target and guard
checked first): `npm run test:integration` 351 / 351; `npm run build`, then `npm run start:test` (resets
`ecommerce_test` to the demo identity seed, as documented); `npm run test:http` 56 / 56; `npm run test:e2e`
52 / 52; `npm test` 332 / 332; `npm run format:check`, `npm run lint`, `npm run typecheck` and
`git diff --check` all exit 0. No test failed or was skipped. Committed as `ef16d46` ("Wave 5 step 2:
inventory services, reservations and query layer", 50 files, parent `f6c018b`), followed by the
documentation-only commit `9c1f691` ("Wave 5 step 2: record N1 fix, full regression and commit in docs", 5
files). Both were pushed with the owner's approval by `git push origin main` (fast-forward
`f6c018b..9c1f691`, no force). After the push local `main` and `origin/main` were both `9c1f691`, the branch
was up to date and the working tree was clean.

### Databases

Development fingerprint `9cec751c29cab1faab002a9308e23887` throughout step 2, including the full regression
(five migrations; 405 movements and 10 reserved units unchanged). During the regression a read-only
snapshot of the development migrations and per-table insert, update and delete counters was identical
before and after, and the fingerprint query in `docs/SESSION_HANDOFF.md` still matched afterwards. Only `ecommerce_test` was
written to: in checkpoints 1–5, the N1 tests and the full regression.

## Wave 5 step 3: admin inventory API (2026-11-11 to 2026-11-12, done; awaiting owner review, not committed)

Owner-approved scope: the HTTP layer over the Wave 5 step 2 services, plus the API items the step 2 review
left for this step (L37, L43, L44, L45). Not done, by instruction: no admin pages (step 4), no reservation
route, no Redis in stock paths, no schema or migration change, no write to development, no commit or push.
Decisions: TD-020.

### What was built

| Area                          | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routes (9 files, 11 handlers) | `src/app/api/admin/warehouses/route.ts` (GET, POST), `warehouses/[warehouseId]/route.ts` (GET, PATCH), `warehouses/[warehouseId]/status/route.ts` (POST), `src/app/api/admin/inventory/route.ts` (GET stock matrix), `inventory/adjustments/route.ts` (POST add, remove, set), `inventory/receipts/route.ts` (POST), `inventory/thresholds/route.ts` (PUT), `inventory/movements/route.ts` (GET ledger), `inventory/low-stock/route.ts` (GET with `totalCount`)     |
| Shared                        | `src/lib/request-idempotency.ts` (`Idempotency-Key` header: 400 `IDEMPOTENCY_KEY_REQUIRED` / `IDEMPOTENCY_KEY_INVALID`); `src/lib/db.ts` `isTransactionTimeout` (the two genuine P2028 timeouts, narrowed in the review fixes); `src/lib/errors.ts` kind `UNAVAILABLE` (503) and `TransactionTimeoutError`; `src/lib/api-handler.ts` maps them to 503 `TRANSACTION_TIMEOUT` with `Retry-After: 1`                                                                   |
| Inventory module              | `stockAdjustmentSchema` (body discriminated by `operation`); errors `ON_HAND_LIMIT_EXCEEDED` (422) and `INVALID_CURSOR` (400); `assertWithinOnHandLimit` used by add and receipt on the locked row; `receiveStock` re-parses its input; stock-matrix and ledger cursors must exist                                                                                                                                                                                  |
| Tests                         | final counts after the hardening pass and all review rounds (the sections below say which round added what): unit: `request-idempotency.test.ts` (3), `errors.test.ts` (3), `stock-rules.test.ts` (+2), `inventory.schema.test.ts` (+5); integration: `inventory-api-rules.test.ts` (7), `stock-adjustments.test.ts` (+1), `rate-limit-redis-down.test.ts` (+1); HTTP: `tests/http/inventory.http.test.ts` (25), `tests/http/inventory-rate-limit.http.test.ts` (4) |

Permissions: `inventory.read` for the 5 read routes, `inventory.write` for adjustments, receipts and
thresholds, `warehouses.write` for warehouse create, edit and status; routes check before reading input
and the services check again. Responses: create 201; adjustments and receipts 201 when applied and 200
when replayed (`stockRequest.replayed`); other writes 200. Full table: API_DOCUMENTATION.md, "Admin:
warehouses and inventory".

### Changes to existing behaviour and tests (reviewed)

- **On-hand ceiling (L44).** Add and receipt now refuse to pass 1,000,000 on hand (422), the limit set
  already had. One existing test, "rolls back a receipt whose second line fails in the database after the
  first line changed", relied on PostgreSQL's integer overflow for its second line; the ceiling now refuses
  that line first (still after the first line was applied), so its expected error changed from the
  overflow message to `ON_HAND_LIMIT_EXCEEDED` and its title to "…is refused after the first line
  changed". What it proves, the rollback of the already-applied first line, is unchanged.
- **Cursors (L37).** An unknown stock-matrix or ledger cursor is now 400 `INVALID_CURSOR` instead of an
  empty page. No existing test relied on the empty page.
- **Adjustment input validated in the service (history).** A first version re-parsed it like receipts;
  the existing test "refuses a zero change (422)" then got 400, so that version was reverted. The
  hardening pass below re-added the validation with the zero-change check first, which keeps 422
  `NO_STOCK_CHANGE` (L53 resolved).
- **Transaction timeout (L43).** Measured on `ecommerce_test`: a stock request kept waiting on a locked
  stock row for 5.5 seconds fails with Prisma P2028 and leaves stock, movements, request rows and audit rows
  unchanged; the API answers 503 `TRANSACTION_TIMEOUT` (retryable) instead of 500.

### Tests (Node v26.13.0, guarded `ecommerce_test` and `ecom:test:` only)

| Suite                                  | Before step 3 | First API version (2026-11-11, before the hardening pass and review fixes) |
| -------------------------------------- | ------------- | -------------------------------------------------------------------------- |
| `npm test`                             | 332           | **341 / 341**                                                              |
| `npm run test:integration`             | 351           | **356 / 356**                                                              |
| `npm run test:http` (production build) | 56            | **78 / 78**                                                                |
| `npm run test:e2e` (production build)  | 52            | **52 / 52** (no page changed; run to confirm)                              |

Also: `npm run build` (the 9 new routes are in the route list), `npm run format:check`, `npm run lint`,
`npm run typecheck` and `git diff --check` all exit 0. Order of runs: build, `npm run start:test`, the new
HTTP file alone (22 / 22), full `test:http`, `test:e2e`, server stopped, `npm test`, full
`test:integration`. Lint first failed on two arrow-function bodies in a new unit test; fixed, then 0.

Mutation checks (each file restored byte for byte, checked with `cmp`): removing the ceiling check from add
and receipt made both ceiling tests fail; removing the cursor check made the cursor test fail.

HTTP coverage of the first version (22 tests; the review fixes added 3 more to this file, and the hardening pass added the 3-test rate-limit file): 401 on all 11 handlers; 403 `WRONG_ACCOUNT_TYPE` for a customer session; 403
on every read for a test-only staff member with `catalogue.read` only (created on `ecommerce_test` with a
copied demo password hash); support, catalogue manager and order operations can read but get 403 on all 6
writes, with the ledger, stock and warehouse unchanged; 403 `ORIGIN_NOT_ALLOWED` for another-site and
missing `Origin` on all 6 writes; 404 on the store host; 400 for malformed JSON, unknown fields, bad UUIDs
and bad query values; 400 `INVALID_CURSOR`; 400 for a missing or malformed `Idempotency-Key` with nothing
applied; 404 for unknown warehouses and variants (a receipt with one unknown line applies nothing); 409
`WAREHOUSE_CODE_TAKEN`, `STALE_STOCK` and `STOCK_BELOW_RESERVED`; 422 `NO_STOCK_CHANGE`,
`ON_HAND_LIMIT_EXCEEDED` and `IDEMPOTENCY_KEY_REUSED` (other content, other operation, or a receipt under an
adjustment's key); replay 200 with the same `changeRequestId` and movements; the same key from another
staff member is a new change; 10 identical concurrent requests → one 201 and nine 200, stock changed once;
8 concurrent one-unit removals with 5 on hand → five 201 and three 409, ending at 0; 4 concurrent receipts
and 4 additions on the same rows → all 201, ledger total 24; thresholds, low stock with `totalCount` and
the inactive-warehouse rule; ledger filters and cursor paging without gaps or repeats; matrix search and
paging; repeated reads leave the ledger, stock and warehouse unchanged.

### Databases

Development fingerprint `9cec751c29cab1faab002a9308e23887` before and after every run (five migrations,
write counters 1,629 / 1,023 / 0 unchanged). Only `ecommerce_test` was written to, through the guarded
harness (`start:test` reset and seed, integration truncates, the HTTP helper `runOnTestDatabase`).

### Remaining limitations

L35, L36, L38–L43, L46–L50, L52, L54 and L55 (`docs/REQUIREMENTS_TRACEABILITY.md`). Added during step 3:
L52 with the API (2026-11-11; low-stock `totalCount` is a second query), L54 in the review fixes
(2026-11-12; adjustment fingerprints include the letter case of ids) and L55 in the final review
remediation (2026-11-12; warehouse audit rows keep the path id's letter case). L51 and L53, recorded with
the API, were resolved in the hardening pass below.

### Hardening pass (2026-11-11)

- **Write rate limit (L51).** New action `inventory-write` in the Wave 2A limiter (no new mechanism: Redis
  atomic counter, Postgres fallback, fixed windows, SHA-256 hashed bucket keys). Policy: 60 writes per 60
  seconds per staff member in development, staging and production; 200 per 20 seconds in
  `config.test.json`. `src/modules/inventory/inventory-rate-limit.ts` (`limitInventoryWrites`) is called by
  all six write handlers right after `requirePermission` and before the `Idempotency-Key` and body; the
  five read handlers are not limited. Files: `src/lib/config/config.schema.ts`, the four
  `config/config.<env>.json`, the six write route files.
- **Adjustment input validated in the service (L53).** Callers of `addStock`, `removeStock` and `setStock`
  in `src/`: only `POST /api/admin/inventory/adjustments`, which parses the strict
  `stockAdjustmentSchema`; integration tests also call them directly. The service now parses its input with
  the strict schemas after the zero-change check, so 422 `NO_STOCK_CHANGE` is unchanged (its existing test
  still passes) and a padded or differently ordered repeat replays instead of answering 422.
- **Reservation header comment** in `reservation.service.ts` now documents the apply order (by stock row,
  every RELEASE before any RESERVE, then by shipment) and that it never changes the lock order. No code
  changed there.
- **New tests:** HTTP `tests/http/inventory-rate-limit.http.test.ts` (3: 429 with `Retry-After` on all six
  write routes for one staff member while reads and a colleague are unaffected; 401 for an anonymous and
  403 for a read-only caller, one request each, which did not yet prove the order (see the third review
  remediation below); a limited request applies nothing and a retry with the same key after `Retry-After` applies once,
  then replays); integration (2: service validation and 422 kept; the `inventory-write` limit with Redis
  really unreachable falls back to Postgres, enforces 200 + 1, isolates a second staff id, and stores only
  `inventory-write:<64 hex>` bucket keys).
- **Mutation check:** without the service validation the new L53 test fails (restored byte for byte).
- **Results:** `npm test` 341 / 341; `npm run test:integration` 358 / 358; `npm run build` exit 0;
  `npm run test:http` 81 / 81; `npm run test:e2e` 52 / 52; format, lint, typecheck and `git diff --check`
  exit 0. Development fingerprint `9cec751c29cab1faab002a9308e23887` before and after.

### Review fixes (2026-11-12)

The independent read-only review of step 3 returned NOT READY FOR COMMIT with findings F1–F5 and two
suspicions, S1 and S2. All were addressed; nothing from step 4 was started.

| Finding                                                                                                                              | Status                   | Change                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 (medium): an upper-case variant id in a receipt gave 500, and the same variant twice in different case passed "each variant once" | fixed                    | `inventory.schema.ts`: `lowerCaseVariantIdSchema` and `lowerCaseWarehouseIdSchema` (lower-case, then the shared branded schema) for receipt lines and warehouse; `receiveStock` already re-parses                                                                                                                                     |
| F2 (low): an upper-case id on `PUT /thresholds` gave 404                                                                             | fixed                    | the same schemas for `setLowStockThresholdSchema`; `setLowStockThreshold` now parses its input too                                                                                                                                                                                                                                    |
| F3 (low): every Prisma P2028 was treated as a retryable timeout                                                                      | fixed                    | `src/lib/db.ts` `isTransactionTimeout` matches only "cannot be executed on an expired transaction" and "Unable to start a transaction in the given time" (Prisma 7.10.1 messages, read from `runtime/client.js`); `api-handler.ts` logs a genuine timeout at warn with the original message; any other P2028 is a 500 logged at error |
| F4 (low): docs contradicted the code                                                                                                 | fixed                    | stale adjustment bullet, L51 in the remaining list, warehouse-create retry semantics (409 safe duplicate, not a replay), 503 wording, letter-case behaviour (receipts and thresholds normalised; adjustments case-sensitive, L54)                                                                                                     |
| F5 (low): weak tests                                                                                                                 | fixed                    | exact `ZodError` instead of bare `rejects.toThrow()` (two places); a genuine PostgreSQL failure on a receipt's second line after the first was applied (test-only trigger, dropped in `finally`); HTTP 503 end to end; exact SHA-256 bucket keys instead of an assertion that could not fail                                          |
| S1: rate-limit HTTP tests on `next dev`                                                                                              | not reproduced; hardened | routes warmed first (401, outside the budget); bursts start in a fresh window and assert they stayed in it. On a cold `next dev` the first hits took 130–570 ms (about 1.8 s in all) and happened during warm-up; the rate-limit file passed 3 / 3 and `npm run test:http:dev` 84 / 84                                                |
| S2: pool contention turning into 503                                                                                                 | not reproduced; reduced  | bursts cut from 25 to 10 (pool 20). Three full `npm run test:http` runs in a row on one server: 84 / 84 each; the server log shows only the deliberate expired-transaction timeouts (one per run), no "Unable to start a transaction" and no unhandled error                                                                          |

New tests: unit +4 (precise P2028 cases; lower-casing and case-variant duplicates; adjustment ids keep
their case); integration +2 (upper-case ids by a direct caller; the real database failure mid-receipt);
HTTP +3 (upper-case receipt and threshold with a lower-case replay; a case-variant duplicate receipt
refused with nothing written and its key still free; 503 `TRANSACTION_TIMEOUT` with a real held row lock,
then the same key applied once and replayed). The timeout integration test now also checks the
expired-transaction message.

Mutation checks (files restored byte for byte; both mutations were applied in the same run): without the
lower-casing, 2 unit tests ("lower-cases receipt and threshold ids" and "refuses a receipt naming the same
variant twice in different letter case") and the upper-case integration test fail; with every P2028
counted as a timeout, 1 unit test ("does not treat other P2028 errors, other codes or plain errors as
timeouts") fails. That run showed 3 failed unit tests in all: 2 from the first mutation, 1 from the
second. The HTTP tests were not part of the mutation runs.

Results: `npm test` 345 / 345; `npm run test:integration` 360 / 360; `npm run build` exit 0;
`npm run test:http` 84 / 84 (three times); `npm run test:e2e` 52 / 52; `npm run test:http:dev` 84 / 84 on
`npm run start:test:dev`; format, lint, typecheck and `git diff --check` exit 0. The test-only trigger and
function are absent from `ecommerce_test` afterwards. Development fingerprint
`9cec751c29cab1faab002a9308e23887` before and after.

### Final review remediation (2026-11-12)

The second independent read-only review found F1–F5 fixed and every invariant intact, and listed low
findings N1–N4 (verdict NOT READY FOR COMMIT). Addressed as follows; no production behaviour changed.

- **N2 (fixed): window guard before the 429 assertions.** In `tests/http/inventory-rate-limit.http.test.ts`
  `expectSameWindow(window)` now runs right after each response arrives and before its status check (all
  six write routes in the first test, the over-budget write in the second, the refused adjustment in the
  third), so a window crossing fails with "the requests crossed a rate-limit window boundary". Every 429
  assertion is kept.
- **N3 (fixed): failure-safe test-only cleanup.**
  - `holdRowLocksOnTestDatabase` (`tests/http/support/test-database-writer.ts`): if `BEGIN`, the lock
    query or the pid query fails, it rolls back, closes the connection and rethrows the original error.
    Checked with a scratch script passing invalid SQL: the original error ("relation … does not exist")
    came back, the script exited by itself and no session remained on `ecommerce_test`.
  - The database-failure receipt test (`tests/integration/stock-adjustments.test.ts`): asserts the
    connected database is a `_test` one before any DDL, drops leftovers first, creates the function and
    trigger inside the protected block, drops whatever exists in `finally` (a cleanup error is raised only
    if the test itself passed, so it never hides the original failure) and then asserts no test-only
    trigger or function remains. Checked by temporarily pointing the trigger at a missing function: the
    test failed with PostgreSQL's original error, 0 test triggers and 0 test functions remained, and the
    file was restored byte for byte.
- **N4 (fixed): documentation evidence.** Final test counts per file (checked against the files:
  `errors.test.ts` 3, `inventory-api-rules.test.ts` 7, `inventory.http.test.ts` 25,
  `inventory-rate-limit.http.test.ts` 3, plus +2, +5, +1 and +1 in existing files), the first-version
  counts labelled as such, the lower-casing mutation count corrected to 2 unit tests plus 1 integration
  test (the third unit failure in that run came from the simultaneous timeout mutation), L52 attributed
  to the API work in both the journal and the handoff, and the handoff dated 2026-11-12.
- **N1 (documented, not changed): L55.** `warehouse.service.ts:141` and `:168` write the audit
  `entity_id` from the path id exactly as sent, so an upper-case id is stored upper case and a lookup by
  the lower-case id does not find it; the catalogue services do the same. Recorded in the traceability
  limitations, TD-020 and the API documentation, for the audit viewer (Wave 10) or a later id step.

Results (Node v26.13.0): `npm test` 345 / 345; `npm run test:integration` 360 / 360; `npm run build` exit
0; the two inventory HTTP files 28 / 28; `npm run test:http` 84 / 84; `npm run test:e2e` 52 / 52; format,
lint, typecheck and `git diff --check` exit 0. The server log showed only the two deliberate
expired-transaction timeouts (one from the focused run, one from the full run), no "Unable to start a
transaction" and no unhandled error. No test-only trigger or function remains in `ecommerce_test`.
Development fingerprint `9cec751c29cab1faab002a9308e23887` before and after; no new tests were added in
this round, so the counts are unchanged.

### Third review remediation (2026-11-12)

The third independent read-only review confirmed the production code and every invariant and found one low
test-coverage gap (R1) and three documentation corrections (R2–R4). No production code changed.

- **R1 (fixed): permission before the rate limit, proven.** New HTTP test in
  `tests/http/inventory-rate-limit.http.test.ts`, "refuses a read-only staff member with 403 every time, past
  the whole budget, without using any of it": a staff member whose role has only `inventory.read` sends
  `maxRequests + 1` (201) writes in one window, in bursts of 10, and every one must be 403
  `PERMISSION_DENIED` and not 429; then `inventory.write` is added to that role (permissions are read per
  request), and the next write by the same session in the same window gets 400 `IDEMPOTENCY_KEY_REQUIRED`.
  That proved the reversed order fails, but not that the refused requests used none of the budget: one
  allowed write only shows at most 199 of them were counted (corrected in the fourth review remediation
  below, which also renamed the test). The window is checked after each burst and before the final
  status. The earlier anonymous and read-only test is kept unchanged. Helpers `newStaff`,
  `grantPermission` and `roleCode` replace the fixed permission list inside `newInventoryStaff`, which keeps
  its permissions. Mutation check: with `requireStaff`, then `limitInventoryWrites`, then
  `assertStaffPermission` in `src/app/api/admin/inventory/adjustments/route.ts` (production build rebuilt
  and served), the new test failed with "expected 429 not to be 429"; the route was restored byte for byte
  and rebuilt before the runs below.
- **R2 (fixed):** `docs/REQUIREMENTS_TRACEABILITY.md` last update 2026-11-12.
- **R3 (fixed):** TD-020 now states the handler order: origin check, session and permission
  (`requirePermission`), inventory write rate limit (write routes only), `Idempotency-Key` (adjustments and
  receipts), input validation, then the service, which checks the permission again. TD-020's rate-limit
  bullet names the test that proves the order.
- **R4 (fixed):** TD-019's risk list names only the open limitations from that step: L35, L36, L38–L43 and
  L46–L50 (L37, L44 and L45 resolved in step 3; the API's own L52, L54 and L55 are under TD-020), checked
  against the traceability table.

Results (Node v26.13.0): `npm test` 345 / 345; `npm run test:integration` 360 / 360; `npm run build` exit 0
(rebuilt after the mutation check); the rate-limit HTTP file 4 / 4; `npm run test:http` 85 / 85;
`npm run test:e2e` 52 / 52; `npm run test:http:dev` 85 / 85 on `npm run start:test:dev`; format, lint,
typecheck and `git diff --check` exit 0. The server log showed one deliberate expired-transaction timeout,
no "Unable to start a transaction" and no unhandled error. Development fingerprint
`9cec751c29cab1faab002a9308e23887` before and after.

### Fourth review remediation (2026-11-12)

The fourth independent read-only review confirmed the code, R1–R4 and every invariant, and found that the
R1 evidence was overstated (Q1): one allowed write after the grant shows only that at most 199 of the 201
refused writes were counted, not that none were. It also noted a handoff heading (Q3), two testing-strategy
lines (Q4), a test fixture's wording (Q5) and that only the adjustments route was tested (Q2). No production
code changed.

- **Q1 and Q2 (fixed): the whole budget remains, on two routes.** The test in
  `tests/http/inventory-rate-limit.http.test.ts` is now "checks permission before the budget on adjustments
  and warehouse writes: 201 refused writes leave the whole budget of 200". A staff member with only
  `inventory.read` sends `maxRequests + 1` (201) writes alternating between `POST
/api/admin/inventory/adjustments` and `PATCH /api/admin/warehouses/{id}`: every one 403
  `PERMISSION_DENIED`, never 429. After `inventory.write` is granted to the same role, the same session
  sends exactly `maxRequests` (200) adjustments: every one 400 `IDEMPOTENCY_KEY_REQUIRED`; the next is 429
  `RATE_LIMITED` with `Retry-After` between 1 and 20 seconds equal to `details.retryAfterSeconds`. The
  window is checked after every burst and before every status assertion, all in one window. Since the
  limiter allows a count of at most 200, 200 allowed writes followed by a 429 prove the refused writes were
  never counted. The earlier anonymous and read-only test is unchanged; no timeout or configuration
  changed (the file took about 22 seconds).
- **Mutation checks (production build rebuilt and served for each, routes restored byte for byte and
  rebuilt afterwards):** with `requireStaff`, then `limitInventoryWrites`, then `assertStaffPermission` in
  the adjustments route, the test failed with "expected 429 to be 400" (the 101 refused adjustments had
  used budget); the same reversal in `src/app/api/admin/warehouses/[warehouseId]/route.ts` (PATCH) failed
  the same way. The other four write routes follow the same code order, verified by reading.
- **Q3 (fixed):** the handoff heading now says it was updated after the fourth review remediation.
- **Q4 (fixed):** `docs/TESTING_STRATEGY.md` lists the route-order mutation, and the timed-window bullet
  says the window is checked before the status assertion it guards (an expected 429, 403 or 400).
- **Q5 (fixed):** `src/lib/errors.test.ts` uses the real Prisma 7.10.1 template for the nested-transaction
  P2028 message ("Nested transactions are not supported by adapter … : createSavepoint is not
  implemented."), and its comment says placeholders hold example values.
- The R1 entry above, TD-020 and the handoff now say what the evidence proves.

Results (Node v26.13.0): `npm run build` exit 0 (on the restored code); the rate-limit HTTP file 4 / 4;
`npm run test:http` 85 / 85; `npm run test:e2e` 52 / 52; `npm run test:http:dev` 85 / 85 on
`npm run start:test:dev`; `npm test` 345 / 345; `npm run test:integration` 360 / 360; format, lint,
typecheck and `git diff --check` exit 0. The server log showed one deliberate expired-transaction timeout,
no "Unable to start a transaction" and no unhandled error. Development fingerprint
`9cec751c29cab1faab002a9308e23887` before and after. Test counts are unchanged (the test was rewritten, not
added).

## Wave 5 step 4: admin inventory pages (2026-11-12, done; awaiting owner review, not committed)

Owner-approved scope: the admin UI over the step 2 services and step 3 API. No API, service, schema or
migration change; no development database write. Decisions: TD-021.

### What was built

| Page (admin host)      | Who sees what                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/warehouses`          | list with code, address, contact, priority and status; create and edit in a dialog (field errors from the shared schemas); activate or deactivate after a confirmation that says what happens to stock and reservations. Write controls need `warehouses.write`.                                                                                                                                                          |
| `/inventory`           | stock matrix by product → variant → warehouse with on hand, reserved, available, alert level and an in stock / low stock / out of stock badge; search, warehouse filter, low-stock only, paging; per variant: Adjust (add, remove, set counted quantity, with reason), Threshold, History; per product: Receive stock (one warehouse, a quantity per variant, supplier reference). Write controls need `inventory.write`. |
| `/inventory/movements` | the ledger, newest first: type, SKU, product, warehouse, signed change, on hand and reserved before → after, reason, reference, actor, time in IST; filters for warehouse, type, from and to dates (IST calendar days), and a variant (from History links); paging                                                                                                                                                        |
| `/inventory/low-stock` | rows at or below their alert level with the total, warehouse filter, inactive warehouses on request, links to the stock view for that SKU and warehouse; paging                                                                                                                                                                                                                                                           |
| `/` (dashboard)        | a Low stock tile with the count and the first five rows of the low-stock list (by warehouse), for staff with `inventory.read`                                                                                                                                                                                                                                                                                             |

Files: pages `src/app/admin/{warehouses,inventory,inventory/movements,inventory/low-stock}/page.tsx` and
`src/app/admin/inventory/inventory-page-parts.tsx`; components in
`src/components/organisms/InventoryAdmin/` (`WarehouseManager`, `StockFilters`, `StockMatrix`,
`StockDialogs` with the adjust, receive and threshold dialogs, `MovementFilters`, `MovementList`,
`LowStockFilters`, `LowStockList`, `LowStockTile`, `inventory-actions`, `inventory-format`,
`idempotency-key`, `inventory-types`). Shared changes: `sendJson` takes extra headers
(`src/lib/api-client.ts`); icons `warehouse` and `history`; four menu entries (Inventory, Low stock, Stock
movements, Warehouses; `inventory.read`); the sidebar highlights only the most specific matching entry
(`active-navigation.ts`); the access-denied text no longer names the catalogue.

Behaviour worth knowing:

- **Idempotency.** The stock view keeps an `Idempotency-Key` per distinct change while the page is open
  (not per dialog): sending the same change again, also from a reopened dialog, reuses its key and is
  replayed; a different change gets its own key; a confirmed change is forgotten. See the review fixes
  below.
- **Conflicts.** A set states the on-hand quantity the dialog shows. If it changed meanwhile, the 409 is
  shown with both numbers, the page refreshes behind the dialog, the dialog shows the new number, and
  submitting again sends a new request. Removing more than is on hand, passing the 1,000,000 ceiling, rate
  limits and timeouts each have a plain message; server errors never show internals.
- **RBAC.** Read-only roles get no write buttons (they are not rendered) and a "You can view … but not
  change it" line; staff without `inventory.read` get the access-denied state and no menu entries. Every
  change is still checked by the API.
- **Invalid URLs.** Bad filters or a stale page cursor show a notice and the first page instead of an
  error.
- Numbers use en-IN grouping (12,34,567); times are shown in IST. No currency appears in these pages.

### Tests

| Suite                      | Before step 4 | After step 4 (2026-11-12)                                                                                                                |
| -------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                 | 345           | **360 / 360** (+15: formatting and IST date bounds 5, idempotency keys 4, failure messages 3, active navigation 2, `sendJson` headers 1) |
| `npm run test:integration` | 360           | **360 / 360** (no service change)                                                                                                        |
| `npm run test:http`        | 85            | **91 / 91** (+6, `tests/http/inventory-pages.http.test.ts`)                                                                              |
| `npm run test:e2e`         | 52            | **66 / 66** (+7 tests × desktop and 360 px, `e2e/inventory.spec.ts`)                                                                     |

HTTP page tests: the inventory manager sees all four pages with their write controls and the dashboard tile;
bad filters and unknown cursors fall back with a notice; support sees every page with no write control;
staff with only `catalogue.read` get the access-denied state on all four pages and no menu entries or tile;
anonymous visitors are redirected to sign-in.

Browser tests (desktop and 360 px, no page errors, no CSP violations, no horizontal overflow): an inventory
manager creates a warehouse (validation first), edits, deactivates and reactivates it with confirmation;
receives stock for two variants (an empty receipt is refused first); a removal beyond on hand is refused
with the number, a smaller one works; sets a counted quantity and an alert level that makes a variant low;
sees the three changes in the variant's history and filters by type; finds the low variant from the
dashboard tile. Two sessions: a counted quantity based on an old screen is refused with both numbers, the
dialog then shows the new quantity, and resubmitting applies. Support sees stock and warehouses without any
write control.

Browser-test stability, investigated rather than retried:

- On desktop, one full parallel run clicked "Deactivate <name>" right after renaming the warehouse, before
  the list refreshed; the old card's button ("… draft") matched the name as a prefix. The test now waits
  for the renamed card and matches button names exactly.
- At 360 px the success toast covers the next button, so Playwright waits about 5 seconds for it to go
  before each click (seen in the trace as 5-second gaps between requests). Seven such waits brought the
  first long test to the 30-second limit once under load. The test was split into three serial tests (no
  timeout raised); the longest now takes about 18 seconds at 360 px. The toast is a normal transient
  overlay, so the UI was not changed.
- The existing catalogue browser test failed once ("Product activated" toast not seen within 5 seconds,
  desktop) in one full run; no trace was kept for it, so the cause is not known. It did not recur in six
  later full runs or in single runs. Repeating that spec with `--repeat-each` is not a valid check: it
  reuses its run id and its second creation is refused with 409 (seen in the trace).
- After these changes: three full browser runs in a row, 62 / 62 each (before the review fixes below).

### Review fixes (2026-11-12)

One independent read-only review found three medium and five low issues (verdict NOT READY FOR COMMIT).
All were fixed in one round; no API, service or schema changed.

| Finding                                                                                                                                                                          | Fix                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1: with a warehouse filter, the adjust and threshold dialogs offered other warehouses and showed 0 for them (the page only had the filtered rows), so a set there always failed | with a filter the dialogs offer only that warehouse (`StockMatrix`); L35 text corrected                                                                                                                                     |
| M2: the key lived in the dialog, so closing and reopening it after a lost answer sent a new key and could apply twice; "Nothing was changed" was claimed for any 5xx             | keepers live in `StockMatrix` per variant and product, map each change to its key and forget it once confirmed; after a network error or 5xx (not a timeout) the message says the outcome is unknown and the page refreshes |
| M3: a warehouse edit sent every field and could overwrite a colleague's change to another field                                                                                  | only changed fields are sent; saving with no change says so                                                                                                                                                                 |
| L1: after a refresh that took the variant out of view, the dialogs kept stale numbers                                                                                            | they say so and do not submit                                                                                                                                                                                               |
| L2: the tile said "lowest" but shows the list's first rows                                                                                                                       | wording corrected                                                                                                                                                                                                           |
| L3: filter forms kept old values after Clear                                                                                                                                     | filter forms are keyed by the URL                                                                                                                                                                                           |
| L4: History link name, receive-line errors not announced, the 100-line error not shown, old errors kept after a change, edit error reappearing on the page                       | `History of <SKU>`; line errors in an alert; schema line errors shown; errors cleared on change; edit errors cleared on close                                                                                               |
| L5: weak or flaky HTTP assertions                                                                                                                                                | badge matched exactly; movements filtered by variant; menu checked by `href`                                                                                                                                                |
| Info                                                                                                                                                                             | movements page keeps `limit` in page links; on-hand grid wraps to two columns below 640 px                                                                                                                                  |

New tests: a unit test for keepers (an earlier change keeps its key; a confirmed change is forgotten) and two
browser tests per project: a lost answer (the first adjustment is applied but the browser gets 502), then the
same change resent from a reopened dialog must be a 200 replay with stock unchanged, plus the filtered
dialog offering one warehouse; and a warehouse edit that keeps a colleague's concurrent change.

Mutation checks (production build rebuilt and served, files restored byte for byte and rebuilt): with
partial edits replaced by sending every field, the concurrent-edit test failed; with a new keeper per dialog
opening, the lost-answer test first passed because its last check read the page before the refresh, so it
was strengthened to assert the replay itself (200 with `replayed: true`) and to reload before checking
stock; it then failed as expected ("Expected: 200, Received: 201").

Results (Node v26.13.0): `npm test` 360 / 360; `npm run test:integration` 360 / 360; `npm run build` exit 0;
`npm run test:http` 91 / 91; `npm run test:e2e` 66 / 66 twice in a row; `npm run test:http:dev` 91 / 91;
format, lint, typecheck and `git diff --check` exit 0. Development fingerprint
`9cec751c29cab1faab002a9308e23887` before and after.

## Wave 5 step 5: dispatch and restock primitives, Wave 5 close-out (2026-11-12, done; awaiting owner review, not committed)

Starting point: HEAD and `origin/main` at `77e9a9b` (step 4), clean tree. No step 5 was recorded anywhere, and
`docs/SESSION_HANDOFF.md` still called step 4 uncommitted. A comparison of plan section 12 (Wave 5) with
the code found two gaps: the inventory functions `dispatchReservedStock` and `restockReturnedQuantity` did
not exist (TD-019 item 6 and L40 had left them for Wave 9), and D24's "pickup registration with courier"
had no schema or tracking entry. The owner chose to build the two functions now and then close Wave 5
(2026-11-12). Decisions: TD-022. No schema change, no migration, no HTTP route, no development write.

### What was built

| Function                                  | Caller (wave) | Effect                                                                                                                        | Refused with                                                                                                                         |
| ----------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `dispatchReservedStock`                   | shipments (9) | on hand and reserved −q, `DISPATCH` movement (reference the shipment), audit `inventory.stock_dispatched`, no search update   | 409 `RESERVATION_EXCEEDED` above what the shipment still has reserved; 422 `RESERVATION_REFERENCE_INVALID` for a wrong shipment      |
| `restockReturnedShipment` (RTO received)  | shipments (9) | on hand +q at the shipment's own warehouse, `RTO_RESTOCK`, audit `inventory.shipment_restocked`, search update                | 409 `RESTOCK_EXCEEDED` above dispatched − already restocked; 422 for another warehouse; 422 `ON_HAND_LIMIT_EXCEEDED` above 1,000,000 |
| `restockCustomerReturn` (customer return) | returns (12)  | on hand +q at the return's receiving warehouse (row created if missing), `RETURN_RESTOCK`, audit `inventory.return_restocked` | 409 `RESTOCK_EXCEEDED` above the return's listed quantity − already restocked; 422 `RESTOCK_REFERENCE_INVALID`; ceiling as above     |

The plan's single `restockReturnedQuantity` became the last two (plan rule 19: no flag that switches
behaviour; the sources differ in reference, warehouse and limit). New files: `stock-dispatch.service.ts`,
`stock-restock.service.ts`, `line-movements.ts` (typed movement kinds: one movement and one audit row per
line), `shipment-references.ts` (the shipment check, moved out of `reservation.service.ts`),
`return-request-reference.repository.ts`. Changed: grouped ledger-limit queries in
`inventory-movement.repository.ts` (`remainingReservedForShipments`, `restockableForShipments`,
`restockableForReturnRequests`; the release path now uses the grouped query too), `dispatchQuantity` in
`stock-level.repository.ts`, line schemas and errors, `ReturnRequestId`, three audit actions, the ledger
label "Return request". The test-only simulated dispatch in `stock-reservations.test.ts` was removed; its
two tests now run against `dispatchReservedStock` in the new `stock-dispatch-restock.test.ts`.

Close-out: plan Wave 5 "Done when" checked against the code (stock per warehouse visible; every change in
the ledger with before → after) and every listed test mapped to an existing one (below-zero adjustment 409:
`stock-adjustments.test.ts` and `database-constraints.test.ts`; reserved > on hand impossible:
`database-constraints.test.ts`; concurrent adjustments: 20 parallel removals; deactivated warehouse excluded
from availability: `inventory-queries.test.ts`, `catalogue-products.test.ts`; ledger row per change: every
stock service test). New: `docs/walkthroughs/wave-5.md`; TD-022; L59 (D24 courier pickup, Wave 9) and L60
(no return-request lock, Wave 12); L40 and L41 reworded; traceability R11, R13, T5, T8, X2 and A4 updated.

### Infrastructure

The containers were stopped (OrbStack down). After the owner started OrbStack, `docker ps -a` still showed all
three `Exited` 11 hours earlier and nothing listened on 5433, so the three existing containers were started
with `docker start` (not recreated) at about 08:32 UTC; all three healthy.

### Tests (Node v26.13.0, guarded `ecommerce_test` and `ecom:test:` only)

| Suite                      | Before step 5 | After step 5 (2026-11-12)                                                                             |
| -------------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| `npm test`                 | 360           | **363 / 363** (+3 line-schema tests)                                                                  |
| `npm run test:integration` | 360           | **390 / 390** (+32 in `stock-dispatch-restock.test.ts`, −2 moved out of `stock-reservations.test.ts`) |
| `npm run test:http`        | 91            | **91 / 91** (production build)                                                                        |
| `npm run test:e2e`         | 66            | **66 / 66** (production build, desktop and 360 px)                                                    |

First full run before the review: 363 unit, 383 integration, 91 HTTP, 66 browser. `npm run build`, `format:check`,
`lint`, `typecheck` and `git diff --check` exit 0 before and after the review fixes.

Mutation checks (each file restored byte for byte, checked with `cmp`): without the per-shipment dispatch
check 3 tests fail; without the restock limit 4; without the dispatch's shipment lock 3; with limits
checked during the updates instead of before them 4; without adding up lines on one stock row for the
ceiling 1; without the customer-return check before the stock row is created 1. (The first attempt at the
ceiling mutation did not apply because Prettier had wrapped the line; it was redone and failed as expected.)

### Review (one independent read-only review) and fixes (one round)

Verdict READY FOR OWNER REVIEW: no high or medium findings; eight low and three informational. All but
one were fixed in one round; the reused error code was documented instead.

| Finding                                                                                                                                 | Fix                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TD-019 still said only adjustment, receipt and reservation services write movements                                                     | TD-019 names the dispatch and restock services                                                                                                                                                                                         |
| A second inventory call in one transaction fails with `LockOrderViolation` (the tracker never goes back up)                             | written into TD-022: one inventory call per transaction, with Wave 9's partly-dispatched RTO case noted                                                                                                                                |
| A customer-return restock of a variant that does not exist hit a foreign-key error (500) when creating the stock row                    | the limit is checked once before the row is created (409 `RESTOCK_EXCEEDED`) and again under the lock; test added                                                                                                                      |
| Lines were checked while updating, so a caller that caught the refusal and committed would keep earlier lines' stock changes unledgered | every line (limit and ceiling, added up per stock row) is checked before the first update; two tests where the caller catches and commits: nothing changes                                                                             |
| Ledger limits ran one query per line (plan rule 3)                                                                                      | one grouped query per call, also for releases; the grouped query's −0 for "nothing dispatched" was caught by a test and fixed                                                                                                          |
| Concurrency tests: the mixed run checked no outcomes; the return-restock run did not check refusal codes                                | outcomes, refusal codes and per-shipment limits (remaining reserved ≥ 0, restockable ≥ 0) asserted                                                                                                                                     |
| Missing cases                                                                                                                           | added: limit across a changed receiving warehouse, return restock into an inactive warehouse and for an archived product, upper-case ids for both restocks, two shipments in one dispatch on one stock row (audit before-values chain) |
| Movement type, reference type, audit field and action were independent arguments                                                        | one typed map per movement kind (`line-movements.ts`)                                                                                                                                                                                  |
| L60 named only the receiving warehouse                                                                                                  | also the return's item quantities, and the RTO-plus-return double restock that return eligibility must prevent                                                                                                                         |
| `RESERVATION_REFERENCE_INVALID` reused for dispatch and RTO                                                                             | kept (internal callers branch on the reason); documented in TD-022                                                                                                                                                                     |
| Walkthrough said every restock is checked against a shipment                                                                            | corrected                                                                                                                                                                                                                              |
| Header comments longer than one line                                                                                                    | shortened to three lines each (same precedent as `reservation.service.ts`)                                                                                                                                                             |

### Databases

Development fingerprint `9cec751c29cab1faab002a9308e23887` at 08:33 UTC (before any test) and at 08:50 UTC
(after everything); development and test each record five migrations; 0 non-test Redis keys. Test servers
stopped; ports 3000, 3100 and 3200 free.

## 2026-11-14 — Waves 6–10 (storefront, cart, checkout, fulfilment, admin)

Owner decisions (this session): canonical P0 scope plus hardening/docs; simulated online gateway alongside
COD; L31 snapshot columns; owner starts Docker; migration approved for the **test database only**.
Walkthrough: `docs/walkthroughs/wave-6-10.md`; decisions TD-023 to TD-026; API in
`docs/API_DOCUMENTATION.md`.

### Found before starting

- Uncommitted Wave 6 pages were outside `src/app/store/` (unreachable through the proxy) and
  `npm run typecheck` failed with 17 errors (output kept in this session). Rebuilt under `src/app/store/`.
- The requested "Wave 7 auth/account" is canonical Wave 2B (`f2c40ab`, already done).
- OrbStack was down; the three containers stayed `Exited` throughout this entry.

### Migration (prepared, not applied anywhere yet)

`prisma/migrations/20261114090000_order_snapshots_online_payment` + rollback
`prisma/rollbacks/20261114090000_order_snapshots_online_payment.down.sql` + review sheet
`docs/migrations/20261114090000.md`. The development database is untouched.

### Static verification (Node v26.13.0)

| Command                | Result                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`    | exit 0                                                                                                                                                                            |
| `npm run lint`         | exit 0 (0 warnings)                                                                                                                                                               |
| `npm run format:check` | "All matched files use Prettier code style!"                                                                                                                                      |
| `npm test`             | 49 files, **426 / 426** passed (was 363)                                                                                                                                          |
| `npm run build`        | exit 0, 82 routes (first attempt failed: `/store/account` prerender reached the database through the cached category tree; fixed with `connection()` in the catalogue components) |

### Database-backed verification (after the owner started the containers, ~06:10 UTC)

1. Development fingerprint before anything: `9cec751c29cab1faab002a9308e23887` (baseline).
2. Read-only checks on `ecommerce_test` (review sheet): L22 mismatches 0, missing variants 0, malformed
   order keys 0.
3. `DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy` → "All migrations have been successfully
   applied" (test database only). `prisma migrate diff --from-config-datasource --to-schema` → empty
   migration (no drift).

| Suite                                | First run                                                                                                              | Final (run twice)                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `npm test`                           | 426                                                                                                                    | **430 / 430** (+4 route-check tests)     |
| `npm run test:integration`           | 433 / 440: 6 fixture failures (my `createShopper` reused one phone number; `customers.phone` is unique), 1 real defect | **440 / 440** (was 390)                  |
| `npm run test:http`                  | 99 / 101: unknown product page answered 200; existing admin 404 test hit the new `/orders/[orderId]` route             | **101 / 101** (was 91)                   |
| `npm run test:e2e`                   | 65 passed, 2 failed, 5 not run                                                                                         | **72 / 72** (was 66), desktop and 360 px |
| typecheck, lint, format:check, build | exit 0                                                                                                                 | exit 0                                   |

Defects found by the new tests and fixed:

- **Lost unit under concurrency (acceptance test 2).** 10 parallel checkouts for 3 units split 2 + 1 over two
  warehouses placed only 2 orders: every checkout allocated from the first warehouse on an unlocked read,
  the losers failed the guarded reservation, and the unit in the second warehouse was never sold. Fix
  (TD-024): a reservation refusal rolls back and retries the checkout on fresh stock (at most 5 attempts;
  each retry follows another checkout's success). The test failed before the fix and passes 3/3 after.
- **Real 404 for unknown product and category URLs.** With Cache Components and partial prefetching the
  page's static shell is sent (200) before `notFound()` runs. Fix: the proxy checks store
  `/products/<slug>` and `/categories/<slug>` with one indexed lookup and rewrites unknown slugs to the
  not-found page (fails open if the database is down); admin `/orders/<id>` and `/customers/<id>` with a
  non-UUID id are 404 in the proxy, so the existing not-found test passes unchanged.
- **Checkout total race.** Switching payment method updated the button at once but the server total a
  moment later; ordering in between sent the old total (correctly refused with `PRICE_CHANGED`). The
  button now waits while the order is re-priced.

Existing test changed (owner to review): `e2e/catalogue.spec.ts` now waits for the refreshed "Version N"
after "Save product" before clicking "Activate product". The Wave 3 editor sends the version shown on the
page; under load the click could beat the refresh and get the designed `STALE_PRODUCT` refusal. No
assertion was removed or relaxed.

After everything: development fingerprint still `9cec751c29cab1faab002a9308e23887` with 5 migrations;
test database 6 migrations; ports 3000, 3100 and 3200 free.

## 2026-11-14 — Waves 11–12 (merchandising, discovery, post-purchase, operations)

Owner instruction: the approved scope is Waves 6–12; finish Waves 11 and 12 from the canonical plan, verify
rather than trust documentation, no Wave 13+, no migrations on development or production, no commit, push
or deploy. Plan §12 Wave 11 = C6, C10, C13, C19, C21, D50, D51, D52; Wave 12 = C3, C36, C37, D34, D35,
D38, D39, D43.

### Found before starting

- The working tree already held Wave 11–12 code written 12:03–12:27 IST the same day (after the last
  documentation update at 11:57): OTP login, merchandising (banners, collections, branding, reviews),
  returns and exchanges, documents, re-allocation, bulk actions, with integration tests
  (`otp-login`, `merchandising`, `post-purchase`, `storefront-search`). None of it was recorded here, and the
  traceability matrix still said "out of scope". No other session was running (checked).
- `npm run typecheck` passed. The four integration files: **30 / 31**; the failure was real (below).
- No HTTP or browser test covered any Wave 11–12 route or page.
- Containers were up and healthy. Development fingerprint before anything:
  `9cec751c29cab1faab002a9308e23887`, 5 migrations; test database 6 migrations.

### Gap analysis (code read against the plan, feature by feature)

All 16 features had a service, API route and page. Defects and gaps found, all fixed:

| #   | Finding                                                                                                                                                                         | Fix                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Split order: after one package shipped (order `PARTIALLY_SHIPPED`) the other could not be packed (`409 ORDER_NOT_CONFIRMED`). Wave 9 code; surfaced by the failing returns test | `order-lifecycle.service.ts`: packing allowed in `PARTIALLY_SHIPPED`; regression test in `order-lifecycle.test.ts`                                                                                                                             |
| 2   | OTP: an unknown or blocked number got no challenge row, so a second request within 30 s was 200 for it but 429 for a registered number (account enumeration in production)      | every number gets a challenge (code never sent for unknown/blocked; verify refuses it since no active customer has the number); test proves equal cooldown and that even the right code of such a challenge gives 401                          |
| 3   | Label and manifest: each package of a split COD order showed "collect" the **whole** order total (double collection; manifest COD total doubled)                                | `cod-collection.ts` (pure, 5 unit tests): share by goods value, remainder on the last package, shares add up to the total exactly; one batched query (`listCodShipmentGoods`); integration test with a split order                             |
| 4   | Manifest query (`shipments` by warehouse and `shipped_at` day) had no supporting index (rule 1)                                                                                 | migration `20261114180000_shipment_manifest_index` + guarded rollback + review sheet `docs/migrations/20261114180000.md`; EXPLAIN on `ecommerce_test`: `Index Scan using shipments_warehouse_id_shipped_at_idx`                                |
| 5   | Bulk action on a multi-package order: a failure after some packages were updated was reported as a plain failure                                                                | message "N of M shipments updated, then: …" with `details.updatedShipmentCount`                                                                                                                                                                |
| 6   | `/collections/<slug>` was **404 for every live collection**: the proxy classified it as a category slug (found by the new HTTP test)                                            | `dynamic-route-check.ts` returns `store-collection` (the proxy already had the collection lookup); unit test added                                                                                                                             |
| 7   | Collection page read the time during prerender (Next logged "unstable value `new Date()`")                                                                                      | `await connection()` before loading the collection; the log line is gone                                                                                                                                                                       |
| 8   | `.env.example` lacked `OTP_DISPLAY_IN_UI` and `COURIER_WEBHOOK_SECRET`                                                                                                          | documented as commented placeholders                                                                                                                                                                                                           |
| 9   | No HTTP or browser coverage for Waves 11–12                                                                                                                                     | `tests/http/merchandising-post-purchase.http.test.ts` (10 tests) and `e2e/post-purchase.spec.ts` (4 tests × 2 viewports); shared setup moved to `tests/http/support/commerce-api.ts` and `e2e/support/commerce.ts` (existing specs now use it) |

Checked and found correct (no change): OTP hashing, constant-time compare, 5-attempt lock, single use,
blocked customers; reviews (delivered only, unique per order line, outbox reindex); returns (order row lock
serialises requests, cap = delivered − earlier non-rejected requests, RTO units excluded, refund capped at
what was paid after the coupon, exchange order idempotent per return request, return row locked before any
inventory lock = **L60 resolved**); re-allocation (one transaction, inactive warehouse refused by the
reservation primitive); branding colour validated as `#rrggbb` before it reaches CSS.

### Commands and results (Node v26.13.0)

Batch 1 (fixes 1–5, 8): `npx vitest run src/modules/ordering src/modules/returns src/modules/merchandising`
→ 26 / 26; the five Wave 11–12 + lifecycle integration files → **46 / 46** (the harness applied the new
migration to `ecommerce_test` only; fingerprint after: development unchanged, 5 migrations; test 7).

Batch 2 (HTTP): first run **110 / 111**: the collection page answered 404 (finding 6). After the fix and a
rebuild: 111 / 111.

Batch 3 (browser): new and refactored specs → 14 / 14. Full `npm run test:e2e` → **78 / 80**: the existing
"store home … no CSP violations" test timed out waiting for network idle at both viewports. Cause: banners
created by the new tests pointed at `picsum.photos`, which this machine cannot reach (`curl` timed out after
10 s), and they stayed on the shared home page. Fix: the new HTTP and browser tests delete their banners, and
`openSettledPage` answers the demo image host with a local 1×1 PNG (CSP still applies before the request is
routed, so the CSP assertion keeps its meaning). Banner count on `ecommerce_test` after HTTP and after E2E: 0.

Final full regression (one build, fresh test server):

| Command                    | Result                                       |
| -------------------------- | -------------------------------------------- |
| `npm run typecheck`        | exit 0                                       |
| `npm run lint`             | exit 0 (0 warnings)                          |
| `npm run format:check`     | "All matched files use Prettier code style!" |
| `npm test`                 | 53 files, **447 / 447** (was 430)            |
| `npm run test:integration` | 39 files, **473 / 473** (was 440)            |
| `npm run build`            | exit 0                                       |
| `npm run test:http`        | 12 files, **111 / 111** (was 101)            |
| `npm run test:e2e`         | **80 / 80** (was 72), desktop and 360 px     |

The unit and integration increases include the Wave 11–12 tests written earlier in the day (previously
unrecorded) plus this session's additions. Final server log: no error-level entries; one deliberate L43
transaction timeout from the inventory lock test; one Next.js prerender message for `/store/search`
(Wave 6, recorded as L69, not changed).

### Databases

- Development: fingerprint `9cec751c29cab1faab002a9308e23887` before and after, 5 migrations. Not touched.
- Test (`ecommerce_test`): 7 migrations (adds `20261114180000_shipment_manifest_index`).
- Nothing committed, pushed or deployed. Test server stopped; port 3100 free.

### Open for the owner

1. Review of Waves 11–12 (and of Waves 6–10, still uncommitted).
2. Approval to apply `20261114090000` and `20261114180000` to development (with a verified backup).
3. Commit and push approvals; Wave 13 needs explicit approval.
4. Traceability: new limitations L66–L71; L60 resolved.

## 2026-11-14 — Final verification before owner review (Waves 6–12)

Owner instruction: fix the `/store/search` prerender message (Wave 6 is in scope), rebuild, rerun the full
regression, verify both migrations on the test database and an unchanged development database, review the
final diff, update the records. No migrations on development or production, no commit, push, deploy or
Wave 13.

### `/store/search` "unstable value `Date.now()` while prerendering" (L69)

- **Evidence before:** one message per server run in all three earlier logs that included the browser
  suite; never in a build log (it is raised at runtime, when the browser prefetches `/search`).
- **Root cause (traced in the built chunk `src_modules_11mge-ie6vx63._.js`):** `StorefrontSearchView` →
  `searchStorefront` → `searchProducts`, whose Elasticsearch fallback cooldown reads `Date.now()`. With
  Partial Prefetching, a prefetch's runtime prerender resolves `searchParams` from the link URL
  (`node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md`, "Prefetching"), so awaiting them
  no longer defers the render, and the uncached search ran inside the prerender.
- **Fix:** `await connection()` at the start of `StorefrontSearchView` (`src/app/store/storefront-search-view.tsx`),
  the documented pattern ("Random values and timestamps"). Search results depend on live stock and are not
  cached, so request time is the correct behaviour; the same view serves `/categories/<slug>`, which had
  the same latent path. Nothing suppressed; `searchProducts` unchanged (the API route already reads the
  request).

### Final regression (Node v26.13.0, one build, fresh test server)

| Command                    | Result                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `npm run build`            | exit 0; build log: 0 warnings, 0 "unstable value"                                     |
| `npm run typecheck`        | exit 0                                                                                |
| `npm run lint`             | exit 0 (0 warnings)                                                                   |
| `npm run format:check`     | "All matched files use Prettier code style!"                                          |
| `npm test`                 | 53 files, **447 / 447**                                                               |
| `npm run test:integration` | 39 files, **473 / 473**                                                               |
| `npm run test:http`        | 12 files, **111 / 111**                                                               |
| `npm run test:e2e`         | **80 / 80** (desktop and 360 px)                                                      |
| server log after HTTP+E2E  | 0 "unstable value", 0 `Error:` lines, 0 error-level entries; 1 deliberate L43 timeout |

### Databases

- `ecommerce_test`: `20261114090000_order_snapshots_online_payment` and
  `20261114180000_shipment_manifest_index` finished, not rolled back; index
  `shipments_warehouse_id_shipped_at_idx` and table `payment_attempts` present;
  `prisma migrate diff --from-config-datasource --to-schema` → "This is an empty migration."
- Development: fingerprint `9cec751c29cab1faab002a9308e23887`, 5 migrations, neither new migration
  present. Not touched. Port 3100 free afterwards.

### Diff review

- 202 working-tree entries (62 modified, 139 untracked, 1 staged rename `src/app/store/loading.tsx →
src/app/store/account/loading.tsx` from the Waves 6–10 work, kept so a store `notFound()` stays a real 404).
- No build output, generated Prisma client, logs, `.env`, Playwright reports or test results in the change
  set. `AGENTS.md` unchanged. No dependency changes (`package.json` adds three scripts only).
- Secrets scan of the full diff and every untracked file (private keys, GitHub/AWS/Slack/JWT-shaped tokens,
  credentialed URLs other than the documented local placeholder, secret assignments, real e-mail
  addresses): none. `localOnlyCourierSecret` is a public development/test constant that every other
  environment refuses (`courier-secret.ts`).
- Config diffs add rate-limit policies only; `trustedProxyHopCount` is 0 in all four configs.
  `next.config.ts` adds the approved Redis cache handler (Wave 6).
- No `.only`, `debugger`, `TODO` or `FIXME`; `console.log` only in the three CLI scripts.
- `git diff --check` clean.

## 2026-11-15 — Waves 13–15 (admin power tools, hardening, documentation)

Owner approval: "Start 13–15, safe parts" (Wave 13 in full; Wave 14 without `db:reset` or CI; Wave 15
documentation and Swagger, no deployment), with explicit stop conditions. No migration was needed or
applied; the development database was not touched. Decisions TD-027 to TD-029.

### Wave 13 (COMPLETE)

| Feature | Built                                                                                                                                                                                                |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D27     | `stock-transfer.service.ts`, `POST /api/admin/inventory/transfers`, transfer dialog on the stock matrix (source defaults to the warehouse holding most of the product)                               |
| D21     | `recategoriseProducts` in `tagging.service.ts`, `POST /api/admin/tagging/recategorise`, "Move all products" on the tagging page                                                                      |
| D3      | `staff-admin.*` (identity), `/api/admin/staff*`, `/api/admin/roles`, admin **Staff** page                                                                                                            |
| D48     | `search-admin.service.ts`, `/api/admin/search-index*`, admin **Search index** page                                                                                                                   |
| D41     | `pincode-import.service.ts`, `POST …/pincodes/import`, upload on the couriers page                                                                                                                   |
| D8      | `report-export.*`, `GET /api/admin/reports/export/{report}`, links on the reports page                                                                                                               |
| D16     | `product-import.service.ts` (reuses `createProductInTransaction` / `createVariantInTransaction`, split out of the existing create functions), import/export routes, section on the product-type page |
| shared  | `src/lib/csv.ts` (+ unit tests), `CsvUploadForm`                                                                                                                                                     |
| D29     | already built in Wave 5 (verified: `low-stock-thresholds.test.ts`)                                                                                                                                   |

### Wave 14 and 15 work

- `docs/evidence/explain-review.md` confirms 26 / 26 queries use an index (no further EXPLAIN work needed).
- ~~UI hardening automated checks added (`e2e/ui-hardening.spec.ts`)~~ **Correction (2026-11-15
  final verification):** that file imported `axe-playwright`, which is not installed, targeted the
  development server on port 3000, and broke typecheck, lint and build; it never ran. It was removed
  (owner-approved, backed up). The real checks are `e2e/accessibility.spec.ts` (in-repo audit in
  `e2e/support/accessibility.ts`, keyboard flows) run by the `chromium-tablet-768` project added to
  `playwright.config.ts` alongside desktop and 360 px.
- Searches (re-run 2026-11-15): 0 inline `style=` outside atoms, 0 `any` types (two matches are the
  English word in comments), 0 `eslint-disable` / `@ts-*` directives, 0 TODO/FIXME.

- `docs/evidence/explain-review.md`: 26 queries EXPLAINed on `ecommerce_test` with sequential scans
  disabled; 25 used an index at first; the dashboard return count filtered on the unindexed
  `return_requests.created_at` and now uses `requested_at` (skip scan on the existing index; no migration).
- Rules review by search: no `any`, `!`, `eslint-disable` or TODO; casts only at validated boundaries; no
  native form elements or inline styles outside atoms.
- `docs/openapi.json` generated by `scripts/generate-openapi.ts` (`npm run docs:openapi`, 149 operations)
  with a drift test; Swagger UI at admin `/docs` from `swagger-ui-dist` **5.34.1** (new, exact pin,
  published 2026-10-30, Apache-2.0; `npm audit --omit=dev`: 0 vulnerabilities; the `@scarf/scarf`
  telemetry install script was not run and is disabled via `scarfSettings`).
- `docs/er-diagram.svg` regenerated; `docs/test-evidence.md`, `docs/technical-report.md`, README, API
  documentation and TD-027 to TD-029 written.

### Problems found while building, all fixed

| Found by                   | Problem                                                                                                                                                                                               | Fix                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| browser test (transfer)    | the dialog defaulted "From" to the first active warehouse, which held none of the product → 409                                                                                                       | default to the warehouse with the most available units of that product      |
| browser test (product CSV) | the upload form and its file field had the same accessible name                                                                                                                                       | the form is "Upload <label>"                                                |
| `Card` review              | `aria-label` on `Card` is silently dropped (only `aria-labelledby` is forwarded; TypeScript allows any `aria-*`)                                                                                      | search page sections use headings with `aria-labelledby`                    |
| audit secrets check        | the audit key `revokedSessions` matches the secret-key pattern                                                                                                                                        | renamed `endedLogins`                                                       |
| Swagger first version      | operations listed twice (two tags each), "Try it out" pointed at a fixed host and port                                                                                                                | one tag per operation, relative server `/`, summaries from handler comments |
| test fixtures              | new tests had a wrong error code (`FORBIDDEN` vs `PERMISSION_DENIED`), a reused product-type code, branded-id types, an unstable "queued changes: 0" check, a DOM count on lazily rendered Swagger UI | corrected; no assertion about product behaviour was weakened                |

### Final verification (Node v26.13.0, one build, fresh test server)

| Command                    | Result                                   |
| -------------------------- | ---------------------------------------- |
| typecheck, lint, format    | exit 0, 0 warnings                       |
| `npm test`                 | 55 files, **455 / 455** (was 447)        |
| `npm run test:integration` | 46 files, **504 / 504** (was 473)        |
| `npm run build`            | exit 0, no warnings                      |
| `npm run test:http`        | 13 files, **119 / 119** (was 111)        |
| `npm run test:e2e`         | **90 / 90** (was 80), desktop and 360 px |
| server log                 | no errors; one deliberate L43 timeout    |

### Blocked (stop conditions) — not marked complete

- CI green: CI results cannot be read with the current token (L11); no push allowed.
- Acceptance tests on a fresh `db:reset`: destructive, excluded by the owner.
- Deployment and regression on deployed URLs: not approved; needs hosting accounts and credentials.
- Walkthrough video: the owner records it.
- UI pass: tablet width and manual keyboard / screen-reader checks not performed (L76).

## 2026-11-15 — Final verification and completion pass (Waves 1–16)

Owner request: verify everything against the real tree, fix confirmed problems, no commit, push, deploy,
migration or dev-database write. Owner approvals in this session: owner started the three Docker
containers; test suites may write to `ecommerce_test` only; one `npm run build` outside the command
sandbox; back up and remove four orphan files. Decisions: TD-030 (Wave 16), TD-031 (fixes below).

### Starting state (before any change)

| Check                  | Result                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`    | **exit 2**: unused `@ts-expect-error` in `e2e/ui-hardening.spec.ts`                                                              |
| `npm run lint`         | **exit 1**: 6 errors (3 in `e2e/ui-hardening.spec.ts`, 3 in the `webpack()` hook of `next.config.ts`)                            |
| `npm run format:check` | exit 0                                                                                                                           |
| `npm test`             | exit 0, 472 / 472, 57 files                                                                                                      |
| `npm run build`        | **exit 1**: Turbopack panic on `swagger-ui.css.css`; `next build --webpack` compiled, then failed type checking on the same spec |

### Problems found and fixed

| Problem                                                                                                                        | Fix                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Build panic: stale `.next/cache/turbopack` (same panic on `globals.css` without Swagger, and outside the sandbox)              | cache moved aside to `.next/cache/turbopack-suspect-20261115` (generated output; safe to delete); no source change |
| Dead `webpack()` hook in `next.config.ts` (lint errors)                                                                        | removed                                                                                                            |
| `e2e/ui-hardening.spec.ts` broken duplicate aimed at the dev server                                                            | removed (backup)                                                                                                   |
| Unused `src/modules/allocation/distance.service.ts` + 2-PIN `src/data/pincode-location.json`; unused `store-settings.cache.ts` | removed (backup in `~/ecommerce-backups/20261115-orphans/`)                                                        |
| `npm run lint` failed on a clean checkout (79 errors; CI runs lint before typecheck)                                           | `lint` runs `next typegen` first                                                                                   |
| Security H1: simulated gateway (customer picks SUCCESS) usable in production                                                   | off in production: checkout 422 `ONLINE_PAYMENT_UNAVAILABLE`, payments refused, COD-only form                      |
| Security M1: `OTP_DISPLAY_IN_UI=true` returned the OTP in production                                                           | production never returns it                                                                                        |
| Security M5: exchange to any (pricier) variant at no charge                                                                    | same variant or price ≤ unit price paid; new integration test                                                      |
| Security M6: webhook receipt committed before processing; a transient failure lost the event as DUPLICATE                      | receipt stored inside the processing transaction; test extended                                                    |
| Security L3: Swagger asset allow-list let `constructor` through (500)                                                          | `Map` lookup                                                                                                       |
| Docs: Wave 16 "not started", TD-030 missing, settings claimed cached, a false UI-hardening claim                               | corrected (README, technical report, traceability, redis design, TD-030/031)                                       |

Security findings recorded, not changed (design or owner decisions): phone numbers are not verified
before OTP login (M2); with `trustedProxyHopCount` 0 all guests share one cart rate-limit bucket (M3);
no cap on open unpaid online orders per customer (M4); one courier HMAC secret for all partners (L2);
webhook body read before the size check (L1, proxy caps at ~10 MB); no rate limit on public search,
suggest and review posting (L5); CSP keeps `'unsafe-inline'` scripts (L6). Checked and OK: admin RBAC on
every handler, store ownership checks (no IDOR), no unsafe raw SQL, no XSS sinks, CSV formula escaping,
open-redirect guard, upload limits, webhook HMAC + dedupe, OTP hashing and attempt lock, server-side
pricing in paise, guarded stock updates, session cookies.

### Final results (working tree, one build, fresh test server)

| Command                    | Result                                      |
| -------------------------- | ------------------------------------------- |
| typecheck, lint, format    | exit 0, exit 0, exit 0                      |
| `npm test`                 | exit 0, 57 files, **474 / 474**             |
| `npm run test:integration` | exit 0, 51 files, **520 / 520**             |
| `npm run build`            | exit 0, no warnings                         |
| `npm run test:http`        | exit 0, 14 files, **122 / 122**             |
| `npm run test:e2e`         | exit 0, **150 / 150** (desktop, 360, 768)   |
| server log                 | 0 error entries; one deliberate L43 timeout |

Fresh copy (clone of `HEAD` + exactly the files to commit, byte-identical): `npm ci --offline` exit 0, then
the same seven checks plus integration, all exit 0 with the same totals (`docs/test-evidence.md`).

### Still open (not done; owner approval or external access needed)

- Commit and push of everything since `9953124`; CI result (token cannot read Actions, L11).
- Migrations `20261114090000` and `20261114180000` on the development database (test database only).
- `npm run db:reset` acceptance run, deployment, deployed-URL regression, video.

## 2026-11-15 — Remaining security findings and UI polish (TD-032)

Fixed with regression tests: M3 (no shared guest cart bucket for unknown IPs), M4 (at most 2 unpaid
online orders per customer, 409 `UNPAID_ORDERS_LIMIT`), L1 (webhook size checked before reading,
`readTextWithin`), L5 (`public-search` and `review-write` rate limits). Owner decisions recorded, not
changed: M2 phone verification (needs a migration), registration bucket (needs the proxy hop count), L2
per-partner courier secret, L6 CSP nonces. UI, checked on screenshots of the running test server: cart
count badge without status dot, search placeholder no longer clipped, admin sidebar grouped into
sections. Removed the unused `SearchBar` molecule (backup).

| Command                    | Result                          |
| -------------------------- | ------------------------------- |
| typecheck, lint, format    | exit 0, exit 0, exit 0          |
| `npm test`                 | exit 0, 58 files, **479 / 479** |
| `npm run test:integration` | exit 0, 51 files, **524 / 524** |
| `npm run build`            | exit 0, 111 pages, no warnings  |
| `npm run test:http`        | exit 0, 14 files, **122 / 122** |
| `npm run test:e2e`         | exit 0, **150 / 150**           |

Server log: 0 errors, 1 deliberate L43 timeout warning. Development database fingerprint
`9cec751c29cab1faab002a9308e23887` (unchanged; 5 migrations). Nothing committed.

## 2026-11-15 — Re-authentication, partner keys, migration review (TD-033)

- M2 partly fixed (phone change needs the current password and signs out other sessions); the
  verified-phone part is a proposal needing a migration (`docs/migrations/proposed-phone-verification.md`).
- L2 fixed (per-partner derived webhook keys). L6 kept with the reason from Next's CSP guide. Production
  logs a warning at start while `trustedProxyHopCount` is 0.
- Pending migrations reviewed: `prisma migrate diff` against `ecommerce_test` reports no difference;
  read-only pre-flight on development is clean; rollbacks match. Checklist:
  `docs/migrations/dev-migration-checklist.md`. Not applied to development.
- One HTTP failure while building: the test process had no app environment for `courierSigningKey`; a
  pure `deriveCourierSigningKey` is used by the test. Re-running `test:http` three times against one server
  then hit the shared registration limit (429, by design); a fresh server run passed.

| Command                    | Result                          |
| -------------------------- | ------------------------------- |
| typecheck, lint, format    | exit 0, exit 0, exit 0          |
| `npm test`                 | exit 0, 59 files, **481 / 481** |
| `npm run test:integration` | exit 0, 51 files, **525 / 525** |
| `npm run build`            | exit 0, 111 pages               |
| `npm run test:http`        | exit 0, 14 files, **122 / 122** |
| `npm run test:e2e`         | exit 0, **150 / 150**           |

Server log: 0 errors, 1 deliberate L43 warning. Development fingerprint unchanged
(`9cec751c29cab1faab002a9308e23887`). Nothing committed.

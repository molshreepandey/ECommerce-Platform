# Architecture

Status: Waves 1–4 are built (foundation, platform, identity and audit, catalogue, categories, tagging and
product groups). Wave 5 is in progress: the inventory ledger migrations, the inventory services and the
admin inventory API (step 3, TD-020), the admin inventory pages (step 4, TD-021) and the internal dispatch and
restock functions (step 5, TD-022) are in place. Business modules
live in `src/modules/<name>/` as `*.service.ts` (transactions, rules) over `*.repository.ts` (Prisma
only); route handlers in `src/app/api/` stay thin.

## Big picture

```mermaid
flowchart LR
  browserStore[Customer browser] -->|store.localhost| proxy
  browserAdmin[Staff browser] -->|admin.localhost| proxy
  proxy[src/proxy.ts<br/>host routing, request id,<br/>runtime security headers] --> pages[Pages<br/>src/app/store, src/app/admin]
  proxy --> api[Route handlers<br/>src/app/api/*]
  api --> handler[apiHandler<br/>origin check, errors, logging]
  handler --> services[Module services<br/>business rules, transactions]
  services --> repositories[Repositories<br/>SQL / Prisma]
  repositories --> postgres[(PostgreSQL<br/>source of truth)]
  services --> redis[(Redis<br/>cache, rate limits)]
  services --> search[(Elasticsearch<br/>search read model)]
```

- **One codebase, two sites.** `src/proxy.ts` reads the `Host` header, matches it against the hosts in the
  runtime config, and rewrites store pages to `/store/*` and admin pages to `/admin/*`. APIs live under
  `/api/store/*` and `/api/admin/*`; calling the other site's APIs returns 404.
- **PostgreSQL is the source of truth** for everything that matters. Redis and Elasticsearch hold copies
  or counters that can be lost (see `docs/redis-design.md`).
- **Layering inside a module** (from Wave 2B): route handler → service → repository. Route handlers only
  authenticate, validate and call one service. Business rules live in services; SQL lives in repositories.

- **Inventory (`src/modules/inventory/`, TD-018, TD-019, TD-022).** Warehouses, staff stock changes
  (idempotent adjustments and receipts), low-stock thresholds, internal reservation, release, dispatch and
  restock functions for checkout, shipment and returns code, and read-only queries (stock matrix, low stock, ledger, availability). Every stock change
  runs in one transaction that also writes its ledger movement, audit row and search update; row locks
  follow one global hierarchy (orders, shipments, change requests, products, variants, warehouses, stock
  rows), checked at runtime by a per-transaction lock-order tracker.

## Request lifecycle (today)

1. `src/proxy.ts`: decide store/admin/404 from the host; assign `x-request-id`; set `x-surface`; add the
   Content-Security-Policy (and HSTS for HTTPS origins).
2. `next.config.ts` headers: add `nosniff`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`.
3. Route handler wrapped in `apiHandler` (`src/lib/api-handler.ts`): marks the route dynamic, creates a
   request logger with the request id, rejects state-changing requests from another origin (403), runs
   the handler, maps errors to the standard envelope `{ error: { code, message, details } }`, logs
   duration.
4. Example: `GET /api/health` probes Postgres, Elasticsearch and Redis, each with a time limit, and
   applies the approved health rule.

## Configuration

See TD-002 in `docs/TECHNICAL_DECISIONS.md`.

```
APP_ENV=staging ──► config/config.staging.json ──┐
APP_CONFIG_PATH (optional override) ─────────────┼─► Zod validation at server start ─► getConfig()
.env / platform env: DATABASE_URL, REDIS_URL, ... ┘        (exit code 1 if invalid)
```

## Infrastructure (local)

| Service       | Image                       | Host port        | Notes                                                           |
| ------------- | --------------------------- | ---------------- | --------------------------------------------------------------- |
| PostgreSQL    | `postgres:18.6`             | `127.0.0.1:5433` | source of truth; `ecommerce` (dev) and `ecommerce_test` (tests) |
| Elasticsearch | `elasticsearch:9.5.5`       | `127.0.0.1:9200` | search read model (used from Wave 6)                            |
| Redis         | `redis:8.10.3@sha256:1f88…` | `127.0.0.1:6379` | cache and rate limits; no persistence; 128 MB, `volatile-lru`   |

## Folder map

```
config/                 runtime configuration per environment (non-secret)
prisma/                 schema, migrations, seed
src/app/                pages (store, admin), API routes, global 404
src/lib/                cross-cutting: config, env, db, redis, elasticsearch, logger, errors,
                        api-handler, health, rate-limit/, security-headers, request-origin, money, ids
src/components/         atoms, layouts (molecules and organisms added as needed)
src/theme/              theme provider and status colours
tests/support/          shared test helpers (target guard, test app URLs, test database setup)
tests/integration/      Vitest against real Postgres and Redis (test database only)
tests/http/             Supertest against a running app
e2e/                    Playwright browser tests
scripts/                start-test-server.ts
docs/                   design documents, walkthroughs, evidence
```

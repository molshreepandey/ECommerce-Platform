# E-Commerce Platform

Customer store and admin panel served from one Next.js 16 codebase, routed by host name.

| Site           | Local URL                   |
| -------------- | --------------------------- |
| Customer store | http://store.localhost:3000 |
| Admin panel    | http://admin.localhost:3000 |

`*.localhost` resolves to your machine without editing `/etc/hosts`.

## Requirements

- Node 26.13.0 (`nvm use`)
- Docker (Docker Desktop or OrbStack) for Postgres 18 and Elasticsearch 9

The Postgres container is published on host port **5433** (not 5432) so it never collides with a
locally installed PostgreSQL. Elasticsearch is on 9200. Both ports are bound to `127.0.0.1` only, so
they are not reachable from other devices on your network.

## Getting started

```bash
nvm use
npm ci
cp .env.example .env
docker compose up -d
npm run db:reset      # migrate from scratch + seed demo data
npm run dev
```

On a brand-new, empty database `npm run db:deploy && npm run db:seed` does the same as `db:reset` without dropping anything; that is the path verified so far. `db:reset` drops and recreates the database, so never run it against data you want to keep.

Health check: `curl http://store.localhost:3000/api/health` returns 200 `ok` when every dependency is up, 200 `degraded` when only a non-critical dependency (Elasticsearch) is down, and 503 `unavailable` when PostgreSQL is down.

## Scripts

| Command               | Purpose                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `npm run dev`         | Start the app on port 3000                                                |
| `npm run typecheck`   | Generate route types and run `tsc --noEmit`                               |
| `npm run lint`        | ESLint with zero warnings allowed                                         |
| `npm test`            | Vitest unit tests (no server or database needed)                          |
| `npm run test:http`   | HTTP tests against a running app (`npm run build && npm run start` first) |
| `npm run test:e2e`    | Playwright browser tests (starts the app if it is not running)            |
| `npm run db:generate` | Generate the Prisma client                                                |
| `npm run db:migrate`  | Create/apply a development migration                                      |
| `npm run db:reset`    | Reset the database and seed it                                            |
| `npm run docs:erd`    | Regenerate `docs/er-diagram.svg` from the Prisma schema                   |

# E-Commerce Platform

Customer store and admin panel served from one Next.js 16 codebase, routed by host name. PostgreSQL is the
source of truth; Elasticsearch is the search read model; Redis is used for caching and rate limiting only.

| Site           | Local URL                   |
| -------------- | --------------------------- |
| Customer store | http://store.localhost:3000 |
| Admin panel    | http://admin.localhost:3000 |

`*.localhost` resolves to your machine without editing `/etc/hosts`.

## Requirements

- Node 26.13.0 (`nvm use`; `npm` refuses to install on another version)
- Docker (Docker Desktop or OrbStack) for PostgreSQL 18, Elasticsearch 9 and Redis 8

| Service       | Host port | Notes                                                            |
| ------------- | --------- | ---------------------------------------------------------------- |
| PostgreSQL    | 5433      | not 5432, so it never collides with a locally installed Postgres |
| Elasticsearch | 9200      |                                                                  |
| Redis         | 6379      | pinned to 8.10.3 by digest; no persistence (cache only)          |

All three ports are bound to `127.0.0.1`, so other devices on your network cannot reach them.

## Getting started

```bash
nvm use               # Node 26.13.0
npm ci                # also generates the Prisma client (postinstall)
cp .env.example .env
docker compose up -d
npm run db:deploy     # apply migrations to the empty database
npm run db:seed       # load demo data (safe to re-run)
npm run dev
```

`npm run db:reset` drops and recreates the database before seeding. Never run it against data you
want to keep.

Docker Compose uses the fixed project name `ecommerce-platform`. A second checkout of this repository
on the same machine would control the **same** containers and volumes, so run `docker compose` from one
checkout only.

Health check: `curl http://store.localhost:3000/api/health` returns 200 `ok` when every dependency is up,
200 `degraded` when only a non-critical dependency (Elasticsearch or Redis) is down, and 503
`unavailable` when PostgreSQL is down.

## Demo accounts (development and demo only)

`npm run db:seed` creates these accounts. **All of them use the password `DemoPass!2026`.** It exists only
for local development, tests and the demo video, with two safeguards (TD-013):

- **Seeding:** the seed runs only with `APP_ENV=development` or `APP_ENV=test`. It refuses `staging`,
  `production` and anything else.
- **Sign-in:** a server running with `APP_ENV=staging` or `production` refuses every `@demo-store.test`
  email and the password `DemoPass!2026`, even if such accounts exist in its database.

| Site  | Email                               | Role                             |
| ----- | ----------------------------------- | -------------------------------- |
| Admin | `super.admin@demo-store.test`       | Super admin (all 19 permissions) |
| Admin | `catalogue.manager@demo-store.test` | Catalogue manager                |
| Admin | `inventory.manager@demo-store.test` | Inventory manager                |
| Admin | `order.ops@demo-store.test`         | Order operations                 |
| Admin | `support@demo-store.test`           | Support (read-only)              |
| Store | `asha.verma@demo-store.test`        | Customer, 2 saved addresses      |
| Store | `rahul.mehta@demo-store.test`       | Customer, 2 saved addresses      |
| Store | `neha.iyer@demo-store.test`         | Customer, 2 saved addresses      |

Sign in at http://admin.localhost:3000/login or http://store.localhost:3000/login. New customers can also
register at http://store.localhost:3000/register.

A database seeded before Wave 2B has placeholder hashes; `npm run db:seed:demo-passwords` replaces them
with Argon2id hashes of the demo password. It changes only `password_hash` on those 8 rows and does
nothing on a second run.

## Configuration

| Where                          | What                                                                                          | Committed |
| ------------------------------ | --------------------------------------------------------------------------------------------- | --------- |
| `config/config.<APP_ENV>.json` | non-secret settings: hosts, timeouts, rate limits, cache and Redis settings, security headers | yes       |
| environment variables / `.env` | secrets and connection strings                                                                | no        |

The JSON file is **read when the server starts** (not baked into the build), so staging and production
can change settings with a restart instead of a rebuild. An invalid file stops the server with exit code 1.

| Variable            | Required  | Example (local placeholders)                                     |
| ------------------- | --------- | ---------------------------------------------------------------- |
| `APP_ENV`           | yes       | `development` (also `test`, `staging`, `production`)             |
| `APP_CONFIG_PATH`   | no        | path to a different config file, overrides `APP_ENV`'s file      |
| `DATABASE_URL`      | yes       | `postgresql://ecommerce:ecommerce@localhost:5433/ecommerce`      |
| `TEST_DATABASE_URL` | for tests | `postgresql://ecommerce:ecommerce@localhost:5433/ecommerce_test` |
| `ELASTICSEARCH_URL` | yes       | `http://localhost:9200`                                          |
| `REDIS_URL`         | yes       | `redis://localhost:6379` (`rediss://` for TLS)                   |

## Tests

| Command                    | What it runs                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                 | unit tests (no server or database needed)                                                                                                      |
| `npm run test:integration` | real PostgreSQL and Redis, **test database only** (name must end with `_test`)                                                                 |
| `npm run start:test`       | resets the test database to the demo identity seed, then starts the built app with the test configuration on port 3100 (after `npm run build`) |
| `npm run test:http`        | HTTP tests against the test server                                                                                                             |
| `npm run test:e2e`         | Playwright browser tests (starts the test server if it is not running)                                                                         |
| `npm run start:test:dev`   | like `start:test`, but runs the development server (`next dev`) on the test database, for safe smoke tests                                     |
| `npm run test:http:dev`    | HTTP tests against `start:test:dev` (expects the dev-only `'unsafe-eval'` in the CSP)                                                          |

A full local run: `npm test && npm run test:integration && npm run build && npm run test:e2e`, and
`npm run test:http` while the test server is running.

## Other scripts

| Command               | Purpose                                                 |
| --------------------- | ------------------------------------------------------- |
| `npm run dev`         | Start the app on port 3000                              |
| `npm run typecheck`   | Generate route types and run `tsc --noEmit`             |
| `npm run lint`        | ESLint with zero warnings allowed                       |
| `npm run db:generate` | Regenerate the Prisma client                            |
| `npm run db:migrate`  | Create/apply a development migration                    |
| `npm run docs:erd`    | Regenerate `docs/er-diagram.svg` from the Prisma schema |

## Documentation

- `docs/ARCHITECTURE.md`, `docs/TECHNICAL_DECISIONS.md`, `docs/DATABASE_DESIGN.md`
- `docs/API_DOCUMENTATION.md`, `docs/TESTING_STRATEGY.md`, `docs/DEPLOYMENT_GUIDE.md`
- `docs/redis-design.md`, `docs/REQUIREMENTS_TRACEABILITY.md`, `docs/walkthroughs/`
- `IMPLEMENTATION_PROGRESS.md`: what was built, how it was verified, and what is still open

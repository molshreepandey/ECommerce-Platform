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

| Variable                 | Required                     | Example (local placeholders)                                                                               |
| ------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                | yes                          | `development` (also `test`, `staging`, `production`)                                                       |
| `APP_CONFIG_PATH`        | no                           | path to a different config file, overrides `APP_ENV`'s file                                                |
| `DATABASE_URL`           | yes                          | `postgresql://ecommerce:ecommerce@localhost:5433/ecommerce`                                                |
| `TEST_DATABASE_URL`      | for tests                    | `postgresql://ecommerce:ecommerce@localhost:5433/ecommerce_test`                                           |
| `ELASTICSEARCH_URL`      | yes                          | `http://localhost:9200`                                                                                    |
| `REDIS_URL`              | yes                          | `redis://localhost:6379` (`rediss://` for TLS)                                                             |
| `COURIER_WEBHOOK_SECRET` | outside development and test | 32+ characters; signs and verifies `demo_courier` webhooks (development and test use a fixed local secret) |

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

| Command                        | Purpose                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `npm run dev`                  | Start the app on port 3000                                                            |
| `npm run typecheck`            | Generate route types and run `tsc --noEmit`                                           |
| `npm run lint`                 | ESLint with zero warnings allowed                                                     |
| `npm run db:generate`          | Regenerate the Prisma client                                                          |
| `npm run db:migrate`           | Create/apply a development migration                                                  |
| `npm run docs:erd`             | Regenerate `docs/er-diagram.svg` from the Prisma schema                               |
| `npm run docs:openapi`         | Regenerate `docs/openapi.json` from the API route handlers (a unit test checks drift) |
| `npm run search:sync`          | Process every queued search outbox row now (the app also does this after each change) |
| `npm run search:reindex`       | Rebuild the Elasticsearch index with no downtime (new versioned index, alias swap)    |
| `npm run orders:expire-unpaid` | Cancel online orders not paid within 30 minutes and release their stock               |

## Demo walkthrough

Store (http://store.localhost:3000):

1. Browse **Categories** or search (try `kurta`), filter by brand, price, stock, rating or an attribute,
   change the sort, page through results.
2. Open a product, pick a size/colour (unavailable combinations are disabled), **Add to cart** or **Buy now**.
   As a guest the cart lives in a cookie and is merged into your account when you sign in.
3. In the cart change quantities, try coupons (`SAVE10` valid, `FLAT150` expired, `BIGSALE25` used up,
   `WELCOME20` first order only), then **Checkout**.
4. Pick an address and **Pay online** (simulated gateway: choose success or a decline; three declines or
   30 minutes unpaid cancel the order) or **Cash on Delivery**; the confirmation opens the order page.
5. **Orders** lists your orders; an order shows items, payment, per-shipment tracking and **Cancel order**
   while nothing has shipped.

Admin (http://admin.localhost:3000, `order.ops@demo-store.test` or `super.admin@demo-store.test`):

1. **Orders**: search and filter, open an order, **Confirm order**, then on each shipment **Mark packed** →
   **Create AWB** → **Download label** → **Simulate pickup scan / next scan** until delivered (COD payment
   becomes collected). Try **Mark delivery failed** → **Return to origin** → **Receive and restock**.
2. **Dashboard** and **Reports**: KPIs, charts, top products, stock by warehouse and the reconciliation
   panel (report total = order rows = payment rows).
3. **Customers**: open a customer, **Block** (signs them out, stops sign-in and checkout), **Unblock**.
4. **Coupons**, **Settings**, **Couriers** (serviceable pincodes, webhook log), **Audit trail**.

## OTP login (demo)

No SMS is sent. `POST /api/store/auth/otp/request` writes the code to the server log (`otp_issued` event,
field `issuedCode`) and, while `OTP_DISPLAY_IN_UI` is not `false`, the login page shows it in a popup
labelled "Staging/demo: OTP is shown here because SMS is not integrated". Production sets
`OTP_DISPLAY_IN_UI=false`: the code is then only in the server log. Codes expire after 5 minutes, lock
after 5 wrong attempts, can be resent after 30 seconds and work once.

## API documentation and staff

- Swagger UI: sign in on the admin site and open **API docs** (`http://admin.localhost:3000/docs`). It is
  generated from the route handlers (`docs/openapi.json`, `npm run docs:openapi`).
- Staff (super admin only): **Staff** in the admin menu adds staff, changes their roles and deactivates
  them (signed out everywhere). Nobody can change their own account, and one active super admin always
  remains.

## Known limitations

- Online payment is a **simulated gateway** (no card data, no money moves; the customer picks the outcome);
  COD is the other method. With `APP_ENV=production` the simulation is switched off and checkout offers
  COD only, until a real gateway adapter exists. Refunds for cancelled online orders are not automated (the
  payment stays COLLECTED and needs a manual refund).
- OTP login codes are written to the server log (no SMS). Development, test and staging also show the code
  in a popup (`OTP_DISPLAY_IN_UI`); production never returns it, whatever that setting says.
- The only courier is the built-in `demo_courier` (simulated AWB, PDF label and signed webhooks).
- Unpaid online orders are expired after checkout/order-list requests and by `npm run orders:expire-unpaid`;
  there is no background scheduler.
- Waves 11–13 (P1) are built: OTP login, returns/exchanges with manual refunds, invoice, packing slip,
  label and manifest PDFs, collections, banners, branding, reviews, facet counts, pincode check,
  re-allocation, bulk actions, staff management, CSV exports, product and pincode CSV uploads, stock
  transfer, bulk re-categorise and search index tools.
- Wave 16 (P2) is built: search autocomplete, a simulated order notification log (order placed, shipped,
  delivered; nothing is sent, so there is no failed-notification history), and an optional
  "nearest warehouse" allocation setting. "Nearest" is approximated by the shared PIN-code prefix (zone,
  circle, sorting district), not by geographic distance: no PIN coordinates dataset is used. The default
  is priority-based allocation.
- Not deployed: no hosted store/admin URLs, no CI result readable here (see `IMPLEMENTATION_PROGRESS.md`).
- Whole-order cancellation only; coupon usage is not given back when an order is cancelled.
- Security items that need an owner decision (TD-032, TD-033): phone numbers are not verified at
  registration, so someone could register another person's number first (proposal:
  `docs/migrations/proposed-phone-verification.md`; changing a phone already needs the current password
  and signs out other devices); CSP still allows inline scripts (nonces would disable static and partial
  rendering); with no trusted proxy hop configured, client IPs are unknown, so registration shares one
  site-wide limit and guest cart / search limits are off (production logs a warning at start).
- Production prerequisites: `COURIER_WEBHOOK_SECRET` (per-partner keys are derived from it),
  `authentication.trustedProxyHopCount` set to the real proxy chain, the two pending migrations applied
  (`docs/migrations/dev-migration-checklist.md`), `OTP_DISPLAY_IN_UI` is ignored in production.
- A customer can hold at most 2 unpaid online orders at a time (COD is not capped).
- See `docs/REQUIREMENTS_TRACEABILITY.md` for the full limitation register.

## Documentation

- `docs/ARCHITECTURE.md`, `docs/TECHNICAL_DECISIONS.md`, `docs/DATABASE_DESIGN.md`
- `docs/API_DOCUMENTATION.md`, `docs/TESTING_STRATEGY.md`, `docs/DEPLOYMENT_GUIDE.md`
- `docs/redis-design.md`, `docs/REQUIREMENTS_TRACEABILITY.md`, `docs/walkthroughs/`
- `IMPLEMENTATION_PROGRESS.md`: what was built, how it was verified, and what is still open

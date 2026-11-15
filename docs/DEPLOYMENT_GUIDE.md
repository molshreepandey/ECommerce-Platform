# Deployment guide

**Status (2026-11-15): not deployed.** The submission demo runs locally (README, "Getting started"). This
page lists what a hosted deployment needs, what still blocks it, and the order to do it in. Nothing here
claims a deployment has happened.

## Local

```bash
nvm use                 # Node 26.13.0 (.npmrc has engine-strict=true: npm refuses other versions)
npm ci                  # installs and generates the Prisma client
cp .env.example .env
docker compose up -d    # Postgres 5433, Elasticsearch 9200, Redis 6379 (localhost only)
npm run db:deploy       # all migrations
npm run db:seed         # demo data, safe to re-run (development and test only)
npm run dev
```

## What a hosted deployment runs

| Part            | Requirement                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App             | one long-running Node **26.13.0+** process: `npm ci && npm run build`, then `npm run start` (`next start`, honours `PORT`)                                                                                                      |
| Domains         | two host names (store and admin) pointing at the **same** app; the app routes by `Host`                                                                                                                                         |
| PostgreSQL      | **version 18 required** (primary keys default to the built-in `uuidv7()`); `pg_trgm` extension                                                                                                                                  |
| Redis           | 8.x recommended (cache and rate limits); the app fails open to PostgreSQL if it is unreachable                                                                                                                                  |
| Elasticsearch   | 9.x optional; without it search uses the PostgreSQL fallback and `/api/health` reports `degraded`                                                                                                                               |
| Background work | none required: the search outbox is processed after each catalogue or stock change and unpaid online orders expire on requests; for steadier behaviour schedule `npm run search:sync` and `npm run orders:expire-unpaid` (cron) |
| Files           | no file storage: product images are external URLs from allowlisted origins (CSP `imageSources`); CSV uploads are JSON bodies ≤ 1 MB                                                                                             |
| Logs            | pino JSON on stdout (level from the config file); secrets, tokens and OTP fields are redacted except the deliberate `issuedCode` of the log-only OTP sender                                                                     |
| Health          | `GET /api/health`: 200 `ok`, 200 `degraded` (Elasticsearch or Redis down), 503 (PostgreSQL down)                                                                                                                                |

## Recommended hosting (fastest reliable option)

A platform that runs a **long-running Node web service with custom domains**, plus **managed PostgreSQL 18**
and **managed Redis**, in one account (for example Render or Railway); Elasticsearch from Elastic Cloud
(trial) or omitted (PostgreSQL fallback). Reasons: the app keeps Redis and PostgreSQL connections open,
uses a custom Redis cache handler, runs work in `after()`, and validates its configuration at start-up
and exits on error, which suits a persistent process better than serverless functions.

Verify on the chosen platform before starting (not verified here): Node 26.13.0 support (or a Docker
image `node:26.13.0`; no Dockerfile exists yet), PostgreSQL **18**, two custom domains on one service,
and how its proxy sets `X-Forwarded-For` (for `trustedProxyHopCount`).

## Blockers before any hosted deployment

1. **First admin: built (`npm run admin:create-first`), run it once after `db:deploy`.** The demo seed
   refuses staging and production, so a fresh database has no roles, permissions or staff. The script
   creates the role/permission catalogue (the same definitions the seed uses) and one `SUPER_ADMIN` from
   `FIRST_ADMIN_NAME`, `FIRST_ADMIN_EMAIL` and `FIRST_ADMIN_PASSWORD` (12+ characters; the demo email
   domain and demo password are refused). It is refused once any staff account exists and is safe against
   two runs at once; the password is never printed or audited. Load the catalogue afterwards through the
   admin product CSV import.
2. **Placeholder host names.** `config/config.staging.json` and `config.production.json` use
   `*.example.com`; set the real store and admin hosts and origins.
3. **`authentication.trustedProxyHopCount` is 0** in every config (owner decision until the proxy chain is
   verified). Until set, client IPs are unknown: registration shares one site-wide limit, guest cart and
   search limits are off, audit rows have no IP, and production logs a `deployment_warning` at start.
   Count only proxies you control or the platform guarantees; after deploying, sign in with a forged
   `X-Forwarded-For: 198.51.100.1` and confirm logs show your real address.
4. **Platform versions:** Node 26.13.0 and PostgreSQL 18 must be available (see above).

Behaviour that differs by `APP_ENV` (choose deliberately):

| Feature                      | development / test | staging                               | production         |
| ---------------------------- | ------------------ | ------------------------------------- | ------------------ |
| Demo accounts and seed       | allowed            | refused                               | refused            |
| Simulated online payment     | on                 | on                                    | **off** (COD only) |
| OTP shown in the login popup | on                 | on (unless `OTP_DISPLAY_IN_UI=false`) | **never**          |
| Secure `__Host-` cookies     | no                 | yes                                   | yes                |
| `COURIER_WEBHOOK_SECRET`     | optional           | **required**                          | **required**       |

For an evaluator-facing hosted demo, `staging` keeps the simulated gateway and the OTP popup.

## Environment variables

| Variable                 | Staging / production                                               | Notes                                                       |
| ------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| `APP_ENV`                | `staging` or `production`                                          | selects `config/config.<APP_ENV>.json`                      |
| `DATABASE_URL`           | required                                                           | PostgreSQL 18 connection string (use TLS if offered)        |
| `REDIS_URL`              | required                                                           | `rediss://` for TLS                                         |
| `ELASTICSEARCH_URL`      | required (value may point at an unused URL to run on the fallback) | include credentials in the URL if the cluster needs them    |
| `COURIER_WEBHOOK_SECRET` | required                                                           | 32+ random characters; per-partner keys are derived from it |
| `OTP_DISPLAY_IN_UI`      | optional                                                           | ignored in production                                       |
| `APP_CONFIG_PATH`        | optional                                                           | another config file instead of the committed one            |
| `TEST_DATABASE_URL`      | never                                                              | tests only                                                  |

Never reuse the local placeholder credentials from `.env.example`.

## Deployment sequence (each step needs the owner's approval)

1. Create the services (web service, PostgreSQL 18, Redis; optionally Elasticsearch) and the two domains.
2. Commit real hosts (and, once verified, `trustedProxyHopCount`) to the environment's config file.
3. Set the environment variables above in the platform (not in Git).
4. Build: `npm ci && npm run build`. Release step: `npm run db:deploy` (applies all 7 migrations to the
   empty database; rehearsed on a disposable database on 2026-11-15, see `docs/test-evidence.md`). Never
   run `db:reset` or `db:seed` there.
5. Start: `npm run start`. Check `GET https://<store-host>/api/health` returns 200.
6. Create the first super admin once:
   `FIRST_ADMIN_NAME=… FIRST_ADMIN_EMAIL=… FIRST_ADMIN_PASSWORD=… npm run admin:create-first`, then
   remove `FIRST_ADMIN_PASSWORD`; sign in on the admin host, load the catalogue (CSV import),
   then `npm run search:reindex` once if Elasticsearch is used.
7. Verify the proxy hop count (blocker 3), store and admin journeys, and that the admin API answers 404 on
   the store host.

## Changing a setting without rebuilding

Edit the environment's JSON file (or set `APP_CONFIG_PATH`) and restart. The file is validated at start;
an invalid file makes the process exit with code 1, so a bad change cannot go live silently. Security
headers in `next.config.ts` and prerendered pages are fixed at build time (TD-002).

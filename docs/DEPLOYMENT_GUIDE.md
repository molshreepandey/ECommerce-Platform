# Deployment guide

Status: local setup and configuration are in place; hosted deployment is planned for Wave 15. Nothing
here claims production readiness.

## Local

```bash
nvm use                 # Node 26.13.0 (npm refuses other versions: engine-strict)
npm ci                  # installs and generates the Prisma client
cp .env.example .env
docker compose up -d    # Postgres 5433, Elasticsearch 9200, Redis 6379 (localhost only)
npm run db:deploy       # migrations
npm run db:seed         # demo data, safe to re-run
npm run dev
```

## Environments and configuration

| Environment       | `APP_ENV`     | Config file                      | Secrets from                                        |
| ----------------- | ------------- | -------------------------------- | --------------------------------------------------- |
| Local development | `development` | `config/config.development.json` | `.env` (local placeholders)                         |
| Automated tests   | `test`        | `config/config.test.json`        | `.env` / CI env                                     |
| Staging           | `staging`     | `config/config.staging.json`     | platform environment variables                      |
| Production        | `production`  | `config/config.production.json`  | platform environment variables or a secrets manager |

Required environment variables: `APP_ENV`, `DATABASE_URL`, `ELASTICSEARCH_URL`, `REDIS_URL`
(`TEST_DATABASE_URL` for tests only). Optional: `APP_CONFIG_PATH`.

### Changing a setting without rebuilding

1. Edit the environment's JSON file (or provide another file and set `APP_CONFIG_PATH`).
2. Restart the server. The file is validated at start-up; an invalid file makes the process exit with
   code 1, so a bad change cannot go live silently.

Settings that are fixed at build time: security headers that are the same everywhere (`next.config.ts`)
and prerendered page content. See TD-002 in `docs/TECHNICAL_DECISIONS.md`.

### Before the first hosted deployment (Wave 15)

- Replace the `example.com` hosts and origins in `config.staging.json` and `config.production.json`.
- Provide managed Postgres, Redis (TLS: `rediss://`) and Elasticsearch (or rely on the Postgres search
  fallback) on free tiers only.
- Never reuse the local development credentials.

## Database migrations

`npm run db:deploy` applies committed migrations only. `npm run db:reset` drops the database; never use it
outside a disposable local database.

## Health

`GET /api/health` → 200 `ok`, 200 `degraded` (Elasticsearch or Redis down, fallbacks active) or 503
`unavailable` (Postgres down). Use it for load-balancer and deployment checks.

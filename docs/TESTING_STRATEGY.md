# Testing strategy

## Suites

| Suite       | Command                    | Runs against                                                   | What it proves                                                                                                                                         | Count (Wave 2A) |
| ----------- | -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| Unit        | `npm test`                 | nothing external                                               | pure logic: config and env validation, host routing, Money, health rule, rate-limit windows and fallback, CSP builder, origin check, test-target guard | 99              |
| Integration | `npm run test:integration` | real Postgres (`ecommerce_test`) and Redis (`ecom:test:` keys) | database constraints, concurrent stock reservations, real rate-limit stores under concurrency, real Redis outage fallback, harness safety              | 18              |
| HTTP        | `npm run test:http`        | running app (`npm run start:test`)                             | status codes, server-rendered 404s, security headers, health response                                                                                  | 19              |
| Browser     | `npm run test:e2e`         | running app (Playwright starts it if needed)                   | real Chromium, desktop and 360 px: 404 pages, navigation, no page errors, **no CSP violations**                                                        | 18              |

Rules from the plan: during development run only the test files touched; at the end of each wave run every
suite (regression).

## Test environment

- `APP_ENV=test` selects `config/config.test.json`: hosts `store.localhost:3100` and
  `admin.localhost:3100`, Redis prefix `ecom:test:`, Elasticsearch prefix `test`, small rate limits.
- `npm run start:test` (`scripts/start-test-server.ts`) checks `TEST_DATABASE_URL` with the target guard,
  creates and migrates the test database if needed, then starts the already-built app on port 3100 with
  the test configuration. The same build serves development and test, which also exercises runtime
  configuration.

## Safety guard (never touch the development database)

`tests/support/test-target-guard.ts` runs before every migration, truncation and clean-up:

1. the database name in the URL must match `^[a-z0-9_]+_test$` and differ from the development database;
2. after connecting, `SELECT current_database()` must also end with `_test`;
3. Redis clean-up requires a key prefix ending in `test:` and deletes only keys under it (no `FLUSHDB`).

19 unit tests cover tricky URLs (`_test` in the user name or query string, `ecommerce_test_backup`,
upper-case `_TEST`, non-Postgres URLs). An integration test proves truncation refuses when `DATABASE_URL`
points at the development database.

## Verifying data, not just responses

Integration tests read rows back: stock levels after 20 parallel reservations, the counter row after 50
parallel rate-limit calls, Redis key TTLs. Later waves follow the same rule for orders, payments and stock.

## Known limitations

- One run of the browser tests against `next dev` timed out in a reload loop (2026-11-07). It did not
  reproduce in 4 later runs on a truly cold dev server (1 and 4 workers). Slow first-time compiles and
  Playwright's artifact writes were both tested and ruled out; the root cause is unknown. Each page
  compiled for the first time does reload once when hot reload connects (measured). `npm run test:e2e`
  and CI use the production build, which passed every run. If a dev-mode run loops again, keep the
  server log and the Playwright trace for diagnosis.
- CI has never been observed running (the GitHub token cannot read Actions results yet).

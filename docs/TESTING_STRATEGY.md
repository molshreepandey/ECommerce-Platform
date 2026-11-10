# Testing strategy

## Suites

| Suite       | Command                    | Runs against                                                   | What it proves                                                                                                                                                                                                                                                                                                                                                                             | Count (end of Wave 2B) |
| ----------- | -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| Unit        | `npm test`                 | nothing external                                               | pure logic: config and env validation, host routing, Money, health rule, rate-limit windows, CSP builder, origin check, test-target guard, session tokens, cookies, client IP, sign-in redirects, `?next=` safety, audit sanitiser, Argon2id, API client, navigation filter                                                                                                                | 159                    |
| Integration | `npm run test:integration` | real Postgres (`ecommerce_test`) and Redis (`ecom:test:` keys) | database constraints, concurrent stock reservations, rate-limit stores, Redis outage fallback, harness safety, identity constraints, sessions and RBAC, registration and sign-in races, addresses under concurrency, audit rows, client-IP trust behind a proxy (forged `X-Forwarded-For`), catalogue services (validation, conflicts, locking, lifecycle, audit atomicity, RBAC per role) | 75                     |
| HTTP        | `npm run test:http`        | running app (`npm run start:test`)                             | status codes, server-rendered 404s, security headers, health, identity APIs (cookies, origin check, error envelopes, account separation), sign-in redirects, forged `X-Forwarded-For` ignored when no proxy is trusted, catalogue admin API (auth, roles, validation, conflicts, concurrent edits)                                                                                         | 39                     |
| Browser     | `npm run test:e2e`         | running app (Playwright starts it if needed)                   | real Chromium, desktop and 360 px: 404 pages, the full customer account journey, every staff role, keyboard sign-in, field errors, no horizontal overflow, no page errors, **no CSP violations**, catalogue admin workflow (new type → product → variants → image → activate → filter), read-only staff, stale-version conflict                                                            | 40                     |

Rules from the plan: during development run only the test files touched; at the end of each wave run every
suite (regression).

## Test environment

- `APP_ENV=test` selects `config/config.test.json`: hosts `store.localhost:3100` and
  `admin.localhost:3100`, Redis prefix `ecom:test:`, Elasticsearch prefix `test`. Rate limits are 20 per
  minute for customer sign-in, 100 per minute for staff sign-in and 50 per minute for registration. Over
  plain local HTTP every registration shares one bucket (TD-015), and the browser suite signs in as the
  same staff account about 12 times per run, so lower limits made back-to-back runs fail with 429.
- `npm run start:test` (`scripts/start-test-server.ts`) checks `TEST_DATABASE_URL` with the target guard,
  creates and migrates the test database if needed, **resets it** (truncate, clear `ecom:test:` Redis keys,
  seed the demo identities with Argon2id hashes; `scripts/prepare-test-identity.ts`), then starts the
  already-built app on port 3100 with the test configuration. The same build serves development and test, which also exercises runtime
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

## Rate-limit tests and the clock

Rate-limit windows start on whole minutes. A test that sends "limit + 1" requests could straddle a boundary
and see the last request allowed. This happened once at the end of Wave 2B, after the test limits were
raised. Such tests call `waitForFreshRateLimitWindow()` (`tests/integration/support/rate-limit-window.ts`),
which waits for the next window when less than 10 s of the current one is left. A run started deliberately
8 s before a boundary passed.

## Smoke-testing the development server safely

Signing in on `npm run dev` writes sessions and audit rows to the **development** database, so Wave 2B
never exercised the dev server against development data. Use the isolated test database instead:

```bash
npm run start:test:dev    # resets ecommerce_test (guarded), clears ecom:test:* keys, seeds demo identities,
                          # then runs `next dev` on port 3100 with config.test.json
npm run test:http:dev     # in a second terminal: every HTTP test against the dev server
npm run test:e2e          # Playwright reuses the server already on port 3100
```

To look around by hand, open http://store.localhost:3100 or http://admin.localhost:3100 and sign in with
the README demo accounts. Nothing touches `ecommerce` (development); confirm with the fingerprint query in
the progress journal if in doubt. Stop the server with Ctrl+C.

The one expected difference from the production build: the dev server's CSP includes `'unsafe-eval'`
(needed by React Refresh, TD-006). `test:http:dev` asserts it is present; `test:http` asserts it is absent.

Result at the end of Wave 2B: `test:http:dev` 39 / 39 (40 / 40 after final check 7), `test:e2e` on `next dev` 40 / 40 in three
consecutive runs.

## Browser-test notes (Next 16)

- With Cache Components, Next 16 keeps the previous page mounted but hidden (React `<Activity>`). A label such
  as "Email" can then match a hidden input as well; tests use `visibleField()` from `e2e/support/auth.ts`.
- Next's route announcer also has `role="alert"`, so tests match alerts by their text.
- Radix Toast briefly duplicates each toast's text in a screen-reader announcement; match toasts inside the
  "Notifications" region. The dev-server smoke run exposed this; the faster production build had hidden it.

- The hidden copy also appears after `page.reload()`; use `visibleField()` for any labelled input, including
  per-row inputs such as a group's swatch labels (Wave 4). Form landmarks (`role="search"`) are named
  differently from the fields inside them, so a label never matches both.
- Permission tests try every write route or service, not one example, and check that nothing changed
  (rows, audit and outbox); Wave 4 also proved one such test fails when a service check is removed.
- Stop the test server before `npm run test:integration`: integration truncates `ecommerce_test`, which the
  test server also uses.

## Known limitations

- (Wave 2A) One run of the browser tests against `next dev` timed out in a reload loop (2026-11-07). At
  the end of Wave 2B, three consecutive runs on `next dev` passed with no full reloads logged. It did not
  reproduce in 4 later runs on a truly cold dev server (1 and 4 workers). Slow first-time compiles and
  Playwright's artifact writes were both tested and ruled out; the root cause is unknown. Each page
  compiled for the first time does reload once when hot reload connects (measured). `npm run test:e2e`
  and CI use the production build, which passed every run. If a dev-mode run loops again, keep the
  server log and the Playwright trace for diagnosis.
- CI has never been observed running (the GitHub token cannot read Actions results yet).

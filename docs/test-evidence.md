# Test evidence

Final run on 2026-11-15 (IST), macOS, Node v26.13.0, PostgreSQL 18 / Elasticsearch 9 / Redis 8 in Docker,
one production build (`npm run build`) served by `npm run start:test` (port 3100, test configuration).
Every database test ran against the guarded `ecommerce_test` database only. The same commands were then
repeated in an isolated copy (see "Fresh copy" below).

## Results

| Command                                  | Result                                                               |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `npm run typecheck`                      | exit 0                                                               |
| `npm run lint` (zero warnings allowed)   | exit 0                                                               |
| `npm run format:check`                   | exit 0, all files formatted                                          |
| `npm test` (unit)                        | exit 0, **481 / 481** passed, 59 files                               |
| `npm run test:integration`               | exit 0, **525 / 525** passed, 51 files                               |
| `npm run build`                          | exit 0, no warnings, 111 static pages                                |
| `npm run test:http` (against the build)  | exit 0, **122 / 122** passed, 14 files                               |
| `npm run test:e2e` (Playwright Chromium) | exit 0, **150 / 150** passed (50 tests × desktop, 360 px and 768 px) |

Server log of the HTTP and browser runs: no error-level entries; one warning, the deliberate expired
transaction from the inventory lock test (L43, `tests/http/inventory.http.test.ts` "transaction timeout").

Re-run after the TD-032 and TD-033 changes (same day): all eight commands exit 0 with the totals above (unit and
integration grew by the new regression tests); dev database fingerprint unchanged.

Note: run `test:http` once per fresh `npm run start:test`. Re-running it against the same server within a
minute exceeds the shared `customer-register` limit (client IP unknown in tests) and fails with 429 by
design.

### Fresh copy (2026-11-15, before TD-032; totals then 474 unit / 520 integration)

`git clone` of `HEAD` into a scratch folder, overlaid with exactly the files that would be committed (all
modified files, every untracked file that is not ignored, and the staged rename); its file set and
contents were compared byte for byte with the working tree (0 differences). `.env` came from
`.env.example`. In that copy: `npm ci --offline` exit 0 (0 vulnerabilities; packages from the local npm
cache, so registry download was not exercised), then format, lint, typecheck, unit (474 / 474), integration
(520 / 520), build, test server, HTTP (122 / 122) and browser (150 / 150), all exit 0. This first showed
that `npm run lint` failed on a clean checkout before `next typegen` had run (fixed: TD-031).

### Fresh database, CI sequence (2026-11-15)

Owner-approved, on a disposable `ecommerce_ci_check` database created for the run (connection verified to
point only at it) and dropped afterwards:

| Step                                                                     | Result                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:deploy`                                                      | exit 0, all **7** migrations applied                                                                                                                                                                                                                                                                    |
| `prisma migrate diff --from-config-datasource --to-schema … --exit-code` | exit 0, no difference (CI drift step)                                                                                                                                                                                                                                                                   |
| `npm run db:seed`                                                        | exit 0, 193 variants, 40 products, 57 order stock events                                                                                                                                                                                                                                                |
| Seed integrity (SQL)                                                     | plan §12A counts met (4 types, 36 categories, 8 brands, 3 warehouses, 2 couriers, 4 coupons, 5 staff in 5 roles, 3 customers, 20 orders in all 9 states); 32 order lines with complete snapshots matching their variant, category and group; 0 inconsistent stock levels; ledger and payments reconcile |
| Idempotency (seed run 3 more times)                                      | each exit 0; row counts identical; only `updated_at` changed                                                                                                                                                                                                                                            |

The development database (fingerprint `9cec751c29cab1faab002a9308e23887`, 5 migrations) and
`ecommerce_test` were unchanged before and after.

## Acceptance tests (plan §11)

| Brief                                 | Automated test                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Find → cart → order end to end     | `tests/integration/storefront-search.test.ts` (Elasticsearch search and facets); `tests/integration/checkout.test.ts` "places a COD order: priced, reserved, one shipment, payment pending, cart emptied, audited"; `e2e/commerce.spec.ts` customer journey (product → cart → checkout → confirmation) and admin journey  |
| 2. Stock re-checked, never negative   | `checkout.test.ts` "refuses with 409 when stock dropped after the item was added" and "10 parallel checkouts for 3 units across 2 warehouses reserve exactly 3, none negative"                                                                                                                                            |
| 3. No duplicate orders                | `checkout.test.ts` "the same key sent 5 times in parallel creates one order" and "the same key with a different request is refused with 422"; `tests/http/commerce.http.test.ts` 201 then 200 for a retried key                                                                                                           |
| 4. Failed payment / cancellation      | `tests/integration/order-lifecycle.test.ts` "delivery refused → RTO → payment FAILED and stock restocked on receipt" and "cancel before dispatch releases the reservation and voids the payment"                                                                                                                          |
| 5. Admin protected, reports reconcile | `commerce.http.test.ts` admin protection (customer session → 401/403, admin API 404 on the store host, role without permission → 403); `tests/integration/reports-and-customers.test.ts` "KPIs, daily totals, order rows and payment rows agree"; `tests/integration/report-exports.test.ts` (CSV totals = dashboard GMV) |

## Not covered here

- **Fresh `db:reset`**: the plan's Wave 14 "done when" runs the acceptance tests after `npm run db:reset`.
  Not run: it deletes the development data, and the owner excluded it. The integration harness instead
  applies every migration to `ecommerce_test` and each file truncates its tables.
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) passes on `d144a2f`, as reported by the owner
  from GitHub; the local token cannot read Actions results (L11), so the log is not reproduced here. Its
  steps were also reproduced locally: the code checks in the fresh copy and `db:deploy` + drift check +
  `db:seed` on a new database (both above).
- **Deployed URLs**: not deployed (owner decision); all results above are local.
- **Load**: concurrency is tested (parallel checkouts, reservations, transfers, return requests); volume
  and timeout behaviour under load are not (L26, L41, L43).

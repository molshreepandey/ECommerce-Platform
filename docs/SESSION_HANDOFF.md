# Session handoff

Updated 2026-11-11 after the Wave 5 step 2 commit (`ef16d46`, local, not pushed). Resume from exactly this state. Do **not**
recreate the project, reset any database, commit, push, or start Wave 5 step 3 (admin API) or any later
work without the owner's explicit approval.

## Latest: Wave 5 step 2, inventory services (2026-11-11, commit `ef16d46`, not pushed)

- `src/modules/inventory/`: warehouses; idempotent staff stock changes (add, remove, set as ADJUSTMENT;
  supplier receipts as RECEIPT); low-stock thresholds; internal `reserveStock`, `releaseReservation` and
  `applyReservationChanges` for Waves 8–9; read-only stock matrix, low-stock, ledger and availability
  queries. The catalogue "in stock" filter now uses the inventory definition (active warehouses only, D30).
- Rules, the global lock hierarchy (L0a orders → L0b shipments → L1 requests → L2 products → L3 variants →
  L4 warehouses → L5 stock rows → inserts) and the **reservation caller contract**: TD-019. Journal:
  "Wave 5 step 2". Limitations L35–L50 (mandatory: L40 dispatch races in Wave 9, L38 tracker check before
  Wave 8, L41 volume checks in Wave 14).
- Final review finding N1 fixed: in one `applyReservationChanges` call, every RELEASE on a stock row is
  applied before any RESERVE on it (then by shipment id), so a re-allocation can reserve the units it
  frees; the lock hierarchy is unchanged. Two regression tests cover both shipment-id orders.
- Full regression (2026-11-11, guarded `ecommerce_test`): 332 unit, 351 integration, 56 HTTP and 52
  browser tests pass; build, format, lint, typecheck and `git diff --check` pass. No schema or migration
  change. Development untouched: fingerprint still `9cec751c29cab1faab002a9308e23887`.
- Git: committed locally as `ef16d46` (50 files, parent `f6c018b`), followed by a documentation-only
  commit recording the N1 fix and the regression; neither is pushed.
- Next: the owner's approval to push, then plan step 3 (admin API: `Idempotency-Key` header, schemas at
  the boundary, retryable transaction-timeout error, aligned quantity limits, cursor validation).

## Wave 5 step 1, inventory ledger migration foundation (2026-11-10, commit `f6c018b`, pushed)

- Migrations `20261110150000_inventory_receipt_movement_type` and `20261110150100_inventory_ledger_integrity`
  (RECEIPT movement type, ledger CHECKs and indexes, low-stock index, `inventory_change_requests` for
  idempotent staff stock requests; decisions: TD-018).
- Tested on `ecommerce_test` (apply, hardened rollback, injected-failure checks, re-apply, no drift) and,
  with the owner's approval, **applied to development** with `npm run db:deploy` at 17:49:25 UTC (journal:
  "Wave 5 step 2"). Development and test each record **five migrations**.
- **Development fingerprint is now `9cec751c29cab1faab002a9308e23887`** (47 tables, 1,629 rows). The previous
  `04adce0841b9013d69f13b043ae4a245` is the state before these migrations; only the two `_prisma_migrations`
  rows and the empty `inventory_change_requests` table were added, and every existing table is identical.
- Backup before the migration (restore-verified):
  `~/ecommerce-backups/20261110-inventory-ledger/ecommerce-dev-before-inventory-ledger.dump` (sha256
  `62ff93c1…`), with the baselines and the full command log next to it.
- Rollback scripts: `prisma/rollbacks/20261110150100_…down.sql` first, then `…150000_…down.sql`, run only as
  `psql -d <db> -v expected_database=<db> < script` (no `-1`).
- Committed as "Wave 5 step 1: inventory ledger migrations, rollback scripts and constraint tests"
  (`f6c018b`, 11 files) and pushed to `origin/main` on 2026-11-10 (fast-forward `e0c3895..f6c018b`).

## Wave 4, category tree, tagging and product groups (2026-11-10, commit `e0c3895`, pushed)

- Committed as "Wave 4: category tree, tagging and product groups" (`e0c3895`), on top of `800dd41`: 13
  modified and 38 new code and test files, plus these docs (journal: "Wave 4"; decisions: TD-017; API:
  `docs/API_DOCUMENTATION.md`; walkthrough: `docs/walkthroughs/wave-4.md`; limitations L30–L34). Pushed to
  `origin/main` on 2026-11-10 (fast-forward `d7e3a0e..e0c3895`, which also published Waves 2A–3).
- **L31 is mandatory before Wave 8 order implementation:** decide and add category / group snapshots on
  order lines (or an explicit "current category" rule). L29 (browser access-denied test) remains open.
- No migration: the existing `categories` and `product_groups` schema fits.
- Tests: 270 unit, 215 integration, 56 HTTP, 52 browser; format, lint, typecheck and build pass.
- Development fingerprint at the Wave 4 commit: `04adce0841b9013d69f13b043ae4a245`; 0 development Redis
  keys; test servers stopped.
- The owner approved Wave 4 and its push; Wave 5 has started (above).

## Wave 3 step 4, catalogue admin API and UI (2026-11-10, commit `800dd41`, pushed with Wave 4)

- 19 admin API route files, 6 admin pages and the `CatalogueAdmin` components (journal: "Wave 3 step 4";
  API: `docs/API_DOCUMENTATION.md`; walkthrough: `docs/walkthroughs/wave-3.md`).
- Tests: 258 unit, 184 integration, 51 HTTP, 48 browser; format, lint, typecheck and build pass.
- Development fingerprint still `04adce0841b9013d69f13b043ae4a245`.
- Committed locally as "Wave 3 step 4: catalogue admin API, admin pages, HTTP and browser tests" (the
  commit containing this file). Pushed to GitHub on 2026-11-10 together with Wave 4.

## Wave 3 step 3, catalogue services (2026-11-10, commit `8b8ad00`, pushed with Wave 4)

- Service layer for D9–D15 in `src/modules/catalogue/` (journal: "Wave 3 step 3"; decisions: TD-016
  implementation notes). No HTTP routes or admin pages yet (L24).
- Tests: 258 unit, 184 integration, 40 HTTP, 40 browser; format, lint, typecheck and build pass.
- Development fingerprint still `04adce0841b9013d69f13b043ae4a245`; nothing written to development.
- Committed locally as "Wave 3 step 3: catalogue services (types, attributes, brands, products,
  variants, images, lifecycle)" (the commit containing this file). Pushed to GitHub on 2026-11-10 together
  with Wave 4.
- Next (approved): admin route handlers, HTTP tests, admin pages and E2E. Not to be committed without review.

## Wave 3 steps 1 and 2 (2026-11-10, commit `24563ed`, pushed with Wave 4)

- Migration `20261110093000_catalogue_integrity` is tested on `ecommerce_test` (apply, exact rollback with
  `prisma/rollbacks/…down.sql`, re-apply, no drift, full seed, 109 / 109 integration tests) and, with the
  owner's approval, **applied to development** with `npm run db:deploy` (journal: "Wave 3 step 2").
- **Development fingerprint became `04adce0841b9013d69f13b043ae4a245`** with this migration (superseded by
  `9cec751c…` in Wave 5). The old `3a6b72f9…` is the state before the migration. The only differences are
  the `products.version` column (0 everywhere) and one `_prisma_migrations` row; every other table is
  identical.
- **Backup of development before the migration (restore-verified):**
  `~/ecommerce-backups/20261110-catalogue-integrity/ecommerce-dev-before-catalogue-integrity.dump`
  (sha256 `5bfa8613…`), with the baseline files next to it.
- Committed locally as "Wave 3 steps 1-2: catalogue integrity migration (test and development)" (the
  commit that contains this file), on top of Wave 2B `f2c40ab`. Pushed to GitHub on 2026-11-10 together
  with Wave 4.
- Wave 3 services, APIs and pages are not started; they need the owner's approval.

## Where things stand

- **Waves 1–4 are finished, committed and pushed.** Wave 2B includes final check 7 (client IP behind
  proxies; `IMPLEMENTATION_PROGRESS.md`, "Wave 2B final check 7").
- **Wave 5 is in progress:** step 1 (migration foundation) is committed and pushed (`f6c018b`) and applied to
  development; step 2 (inventory services) is committed locally (`ef16d46`) but not pushed; steps 3 (admin API) and 4
  (admin pages) are not started.

## Git state (2026-11-11, Wave 5 step 2)

| Item                      | Value                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Branch                    | `main`                                                                                                                                                 |
| HEAD                      | the documentation follow-up to Wave 5 step 2; its parent is `ef16d46` (Wave 5 step 2), whose parent is `f6c018b` (Wave 5 step 1)                       |
| Relative to `origin/main` | 2 ahead (`ef16d46` and the documentation follow-up), not pushed; `origin/main` is `f6c018b`, pushed on 2026-11-10 as a fast-forward `e0c3895..f6c018b` |
| On GitHub                 | `fa6ebd6`, `d7e3a0e` (Wave 1); `6863ad2`, `6d60892` (2A); `f2c40ab` (2B); `24563ed`, `8b8ad00`, `800dd41` (3); `e0c3895` (4); `f6c018b` (5 step 1)     |
| Working tree              | clean                                                                                                                                                  |

### Wave 2B commit contents (historical record, `f2c40ab`)

The Wave 2B commit contains 138 files: 32 modified and 106 new, 0 deleted.

Modified files in the commit (32):

```
IMPLEMENTATION_PROGRESS.md
README.md
config/config.development.json
config/config.production.json
config/config.staging.json
config/config.test.json
docs/API_DOCUMENTATION.md
docs/ARCHITECTURE.md
docs/DEPLOYMENT_GUIDE.md
docs/REQUIREMENTS_TRACEABILITY.md
docs/TECHNICAL_DECISIONS.md
docs/TESTING_STRATEGY.md
e2e/not-found.spec.ts
package-lock.json
package.json
prisma/schema.prisma
prisma/seed/identity.seed.ts
prisma/seed/index.ts
scripts/start-test-server.ts
src/app/admin/admin-shell.ts
src/app/admin/page.tsx
src/app/store/store-shell.ts
src/components/atoms/Icon/icon-registry.ts
src/lib/config/config.schema.ts
src/lib/config/load-config.test.ts
src/lib/db.ts
src/proxy.ts
tests/http/app-server.ts
tests/http/not-found.http.test.ts
tests/http/security-headers.http.test.ts
tests/integration/rate-limit-redis-down.test.ts
tests/integration/rate-limit.test.ts
```

New files in the commit (106), by folder:

| Folder               | Files |
| -------------------- | ----- |
| `docs/` (this file)  | 1     |
| `docs/walkthroughs`  | 1     |
| `e2e`, `e2e/support` | 3     |
| `prisma/migrations`  | 1     |
| `prisma/seed`        | 3     |
| `scripts`            | 1     |
| `src/app`            | 17    |
| `src/components`     | 30    |
| `src/lib`            | 12    |
| `src/modules`        | 25    |
| `tests/http`         | 3     |
| `tests/integration`  | 9     |

Check 7 added `tests/http/client-ip.http.test.ts`, `tests/integration/client-ip-trust.test.ts` and the
`docs/DEPLOYMENT_GUIDE.md` change; `src/lib/client-ip.ts` and its test were already new in Wave 2B.

## Latest passing tests (Wave 5 step 2 full regression, 2026-11-11, Node v26.13.0)

Load Node with `source ~/.nvm/nvm.sh && nvm use 26.13.0` first (a plain shell here starts on v20).

| Command                                              | Result                     |
| ---------------------------------------------------- | -------------------------- |
| `npm run format:check`, `lint`, `typecheck`, `build` | all exit 0                 |
| `git diff --check`                                   | clean                      |
| `npm test`                                           | 332 / 332                  |
| `npm run test:integration`                           | 351 / 351                  |
| `npm run test:http` (production build)               | 56 / 56                    |
| `npm run test:e2e` (production build)                | 52 / 52 (desktop + 360 px) |

The dev-server variants (`npm run test:http:dev`, `npm run test:e2e` on `next dev`) were not part of this
regression; they last ran in the 2026-11-10 regression (40 / 40 each). After the regression only
documentation changed (journal, handoff, testing strategy, traceability, TD-019).

## Databases and services

- **Development database `ecommerce`:** fingerprint `9cec751c29cab1faab002a9308e23887` (47 tables, 1,629
  rows) since the Wave 5 inventory ledger migrations on 2026-11-10; five migrations recorded. Unchanged
  through Wave 5 step 2 and its full regression (re-checked read-only on 2026-11-11).
  - Before those migrations: `04adce0841b9013d69f13b043ae4a245` (46 tables, 1,627 rows), since the catalogue
    integrity migration on 2026-11-10.
  - Before that migration: `3a6b72f9d53ed06b19f3f136d24b84a6` (unchanged from Wave 2B Step B until then).
  - Wave 2B baseline: `84956ffb57af5da58ba41b5ea154611d`.
- **Test database `ecommerce_test`:** reset by `npm run start:test` and by the integration tests. Holds
  only test data; five migrations recorded.
- **Redis:** 0 development keys (test rate-limit counters expire within a minute).
- **Containers:** postgres 18.6, elasticsearch 9.5.5 and redis 8.10.3. Their restart policy is `no`, so
  after a reboot they must be started with `docker start` on the three existing containers (never
  recreated).
- **Servers:** none left running (ports 3000, 3100 and 3200 free).

To re-check the development fingerprint (read-only):

```bash
docker exec -i ecommerce-platform-postgres-1 psql -U ecommerce -d ecommerce -At -F ' ' <<'SQL' | md5
select c.relname as table_name,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I', c.relname), false, true, '')))[1]::text::bigint as row_count,
       (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(t::text, ''|'' order by t::text), '''')) as h from %I t', c.relname), false, true, '')))[1]::text as content_md5
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;
SQL
# expected: 9cec751c29cab1faab002a9308e23887
```

If Docker is not running, this prints `d41d8cd98f00b204e9800998ecf8427e` (the md5 of empty input), which is
not a database result.

## Pending items

| #   | Item                                             | Status                                                             |
| --- | ------------------------------------------------ | ------------------------------------------------------------------ |
| 1   | Wave 5 step 1 migrations on test and development | done; committed and pushed (`f6c018b`)                             |
| 2   | Wave 5 step 2 inventory services                 | done; N1 fixed; committed locally (`ef16d46`)                      |
| 3   | Full regression and commit of step 2             | done 2026-11-11 (332 unit, 351 integration, 56 HTTP, 52 browser)   |
| 4   | Wave 5 steps 3–4 (admin API and pages)           | not approved yet                                                   |
| 5   | Push to GitHub                                   | up to `f6c018b`; step 2 and its documentation follow-up not pushed |

Recorded, not implemented (owner decision): L20 per-account sign-in limit (lockout trade-off), L21 session
not revoked on re-login. Mandatory in Wave 8: L22 order-item composite key, L23 weight and dimension
snapshot, L31 category and group snapshot decision (before order implementation), L47 reservation caller
contract (TD-019). Mandatory in Wave 9: L40 real dispatch and cancellation race tests. Before Wave 8: L38
lock-tracker check. Outstanding limitations: L1–L50 in `docs/REQUIREMENTS_TRACEABILITY.md`.
Deployment requirement (not a finished production setting): staging and production keep
`trustedProxyHopCount` at 0 until the real proxy topology is verified (TD-015, DEPLOYMENT_GUIDE).

## Exact next steps

1. Check that nothing changed: `main` is two commits ahead of `origin/main` (`f6c018b`): `ef16d46` (Wave 5
   step 2) and its documentation follow-up; the working tree is clean; the development fingerprint is
   `9cec751c…`; both databases record five migrations; three healthy containers.
2. Wait for the owner's approval before pushing or starting Wave 5 step 3. Do not seed development, or reset or truncate any
   database without explicit approval.

## Rules still in force

- Never run `npm run db:reset`, migrations, destructive statements or deletions on the development
  database without explicit approval.
- No commit or push without explicit approval; never add Claude or AI attribution to commits.
- Redis must never be the only protection for inventory, orders or payments. PostgreSQL is the source of
  truth.
- The demo password `DemoPass!2026` is for development and test only.
- `trustedProxyHopCount` stays 0 everywhere until the hosting topology is verified (TD-015).
- Keep the traceability matrix, walkthroughs and the journal up to date every wave.

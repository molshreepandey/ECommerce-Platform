# Session handoff

Updated 2026-11-10 and committed with Wave 4. Resume from exactly this state. Do **not** recreate the
project, reset any database, commit, push or start Wave 5 without the owner's explicit approval.

## Latest: Wave 4, category tree, tagging and product groups (2026-11-10, committed locally, not pushed)

- Committed locally as "Wave 4: category tree, tagging and product groups" (the commit containing this
  file), on top of `800dd41`: 13 modified and 38 new code and test files, plus these docs (journal: "Wave
  4"; decisions: TD-017; API: `docs/API_DOCUMENTATION.md`; walkthrough: `docs/walkthroughs/wave-4.md`;
  limitations L30–L34). Not pushed.
- **L31 is mandatory before Wave 8 order implementation:** decide and add category / group snapshots on
  order lines (or an explicit "current category" rule). L29 (browser access-denied test) remains open.
- No migration: the existing `categories` and `product_groups` schema fits.
- Tests: 270 unit, 215 integration, 56 HTTP, 52 browser; format, lint, typecheck and build pass.
- Development fingerprint still `04adce0841b9013d69f13b043ae4a245`; 0 development Redis keys; test servers
  stopped.
- Next: owner review of Wave 4. Commit only with approval (no AI attribution); Wave 5 needs approval.

## Latest: Wave 3 step 4, catalogue admin API and UI (2026-11-10, committed locally, not pushed)

- 19 admin API route files, 6 admin pages and the `CatalogueAdmin` components (journal: "Wave 3 step 4";
  API: `docs/API_DOCUMENTATION.md`; walkthrough: `docs/walkthroughs/wave-3.md`).
- Tests: 258 unit, 184 integration, 51 HTTP, 48 browser; format, lint, typecheck and build pass.
- Development fingerprint still `04adce0841b9013d69f13b043ae4a245`.
- Committed locally as "Wave 3 step 4: catalogue admin API, admin pages, HTTP and browser tests" (the
  commit containing this file). Not pushed. Wave 4 needs the owner's approval.

## Latest: Wave 3 step 3, catalogue services (2026-11-10, committed locally, not pushed)

- Service layer for D9–D15 in `src/modules/catalogue/` (journal: "Wave 3 step 3"; decisions: TD-016
  implementation notes). No HTTP routes or admin pages yet (L24).
- Tests: 258 unit, 184 integration, 40 HTTP, 40 browser; format, lint, typecheck and build pass.
- Development fingerprint still `04adce0841b9013d69f13b043ae4a245`; nothing written to development.
- Committed locally as "Wave 3 step 3: catalogue services (types, attributes, brands, products,
  variants, images, lifecycle)" (the commit containing this file). Not pushed.
- Next (approved): admin route handlers, HTTP tests, admin pages and E2E. Not to be committed without review.

## Latest: Wave 3 steps 1 and 2 (2026-11-10, committed locally, not pushed)

- Migration `20261110093000_catalogue_integrity` is tested on `ecommerce_test` (apply, exact rollback with
  `prisma/rollbacks/…down.sql`, re-apply, no drift, full seed, 109 / 109 integration tests) and, with the
  owner's approval, **applied to development** with `npm run db:deploy` (journal: "Wave 3 step 2").
- **Development fingerprint is now `04adce0841b9013d69f13b043ae4a245`.** The old `3a6b72f9…` is the state
  before the migration. The only differences are the `products.version` column (0 everywhere) and one
  `_prisma_migrations` row; every other table is identical.
- **Backup of development before the migration (restore-verified):**
  `~/ecommerce-backups/20261110-catalogue-integrity/ecommerce-dev-before-catalogue-integrity.dump`
  (sha256 `5bfa8613…`), with the baseline files next to it.
- Committed locally as "Wave 3 steps 1-2: catalogue integrity migration (test and development)" (the
  commit that contains this file), on top of Wave 2B `f2c40ab`. Not pushed; pushing needs approval.
- Wave 3 services, APIs and pages are not started; they need the owner's approval.

## Where things stand

- **Wave 2B is finished and verified, including final check 7** (client IP behind proxies; details in
  `IMPLEMENTATION_PROGRESS.md`, "Wave 2B final check 7"). The owner approved check 7 and the commit.
- **Wave 2B is committed locally** as "Wave 2B: accounts, sessions, roles, addresses and audit trail" (the
  commit that contains this file). It is **not pushed**; pushing needs separate approval.
- **Nothing pushed. Wave 3 not started.** The owner approved the Wave 3 design in principle (with
  decisions on `products.version`, immutable SKUs and option values, slug editable only in DRAFT,
  read-only category/tagging/group/stock filters, and audited hard deletion of images). Before Wave 3
  implementation the owner asked for a read-only confirmation of database relationships, foreign-key
  behaviour, migration safety and compatibility with the inventory, cart and order modules.

## Git state

| Item                      | Value                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------- |
| Branch                    | `main`                                                                             |
| HEAD                      | the Wave 2B commit (message above), parent `6d60892` (Wave 2A verification record) |
| Relative to `origin/main` | ahead 3 (`6863ad2`, `6d60892` for Wave 2A, then Wave 2B), none pushed              |
| Working tree              | clean right after the commit                                                       |

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

## Latest passing tests (final regression, 2026-11-10 08:59–09:02 UTC, Node v26.13.0)

Load Node with `source ~/.nvm/nvm.sh && nvm use 26.13.0` first (a plain shell here starts on v20).

| Command                                              | Result                     |
| ---------------------------------------------------- | -------------------------- |
| `npm run format:check`, `lint`, `typecheck`, `build` | all exit 0                 |
| `npm test`                                           | 179 / 179                  |
| `npm run test:integration`                           | 83 / 83                    |
| `npm run test:http` (production build)               | 40 / 40                    |
| `npm run test:e2e` (production build)                | 40 / 40 (desktop + 360 px) |
| `npm run test:http:dev` (dev server, test DB)        | 40 / 40                    |
| `npm run test:e2e` on the dev server                 | 40 / 40                    |

After the regression only documentation changed (journal, traceability, testing strategy, this file).

## Databases and services

- **Development database `ecommerce`:** fingerprint `04adce0841b9013d69f13b043ae4a245` (46 tables, 1,627
  rows) since the catalogue integrity migration on 2026-11-10.
  - Before that migration: `3a6b72f9d53ed06b19f3f136d24b84a6` (unchanged from Wave 2B Step B until then).
  - Wave 2B baseline: `84956ffb57af5da58ba41b5ea154611d`.
- **Test database `ecommerce_test`:** reset by `npm run start:test` and by the integration tests. Holds
  only test data.
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
# expected: 04adce0841b9013d69f13b043ae4a245
```

If Docker is not running, this prints `d41d8cd98f00b204e9800998ecf8427e` (the md5 of empty input), which is
not a database result.

## Pending items

| #   | Item                                                 | Status                     |
| --- | ---------------------------------------------------- | -------------------------- |
| 1   | Wave 3 steps 1-2 (migration on test and development) | done and committed locally |
| 2   | Apply the migration to the development database      | done (Wave 3 step 2)       |
| 3   | Wave 3 services, APIs and pages                      | not approved yet           |
| 4   | Push to GitHub                                       | not approved               |

Recorded, not implemented (owner decision): L20 per-account sign-in limit (lockout trade-off), L21 session
not revoked on re-login. Mandatory in Wave 8: L22 order-item composite key, L23 weight and dimension
snapshot, L31 category and group snapshot decision (before order implementation). Outstanding limitations: L1–L23 in `docs/REQUIREMENTS_TRACEABILITY.md`.
Deployment requirement (not a finished production setting): staging and production keep
`trustedProxyHopCount` at 0 until the real proxy topology is verified (TD-015, DEPLOYMENT_GUIDE).

## Exact next steps

1. Check that nothing changed: HEAD is the Wave 3 steps 1-2 commit (parent `f2c40ab`); the working tree is
   clean; the development fingerprint is `04adce08…`; both databases have 3 migrations; three healthy
   containers.
2. Wait for the owner's approval before starting the Wave 3 catalogue services. Do not push, seed
   development, or reset or truncate any database without explicit approval.

## Rules still in force

- Never run `npm run db:reset`, migrations, destructive statements or deletions on the development
  database without explicit approval.
- No commit or push without explicit approval; never add Claude or AI attribution to commits.
- Redis must never be the only protection for inventory, orders or payments. PostgreSQL is the source of
  truth.
- The demo password `DemoPass!2026` is for development and test only.
- `trustedProxyHopCount` stays 0 everywhere until the hosting topology is verified (TD-015).
- Keep the traceability matrix, walkthroughs and the journal up to date every wave.

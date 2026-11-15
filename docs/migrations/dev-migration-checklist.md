# Applying the pending migrations to the development database

Status (2026-11-15): `20261114090000_order_snapshots_online_payment` and
`20261114180000_shipment_manifest_index` are applied to `ecommerce_test` only. Development has 5
migrations and fingerprint `9cec751c29cab1faab002a9308e23887`. **The current code needs both**
(order-line snapshot columns, `payment_attempts`, `PaymentMethod.ONLINE`), so checkout, orders and online
payment fail against development until they are applied. Run this only with the owner's approval.

## Review results (read-only, 2026-11-15)

- `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` against
  `ecommerce_test` (all 7 migrations): **No difference detected**.
- Pre-flight on development (SELECT only): 32 order items, 20 orders; 0 items without a variant, 0 items
  whose product differs from the variant's product (composite FK), 0 variants with a non-positive
  dimension, 0 orders with an idempotency key or request fingerprint the new CHECKs refuse; the unique
  `(product_id, id)` index the composite FK needs exists. The migration should apply cleanly.
- `ALTER TYPE "PaymentMethod" ADD VALUE 'ONLINE'` runs in the migration transaction (PostgreSQL 12+);
  the value is not used in the same migration.
- Rollbacks: `prisma/rollbacks/*.down.sql` drop exactly what the migrations add, refuse to run on the
  wrong database or when the migration is not applied, and the snapshot rollback refuses once ONLINE
  payments or payment attempts exist (an enum value in use cannot be removed). Snapshot column values are
  lost on rollback. `orders.payment_method` and `payments.payment_method` are the only enum users.

## Steps

```bash
source ~/.nvm/nvm.sh && nvm use 26.13.0
cd ~/ECommerce-Platform
B=~/ecommerce-backups/$(date +%Y%m%d)-pending-migrations && mkdir -p "$B"

# 1. Fingerprint before (expected 9cec751c29cab1faab002a9308e23887; see docs/SESSION_HANDOFF.md for the query)
# 2. Backup and prove it restores
docker exec ecommerce-platform-postgres-1 pg_dump -U ecommerce -d ecommerce -Fc > "$B/ecommerce.dump"
docker exec ecommerce-platform-postgres-1 psql -U ecommerce -d postgres -c 'CREATE DATABASE ecommerce_restore_check'
docker exec -i ecommerce-platform-postgres-1 pg_restore -U ecommerce -d ecommerce_restore_check < "$B/ecommerce.dump"
docker exec ecommerce-platform-postgres-1 psql -U ecommerce -d ecommerce_restore_check -Atc 'select count(*) from orders'   # expect 20
docker exec ecommerce-platform-postgres-1 psql -U ecommerce -d postgres -c 'DROP DATABASE ecommerce_restore_check'

# 3. Apply (development database from .env)
npx prisma migrate status
npm run db:deploy
npx prisma migrate status                      # expect: Database schema is up to date

# 4. Verify
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code   # No difference
docker exec ecommerce-platform-postgres-1 psql -U ecommerce -d ecommerce -Atc \
  "select count(*) from order_items where weight_grams is null"    # expect 0
docker exec ecommerce-platform-postgres-1 psql -U ecommerce -d ecommerce -Atc "select count(*) from orders"   # still 20
# then record the new fingerprint in docs/SESSION_HANDOFF.md
```

## Roll back (reverse order, only if needed)

```bash
docker exec -i ecommerce-platform-postgres-1 psql -U ecommerce -d ecommerce -v expected_database=ecommerce \
  < prisma/rollbacks/20261114180000_shipment_manifest_index.down.sql
docker exec -i ecommerce-platform-postgres-1 psql -U ecommerce -d ecommerce -v expected_database=ecommerce \
  < prisma/rollbacks/20261114090000_order_snapshots_online_payment.down.sql
# or restore the dump: pg_restore --clean -d ecommerce "$B/ecommerce.dump"
```

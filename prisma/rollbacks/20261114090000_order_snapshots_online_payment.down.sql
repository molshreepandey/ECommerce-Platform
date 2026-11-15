-- Reverses prisma/migrations/20261114090000_order_snapshots_online_payment. Prisma has no down migrations.
--
-- The only supported way to run it (name the database twice: once to connect, once to confirm):
--   docker exec -i ecommerce-platform-postgres-1 psql -U ecommerce -d ecommerce_test \
--     -v expected_database=ecommerce_test \
--     < prisma/rollbacks/20261114090000_order_snapshots_online_payment.down.sql
-- Do not add -1: the script opens and commits its own transaction; any error rolls everything back.
-- It refuses to run once an ONLINE payment or a payment attempt exists, because PostgreSQL cannot drop an
-- enum value that rows use, and dropping payment_attempts would lose them. Snapshot columns are dropped
-- (their values are recoverable only while the variants and products are unchanged).

\set ON_ERROR_STOP on
\if :{?expected_database}
\else
  DO $$ BEGIN RAISE EXCEPTION 'refusing to run: pass -v expected_database=<database name> (see the header of this script)'; END $$;
\endif

BEGIN;

SELECT set_config('rollback.expected_database', :'expected_database', true);

DO $$
BEGIN
    IF current_database() <> current_setting('rollback.expected_database') THEN
        RAISE EXCEPTION 'connected to %, but expected_database is %; refusing to run',
            current_database(), current_setting('rollback.expected_database');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261114090000_order_snapshots_online_payment') THEN
        RAISE EXCEPTION '20261114090000_order_snapshots_online_payment is not applied here; nothing to roll back';
    END IF;
    IF EXISTS (SELECT 1 FROM "payment_attempts") THEN
        RAISE EXCEPTION 'payment_attempts has rows; refusing to drop it';
    END IF;
    IF EXISTS (SELECT 1 FROM "payments" WHERE payment_method::text = 'ONLINE')
        OR EXISTS (SELECT 1 FROM "orders" WHERE payment_method::text = 'ONLINE') THEN
        RAISE EXCEPTION 'ONLINE payments exist; refusing to remove the enum value';
    END IF;
END $$;

DROP INDEX "courier_webhook_receipts_received_at_id_idx";
DROP INDEX "customers_created_at_id_idx";
DROP INDEX "payments_status_collected_at_idx";
DROP TABLE "payment_attempts";
DROP TYPE "PaymentAttemptOutcome";

ALTER TABLE "orders" DROP CONSTRAINT "orders_request_fingerprint_check";
ALTER TABLE "orders" DROP CONSTRAINT "orders_idempotency_key_check";

ALTER TABLE "order_items" DROP CONSTRAINT "order_items_product_id_variant_id_fkey";
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_category_snapshot_check";
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_dimensions_check";
ALTER TABLE "order_items"
    DROP COLUMN "product_group_id",
    DROP COLUMN "category_name",
    DROP COLUMN "category_path",
    DROP COLUMN "category_id",
    DROP COLUMN "height_mm",
    DROP COLUMN "breadth_mm",
    DROP COLUMN "length_mm",
    DROP COLUMN "weight_grams";

-- PostgreSQL cannot drop one enum value: rebuild the type without ONLINE.
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_with_online";
CREATE TYPE "PaymentMethod" AS ENUM ('COD');
ALTER TABLE "orders" ALTER COLUMN "payment_method" DROP DEFAULT;
ALTER TABLE "orders" ALTER COLUMN "payment_method" TYPE "PaymentMethod" USING payment_method::text::"PaymentMethod";
ALTER TABLE "orders" ALTER COLUMN "payment_method" SET DEFAULT 'COD';
ALTER TABLE "payments" ALTER COLUMN "payment_method" TYPE "PaymentMethod" USING payment_method::text::"PaymentMethod";
DROP TYPE "PaymentMethod_with_online";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261114090000_order_snapshots_online_payment';

COMMIT;

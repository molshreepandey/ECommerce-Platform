-- Reverses prisma/migrations/20261110150100_inventory_ledger_integrity. Prisma has no down migrations.
-- Roll back this migration BEFORE 20261110150000_inventory_receipt_movement_type.
--
-- The only supported way to run it (name the database twice: once to connect, once to confirm):
--   docker exec -i ecommerce-platform-postgres-1 psql -U ecommerce -d ecommerce_test \
--     -v expected_database=ecommerce_test \
--     < prisma/rollbacks/20261110150100_inventory_ledger_integrity.down.sql
-- Do not add -1: the script opens and commits its own transaction. Any error stops psql (ON_ERROR_STOP is
-- set below) before COMMIT, the connection closes and PostgreSQL rolls the whole transaction back, so no
-- partial schema change can remain.
-- Stock and ledger rows are kept. It refuses to run once staff stock requests exist, because dropping
-- inventory_change_requests would lose them. Afterwards `prisma migrate deploy` re-applies the migration.

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
    IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261110150100_inventory_ledger_integrity') THEN
        RAISE EXCEPTION '20261110150100_inventory_ledger_integrity is not applied here; nothing to roll back';
    END IF;
    IF EXISTS (SELECT 1 FROM "inventory_change_requests") THEN
        RAISE EXCEPTION 'inventory_change_requests has rows; refusing to drop it';
    END IF;
END $$;

ALTER TABLE "inventory_change_requests" DROP CONSTRAINT "inventory_change_requests_request_fingerprint_check";
ALTER TABLE "inventory_change_requests" DROP CONSTRAINT "inventory_change_requests_idempotency_key_check";
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_reason_check";
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_quantity_delta_sign_check";
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_quantities_after_check";

DROP TABLE "inventory_change_requests";

DROP INDEX "inventory_levels_low_stock_idx";
DROP INDEX "inventory_movements_reference_type_reference_id_idx";
DROP INDEX "inventory_movements_movement_type_created_at_id_idx";
DROP INDEX "inventory_movements_created_at_id_idx";

-- The original indexes come back before their wider replacements are dropped.
CREATE INDEX "inventory_movements_variant_id_created_at_idx" ON "inventory_movements"("variant_id", "created_at" DESC);
CREATE INDEX "inventory_movements_warehouse_id_created_at_idx" ON "inventory_movements"("warehouse_id", "created_at" DESC);
DROP INDEX "inventory_movements_variant_id_created_at_id_idx";
DROP INDEX "inventory_movements_warehouse_id_created_at_id_idx";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261110150100_inventory_ledger_integrity';

COMMIT;

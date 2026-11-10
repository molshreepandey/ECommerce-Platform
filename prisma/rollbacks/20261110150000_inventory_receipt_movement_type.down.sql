-- Reverses prisma/migrations/20261110150000_inventory_receipt_movement_type. Prisma has no down migrations.
-- Run it only AFTER 20261110150100_inventory_ledger_integrity.down.sql (that migration's CHECK uses
-- RECEIPT); it refuses otherwise. Postgres cannot drop one enum value, so the type is rebuilt without it.
--
-- The only supported way to run it (name the database twice: once to connect, once to confirm):
--   docker exec -i ecommerce-platform-postgres-1 psql -U ecommerce -d ecommerce_test \
--     -v expected_database=ecommerce_test \
--     < prisma/rollbacks/20261110150000_inventory_receipt_movement_type.down.sql
-- Do not add -1: the script opens and commits its own transaction. Any error stops psql (ON_ERROR_STOP is
-- set below) before COMMIT, the connection closes and PostgreSQL rolls the whole transaction back, so no
-- partial schema change can remain.
-- It refuses to run while any RECEIPT movement exists, so no ledger row can be lost or changed.

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
    IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261110150000_inventory_receipt_movement_type') THEN
        RAISE EXCEPTION '20261110150000_inventory_receipt_movement_type is not applied here; nothing to roll back';
    END IF;
    IF EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261110150100_inventory_ledger_integrity') THEN
        RAISE EXCEPTION 'roll back 20261110150100_inventory_ledger_integrity first';
    END IF;
    IF EXISTS (SELECT 1 FROM "inventory_movements" WHERE movement_type::text = 'RECEIPT') THEN
        RAISE EXCEPTION 'RECEIPT movements exist; refusing to remove the movement type';
    END IF;
END $$;

ALTER TYPE "InventoryMovementType" RENAME TO "InventoryMovementType_with_receipt";
CREATE TYPE "InventoryMovementType" AS ENUM (
    'RESERVE', 'RELEASE', 'DISPATCH', 'RETURN_RESTOCK', 'RTO_RESTOCK', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN'
);
ALTER TABLE "inventory_movements"
    ALTER COLUMN "movement_type" TYPE "InventoryMovementType" USING movement_type::text::"InventoryMovementType";
DROP TYPE "InventoryMovementType_with_receipt";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261110150000_inventory_receipt_movement_type';

COMMIT;

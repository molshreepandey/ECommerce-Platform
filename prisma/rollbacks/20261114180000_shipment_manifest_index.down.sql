-- Reverses prisma/migrations/20261114180000_shipment_manifest_index. Prisma has no down migrations.
--
-- The only supported way to run it (name the database twice: once to connect, once to confirm):
--   docker exec -i ecommerce-platform-postgres-1 psql -U ecommerce -d ecommerce_test \
--     -v expected_database=ecommerce_test \
--     < prisma/rollbacks/20261114180000_shipment_manifest_index.down.sql
-- Do not add -1: the script opens and commits its own transaction; any error rolls everything back.
-- Drops one index; no data is lost.

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
    IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261114180000_shipment_manifest_index') THEN
        RAISE EXCEPTION '20261114180000_shipment_manifest_index is not applied here; nothing to roll back';
    END IF;
END $$;

DROP INDEX "shipments_warehouse_id_shipped_at_idx";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261114180000_shipment_manifest_index';

COMMIT;

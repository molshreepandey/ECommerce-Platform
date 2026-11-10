-- Reverses prisma/migrations/20261110093000_catalogue_integrity. Prisma has no down migrations.
-- Run as one transaction, against an explicitly named database, for example:
--   docker exec -i ecommerce-platform-postgres-1 psql -U ecommerce -d ecommerce_test -v ON_ERROR_STOP=1 -1 \
--     < prisma/rollbacks/20261110093000_catalogue_integrity.down.sql
-- Rows are kept. The only data lost is products.version (edit counters), which the old schema did not have.
-- Afterwards `prisma migrate deploy` re-applies the migration, because its _prisma_migrations row is removed.

ALTER TABLE "product_media" DROP CONSTRAINT IF EXISTS "product_media_alt_text_check";
ALTER TABLE "product_media" DROP CONSTRAINT IF EXISTS "product_media_position_check";
ALTER TABLE "product_variants" DROP CONSTRAINT IF EXISTS "product_variants_sku_format_check";
ALTER TABLE "attribute_definitions" DROP CONSTRAINT IF EXISTS "attribute_definitions_variant_option_enum_check";
ALTER TABLE "attribute_definitions" DROP CONSTRAINT IF EXISTS "attribute_definitions_allowed_values_check";
ALTER TABLE "attribute_definitions" DROP CONSTRAINT IF EXISTS "attribute_definitions_code_format_check";
ALTER TABLE "product_types" DROP CONSTRAINT IF EXISTS "product_types_code_format_check";
ALTER TABLE "brands" DROP CONSTRAINT IF EXISTS "brands_slug_format_check";
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_slug_format_check";
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_archived_at_check";
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_version_check";

-- The composite foreign key depends on the (product_id, id) unique index, so it goes first.
ALTER TABLE "product_media" DROP CONSTRAINT IF EXISTS "product_media_product_id_variant_id_fkey";
DROP INDEX IF EXISTS "products_name_id_idx";
DROP INDEX IF EXISTS "product_variants_product_id_id_key";
DROP INDEX IF EXISTS "product_variants_option_values_path_idx";

ALTER TABLE "products" DROP COLUMN IF EXISTS "version";
ALTER TABLE "product_media" ALTER COLUMN "alt_text" SET DEFAULT '';
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261110093000_catalogue_integrity';

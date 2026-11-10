-- DropForeignKey
ALTER TABLE "product_media" DROP CONSTRAINT "product_media_variant_id_fkey";

-- AlterTable
ALTER TABLE "product_media" ALTER COLUMN "alt_text" DROP DEFAULT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "product_variants_option_values_path_idx" ON "product_variants" USING GIN ("option_values" jsonb_path_ops);

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_id_key" ON "product_variants"("product_id", "id");

-- CreateIndex
CREATE INDEX "products_name_id_idx" ON "products"("name", "id");

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_variant_id_fkey" FOREIGN KEY ("product_id", "variant_id") REFERENCES "product_variants"("product_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Constraints Prisma cannot express in schema.prisma (Wave 3 catalogue rules, TD-016).
-- The development data was checked read-only before this migration: 0 rows violate any of them.

-- Optimistic-locking counter never goes below its starting value.
ALTER TABLE "products"
    ADD CONSTRAINT "products_version_check" CHECK (version >= 0);

-- Status and archived_at describe the same lifecycle and must agree.
ALTER TABLE "products"
    ADD CONSTRAINT "products_archived_at_check" CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL));

-- Slugs are lower-case words joined by single hyphens; codes are lower snake case.
ALTER TABLE "products"
    ADD CONSTRAINT "products_slug_format_check" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "brands"
    ADD CONSTRAINT "brands_slug_format_check" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "product_types"
    ADD CONSTRAINT "product_types_code_format_check" CHECK (code ~ '^[a-z][a-z0-9_]{0,39}$');

ALTER TABLE "attribute_definitions"
    ADD CONSTRAINT "attribute_definitions_code_format_check" CHECK (code ~ '^[a-z][a-z0-9_]{0,39}$');

-- Choice attributes need a non-empty list of allowed values; other types have none.
-- jsonb_array_length is only reached for arrays (CASE), so odd values fail the check instead of erroring.
ALTER TABLE "attribute_definitions"
    ADD CONSTRAINT "attribute_definitions_allowed_values_check" CHECK (
        (data_type IN ('ENUM', 'MULTI_ENUM')) =
        (CASE WHEN jsonb_typeof(allowed_values) = 'array' THEN jsonb_array_length(allowed_values) > 0 ELSE false END)
    );

-- Variants are generated from single-choice options, so a variant option must be an ENUM.
ALTER TABLE "attribute_definitions"
    ADD CONSTRAINT "attribute_definitions_variant_option_enum_check" CHECK (scope <> 'VARIANT_OPTION' OR data_type = 'ENUM');

-- SKUs are upper-case words joined by single hyphens, at most 64 characters (matches the seed format).
ALTER TABLE "product_variants"
    ADD CONSTRAINT "product_variants_sku_format_check" CHECK (char_length(sku) <= 64 AND sku ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$');

-- Image order starts at 0; every image needs alt text for screen readers.
ALTER TABLE "product_media"
    ADD CONSTRAINT "product_media_position_check" CHECK (position >= 0);

ALTER TABLE "product_media"
    ADD CONSTRAINT "product_media_alt_text_check" CHECK (btrim(alt_text) <> '');

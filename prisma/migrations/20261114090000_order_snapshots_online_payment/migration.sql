-- Waves 8–9: order-line snapshots (L22, L23, L31), order idempotency CHECKs, and the simulated online
-- payment method with its persisted attempts. Existing order lines are backfilled from their current
-- variant and product (exact only while those rows are unchanged since the order; true for seed data).
-- Before applying, the read-only checks in docs/migrations/20261114090000.md must return 0 rows.

-- PaymentMethod gains ONLINE. It is not used anywhere in this migration (a new enum value cannot be used in
-- the transaction that adds it).
ALTER TYPE "PaymentMethod" ADD VALUE 'ONLINE';

-- CreateEnum
CREATE TYPE "PaymentAttemptOutcome" AS ENUM ('SUCCEEDED', 'DECLINED');

-- L23 + L31: snapshot columns, nullable while they are backfilled.
ALTER TABLE "order_items"
    ADD COLUMN "weight_grams" INTEGER,
    ADD COLUMN "length_mm" INTEGER,
    ADD COLUMN "breadth_mm" INTEGER,
    ADD COLUMN "height_mm" INTEGER,
    ADD COLUMN "category_id" UUID,
    ADD COLUMN "category_path" TEXT,
    ADD COLUMN "category_name" TEXT,
    ADD COLUMN "product_group_id" UUID;

UPDATE "order_items" AS item
SET "weight_grams" = variant."weight_grams",
    "length_mm" = variant."length_mm",
    "breadth_mm" = variant."breadth_mm",
    "height_mm" = variant."height_mm",
    "category_id" = product."category_id",
    "category_path" = category."path",
    "category_name" = category."name",
    "product_group_id" = product."product_group_id"
FROM "product_variants" AS variant
JOIN "products" AS product ON product."id" = variant."product_id"
LEFT JOIN "categories" AS category ON category."id" = product."category_id"
WHERE variant."id" = item."variant_id";

ALTER TABLE "order_items"
    ALTER COLUMN "weight_grams" SET NOT NULL,
    ALTER COLUMN "length_mm" SET NOT NULL,
    ALTER COLUMN "breadth_mm" SET NOT NULL,
    ALTER COLUMN "height_mm" SET NOT NULL;

-- Snapshots, so no foreign keys to categories or groups: deleting an empty category or a group later must
-- not be blocked by old orders, and the old values must not change.
ALTER TABLE "order_items"
    ADD CONSTRAINT "order_items_dimensions_check"
        CHECK (weight_grams > 0 AND length_mm > 0 AND breadth_mm > 0 AND height_mm > 0),
    ADD CONSTRAINT "order_items_category_snapshot_check"
        CHECK ((category_id IS NULL) = (category_path IS NULL) AND (category_id IS NULL) = (category_name IS NULL));

-- L22: an order line's variant must belong to the line's product.
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_variant_id_fkey"
    FOREIGN KEY ("product_id", "variant_id") REFERENCES "product_variants"("product_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Checkout idempotency (plan §10A): keys from the client, fingerprints are SHA-256 hex.
ALTER TABLE "orders"
    ADD CONSTRAINT "orders_idempotency_key_check" CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,100}$'),
    ADD CONSTRAINT "orders_request_fingerprint_check" CHECK (request_fingerprint ~ '^[0-9a-f]{64}$');

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "payment_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "outcome" "PaymentAttemptOutcome" NOT NULL,
    "decline_code" TEXT,
    "provider_reference" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_payment_id_idempotency_key_key" ON "payment_attempts"("payment_id", "idempotency_key");
CREATE UNIQUE INDEX "payment_attempts_provider_reference_key" ON "payment_attempts"("provider_reference");
CREATE INDEX "payment_attempts_payment_id_created_at_idx" ON "payment_attempts"("payment_id", "created_at");
-- At most one successful attempt per payment, whatever the client sends.
CREATE UNIQUE INDEX "payment_attempts_one_success_per_payment" ON "payment_attempts"("payment_id") WHERE (outcome = 'SUCCEEDED');

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written CHECKs (Prisma cannot express them)
ALTER TABLE "payment_attempts"
    ADD CONSTRAINT "payment_attempts_idempotency_key_check" CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,100}$'),
    ADD CONSTRAINT "payment_attempts_request_fingerprint_check" CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "payment_attempts_amount_check" CHECK (amount_paise > 0),
    ADD CONSTRAINT "payment_attempts_decline_code_check"
        CHECK ((outcome = 'DECLINED') = (decline_code IS NOT NULL));

-- Indexes for the Wave 9–10 reads (plan rule 1): collected-payment report, admin customer list, webhook log.
CREATE INDEX "payments_status_collected_at_idx" ON "payments"("status", "collected_at");
CREATE INDEX "customers_created_at_id_idx" ON "customers"("created_at" DESC, "id" DESC);
CREATE INDEX "courier_webhook_receipts_received_at_id_idx" ON "courier_webhook_receipts"("received_at" DESC, "id" DESC);

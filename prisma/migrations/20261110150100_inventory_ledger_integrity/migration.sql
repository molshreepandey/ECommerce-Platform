-- Wave 5: ledger rules, ledger and low-stock indexes, and idempotent staff stock requests.
-- Additive: no existing row is changed. The two ledger indexes are replaced by wider ones (id added as a
-- tiebreaker for keyset pages); every CHECK was verified read-only against the existing rows first.

-- CreateIndex (replacements first, so the ledger is never without its index inside the transaction)
CREATE INDEX "inventory_movements_variant_id_created_at_id_idx" ON "inventory_movements"("variant_id", "created_at" DESC, "id" DESC);
CREATE INDEX "inventory_movements_warehouse_id_created_at_id_idx" ON "inventory_movements"("warehouse_id", "created_at" DESC, "id" DESC);

-- DropIndex
DROP INDEX "inventory_movements_variant_id_created_at_idx";
DROP INDEX "inventory_movements_warehouse_id_created_at_idx";

-- CreateIndex
CREATE INDEX "inventory_movements_created_at_id_idx" ON "inventory_movements"("created_at" DESC, "id" DESC);
CREATE INDEX "inventory_movements_movement_type_created_at_id_idx" ON "inventory_movements"("movement_type", "created_at" DESC, "id" DESC);
CREATE INDEX "inventory_movements_reference_type_reference_id_idx" ON "inventory_movements"("reference_type", "reference_id");
CREATE INDEX "inventory_levels_low_stock_idx" ON "inventory_levels"("warehouse_id", "variant_id") WHERE (available_quantity <= low_stock_threshold AND low_stock_threshold > 0);

-- CreateTable
CREATE TABLE "inventory_change_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "staff_user_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_change_requests_staff_user_id_idempotency_key_key" ON "inventory_change_requests"("staff_user_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "inventory_change_requests" ADD CONSTRAINT "inventory_change_requests_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written CHECKs (Prisma cannot express them)
ALTER TABLE "inventory_movements"
    ADD CONSTRAINT "inventory_movements_quantities_after_check"
        CHECK (on_hand_after >= 0 AND reserved_after >= 0 AND reserved_after <= on_hand_after),
    -- Each type moves stock one way; ADJUSTMENT may be 0 (opening stock of an empty location). A new type
    -- fails this CHECK until its direction is added here.
    ADD CONSTRAINT "inventory_movements_quantity_delta_sign_check"
        CHECK (CASE movement_type
            WHEN 'RESERVE' THEN quantity_delta > 0
            WHEN 'RELEASE' THEN quantity_delta < 0
            WHEN 'DISPATCH' THEN quantity_delta < 0
            WHEN 'RETURN_RESTOCK' THEN quantity_delta > 0
            WHEN 'RTO_RESTOCK' THEN quantity_delta > 0
            WHEN 'TRANSFER_OUT' THEN quantity_delta < 0
            WHEN 'TRANSFER_IN' THEN quantity_delta > 0
            WHEN 'RECEIPT' THEN quantity_delta > 0
            WHEN 'ADJUSTMENT' THEN true
            ELSE false
        END),
    -- At least one letter or digit in any script: whitespace of every kind (tab, newline, non-breaking and
    -- zero-width spaces) and punctuation-only text are refused.
    ADD CONSTRAINT "inventory_movements_reason_check"
        CHECK (movement_type NOT IN ('ADJUSTMENT', 'RECEIPT') OR (reason IS NOT NULL AND reason ~ '[[:alnum:]]'));

ALTER TABLE "inventory_change_requests"
    ADD CONSTRAINT "inventory_change_requests_idempotency_key_check"
        CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,100}$'),
    ADD CONSTRAINT "inventory_change_requests_request_fingerprint_check"
        CHECK (request_fingerprint ~ '^[0-9a-f]{64}$');

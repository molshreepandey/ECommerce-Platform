-- Wave 12 (D35): the daily manifest lists one warehouse's shipments shipped within one IST day
-- (WHERE warehouse_id = $1 AND shipped_at >= $2 AND shipped_at < $3 ORDER BY shipped_at, id).
-- Additive index only; no data changes.

-- CreateIndex
CREATE INDEX "shipments_warehouse_id_shipped_at_idx" ON "shipments"("warehouse_id", "shipped_at");

import { getDatabase } from '@/lib/db';
import { assertStaffPermission } from '@/modules/identity/access-control';

import type { StaffInventoryActor } from './inventory-actor';
import { recordInventoryEvents } from './inventory-audit';
import { inventoryErrors } from './inventory.errors';
import type { SetLowStockThresholdInput } from './inventory.schema';
import {
  lockProductsForShare,
  lockVariantsForShare,
  productIdsOfVariants,
} from './inventory-locks';
import {
  insertMissingStockLevels,
  lockStockLevels,
  setLowStockThresholdValue,
  type StockLevelRow,
} from './stock-level.repository';
import { assertStockLocationsExist } from './stock-locations';
import { thresholdChangeAllowed } from './stock-rules';

export interface ThresholdChangeResult {
  changed: boolean;
  stockLevel: StockLevelRow | null;
}

// Configuration, not a stock movement: only low_stock_threshold changes, never on hand or reserved, and
// no ledger row is written. Rules (TD-019): an archived product or variant may only clear its threshold to
// 0; an inactive warehouse is allowed; a missing stock row is created at 0 on hand and 0 reserved for an
// eligible positive threshold, and clearing a missing row is a no-op. Setting the current value changes
// nothing. Locks: product and variant FOR SHARE (L2, L3, so archiving cannot race the check), then the
// stock row (L5).
export async function setLowStockThreshold(
  actor: StaffInventoryActor,
  input: SetLowStockThresholdInput,
): Promise<ThresholdChangeResult> {
  assertStaffPermission(actor.staff, 'inventory.write');
  await assertStockLocationsExist(getDatabase(), {
    warehouseId: input.warehouseId,
    variantIds: [input.variantId],
  });
  return await getDatabase().$transaction(async (transaction) => {
    const productId = (await productIdsOfVariants(transaction, [input.variantId])).get(
      input.variantId,
    );
    if (productId === undefined) throw inventoryErrors.variantNotFound();
    const [product] = await lockProductsForShare(transaction, [productId]);
    const [variant] = await lockVariantsForShare(transaction, [input.variantId]);
    if (product === undefined || variant === undefined) throw inventoryErrors.variantNotFound();
    const allowed = thresholdChangeAllowed({
      productStatus: product.status,
      variantStatus: variant.status,
      newThreshold: input.lowStockThreshold,
    });
    if (!allowed) {
      throw inventoryErrors.thresholdNotAllowed({
        variantId: input.variantId,
        productStatus: product.status,
        variantStatus: variant.status,
      });
    }

    const key = { variantId: input.variantId, warehouseId: input.warehouseId };
    const [existing] = await lockStockLevels(transaction, [key]);
    if (existing === undefined && input.lowStockThreshold === 0) {
      return { changed: false, stockLevel: null };
    }
    if (existing?.lowStockThreshold === input.lowStockThreshold) {
      return { changed: false, stockLevel: existing };
    }
    if (existing === undefined) await insertMissingStockLevels(transaction, [key]);
    const updated = await setLowStockThresholdValue(transaction, key, input.lowStockThreshold);
    if (updated === null) throw new Error('A locked stock row disappeared');
    await recordInventoryEvents(transaction, actor, [
      {
        action: 'inventory.low_stock_threshold_changed',
        entityType: 'inventory_level',
        entityId: `${key.variantId}/${key.warehouseId}`,
        before: { lowStockThreshold: existing?.lowStockThreshold ?? null },
        after: {
          lowStockThreshold: updated.lowStockThreshold,
          onHandQuantity: updated.onHandQuantity,
          reservedQuantity: updated.reservedQuantity,
          variantId: key.variantId,
          warehouseId: key.warehouseId,
        },
      },
    ]);
    return { changed: true, stockLevel: updated };
  });
}

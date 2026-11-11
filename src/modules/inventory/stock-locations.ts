import type { DatabaseClient } from '@/lib/db';

import { inventoryErrors } from './inventory.errors';
import { existingStockLocations } from './stock-level.repository';

// 404 for an unknown warehouse or variant, before any transaction or lock.
export async function assertStockLocationsExist(
  database: DatabaseClient,
  input: { warehouseId: string; variantIds: readonly string[] },
): Promise<void> {
  const found = await existingStockLocations(database, input);
  if (!found.warehouseExists) throw inventoryErrors.warehouseNotFound();
  if (
    input.variantIds.some((variantId) => !found.existingVariantIds.has(variantId.toLowerCase()))
  ) {
    throw inventoryErrors.variantNotFound();
  }
}

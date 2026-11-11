import type {
  InventoryMovementType,
  ProductStatus,
  ProductVariantStatus,
} from '@/generated/prisma/enums';

import { inventoryErrors } from './inventory.errors';
import { maximumOnHandQuantity } from './inventory.schema';

// The ledger convention (TD-018, verified to replay every existing row): RESERVE and RELEASE change the
// reserved quantity, DISPATCH lowers on hand and reserved together, every other type changes on hand.
export function changesReservedQuantity(movementType: InventoryMovementType): boolean {
  return movementType === 'RESERVE' || movementType === 'RELEASE' || movementType === 'DISPATCH';
}

export function changesOnHandQuantity(movementType: InventoryMovementType): boolean {
  switch (movementType) {
    case 'RESERVE':
    case 'RELEASE':
      return false;
    case 'DISPATCH':
    case 'RETURN_RESTOCK':
    case 'RTO_RESTOCK':
    case 'ADJUSTMENT':
    case 'TRANSFER_OUT':
    case 'TRANSFER_IN':
    case 'RECEIPT':
      return true;
    default: {
      const unknownType: never = movementType;
      throw new Error(`Unknown movement type: ${String(unknownType)}`);
    }
  }
}

export interface MovementQuantities {
  movementType: InventoryMovementType;
  quantityDelta: number;
  onHandAfter: number;
  reservedAfter: number;
}

export interface QuantitiesBefore {
  onHandBefore: number;
  reservedBefore: number;
}

export function quantitiesBefore(movement: MovementQuantities): QuantitiesBefore {
  return {
    onHandBefore: changesOnHandQuantity(movement.movementType)
      ? movement.onHandAfter - movement.quantityDelta
      : movement.onHandAfter,
    reservedBefore: changesReservedQuantity(movement.movementType)
      ? movement.reservedAfter - movement.quantityDelta
      : movement.reservedAfter,
  };
}

export type AdjustmentPlan =
  | { operation: 'ADD'; quantity: number }
  | { operation: 'REMOVE'; quantity: number }
  | { operation: 'SET'; expectedOnHandQuantity: number; newOnHandQuantity: number };

// The on-hand change an adjustment asks for. A change of zero is refused before any transaction starts.
export function adjustmentDelta(plan: AdjustmentPlan): number {
  const delta = ((): number => {
    switch (plan.operation) {
      case 'ADD':
        return plan.quantity;
      case 'REMOVE':
        return -plan.quantity;
      case 'SET':
        return plan.newOnHandQuantity - plan.expectedOnHandQuantity;
      default: {
        const unknownPlan: never = plan;
        throw new Error(`Unknown adjustment: ${JSON.stringify(unknownPlan)}`);
      }
    }
  })();
  if (delta === 0) throw inventoryErrors.noStockChange();
  return delta;
}

export interface LowStockInput {
  availableQuantity: number;
  lowStockThreshold: number;
}

// The same rule as the partial index inventory_levels_low_stock_idx.
export function isLowStock(level: LowStockInput): boolean {
  return level.lowStockThreshold > 0 && level.availableQuantity <= level.lowStockThreshold;
}

// An archived product or variant can only have its threshold cleared; warehouse status does not matter.
export function thresholdChangeAllowed(input: {
  productStatus: ProductStatus;
  variantStatus: ProductVariantStatus;
  newThreshold: number;
}): boolean {
  const isArchived = input.productStatus === 'ARCHIVED' || input.variantStatus === 'ARCHIVED';
  return !isArchived || input.newThreshold === 0;
}

// A new reservation needs an active product, an active variant and an active warehouse.
export function isReservable(input: {
  productStatus: ProductStatus;
  variantStatus: ProductVariantStatus;
}): boolean {
  return input.productStatus === 'ACTIVE' && input.variantStatus === 'ACTIVE';
}

// Which stock rows the low-stock list and the low-stock flag consider: never archived products or
// variants (they are not replenished); inactive warehouses only when explicitly asked for.
export function lowStockEligible(input: {
  productStatus: ProductStatus;
  variantStatus: ProductVariantStatus;
  warehouseActive: boolean;
  includeInactiveWarehouses: boolean;
}): boolean {
  if (input.productStatus === 'ARCHIVED' || input.variantStatus === 'ARCHIVED') return false;
  return input.warehouseActive || input.includeInactiveWarehouses;
}

// Add and receipt stop at the same ceiling that set accepts, so every on-hand quantity can later be
// restated with set, and the integer column can never overflow. Checked on the locked stock row. Only
// increases are checked: a removal is always allowed.
export function assertWithinOnHandLimit(
  level: { variantId: string; warehouseId: string; onHandQuantity: number },
  quantityDelta: number,
): void {
  const requestedOnHandQuantity = level.onHandQuantity + quantityDelta;
  if (quantityDelta > 0 && requestedOnHandQuantity > maximumOnHandQuantity) {
    throw inventoryErrors.onHandLimitExceeded({
      variantId: level.variantId,
      warehouseId: level.warehouseId,
      onHandQuantity: level.onHandQuantity,
      requestedOnHandQuantity,
      maximumOnHandQuantity,
    });
  }
}

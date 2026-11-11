import type { InventoryMovementType } from '@/generated/prisma/enums';

import type { StockRequestOperation } from './request-fingerprint';
import { quantitiesBefore } from './stock-rules';

export interface RecordedMovement {
  id: string;
  variantId: string;
  warehouseId: string;
  movementType: InventoryMovementType;
  quantityDelta: number;
  onHandAfter: number;
  reservedAfter: number;
  reason: string | null;
  createdAt: Date;
}

export interface MovementResult {
  movementId: string;
  variantId: string;
  warehouseId: string;
  movementType: InventoryMovementType;
  quantityDelta: number;
  onHandBefore: number;
  onHandAfter: number;
  reservedBefore: number;
  reservedAfter: number;
  availableAfter: number;
  reason: string | null;
  recordedAt: Date;
}

export interface StockRequestResult {
  changeRequestId: string;
  operation: StockRequestOperation;
  replayed: boolean;
  movements: MovementResult[];
}

// Movements in (variant, warehouse, id) order with their before-values worked out from the stored
// after-values, so a result never depends on stock changes made after the movement.
export function movementResults(movements: readonly RecordedMovement[]): MovementResult[] {
  return [...movements]
    .sort(
      (left, right) =>
        left.variantId.localeCompare(right.variantId) ||
        left.warehouseId.localeCompare(right.warehouseId) ||
        left.id.localeCompare(right.id),
    )
    .map((movement) => {
      const before = quantitiesBefore(movement);
      return {
        movementId: movement.id,
        variantId: movement.variantId,
        warehouseId: movement.warehouseId,
        movementType: movement.movementType,
        quantityDelta: movement.quantityDelta,
        onHandBefore: before.onHandBefore,
        onHandAfter: movement.onHandAfter,
        reservedBefore: before.reservedBefore,
        reservedAfter: movement.reservedAfter,
        availableAfter: movement.onHandAfter - movement.reservedAfter,
        reason: movement.reason,
        recordedAt: movement.createdAt,
      };
    });
}

// The result is built only from the request's own movement rows (their stored after-values), both when
// the request is applied and when it is replayed, so a replay returns exactly the original result and
// never reflects stock changes made since.
export function stockRequestResult(input: {
  changeRequestId: string;
  operation: StockRequestOperation;
  replayed: boolean;
  movements: readonly RecordedMovement[];
}): StockRequestResult {
  const movements = movementResults(input.movements);
  return {
    changeRequestId: input.changeRequestId,
    operation: input.operation,
    replayed: input.replayed,
    movements,
  };
}

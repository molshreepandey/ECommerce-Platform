export interface AllocatableStock {
  variantId: string;
  warehouseId: string;
  warehousePriority: number;
  warehousePincode: string;
  availableQuantity: number;
}

export interface AllocationRequestLine {
  variantId: string;
  quantity: number;
}

export interface AllocatedLine {
  variantId: string;
  warehouseId: string;
  quantity: number;
}

export type AllocationResult =
  | { isAllocated: true; lines: AllocatedLine[]; warehouseIds: string[] }
  | {
      isAllocated: false;
      shortLines: { variantId: string; requestedQuantity: number; availableQuantity: number }[];
    };

export type WarehouseOrder = (left: AllocatableStock, right: AllocatableStock) => number;

export function byPriority(left: AllocatableStock, right: AllocatableStock): number {
  return (
    left.warehousePriority - right.warehousePriority ||
    left.warehouseId.localeCompare(right.warehouseId)
  );
}

// Indian PIN codes are hierarchical: digit 1 is the zone, digits 1–2 the postal circle, digits 1–3 the
// sorting district, then the delivery office. The longer the shared prefix, the nearer the warehouse.
export function sharedPincodePrefixLength(left: string, right: string): number {
  let length = 0;
  while (length < 6 && left[length] !== undefined && left[length] === right[length]) length += 1;
  return length;
}

// Wave 16 (pincode-distance allocation, plan §6): nearest warehouse first by PIN hierarchy, then the
// usual priority. An approximation of distance (no coordinates dataset is used).
export function byPincodeProximity(deliveryPincode: string): WarehouseOrder {
  return (left, right) =>
    sharedPincodePrefixLength(right.warehousePincode, deliveryPincode) -
      sharedPincodePrefixLength(left.warehousePincode, deliveryPincode) || byPriority(left, right);
}

export type AllocationStrategy = 'PRIORITY' | 'NEAREST_PINCODE';

export function warehouseOrderFor(
  strategy: AllocationStrategy,
  deliveryPincode: string,
): WarehouseOrder {
  switch (strategy) {
    case 'PRIORITY':
      return byPriority;
    case 'NEAREST_PINCODE':
      return byPincodeProximity(deliveryPincode);
  }
}

// Plan §6: (1) one active warehouse that can fulfil the whole order, first in the warehouse order → one
// shipment; (2) otherwise each line goes to the first warehouse that has all of it; (3) a line splits
// across warehouses only when no single warehouse has enough. The order is priority by default, or
// nearest-pincode (Wave 16). Pure: the reservation's guarded update is what really decides, so a stale
// read only turns into a 409.
export function allocateOrder(
  requestLines: readonly AllocationRequestLine[],
  stock: readonly AllocatableStock[],
  warehouseOrder: WarehouseOrder = byPriority,
): AllocationResult {
  const sorted = [...stock].sort(warehouseOrder);
  const availableAt = new Map(
    sorted.map((row) => [`${row.variantId}/${row.warehouseId}`, row.availableQuantity]),
  );
  const warehouses = [...new Map(sorted.map((row) => [row.warehouseId, row])).values()];

  const shortLines = requestLines.flatMap((line) => {
    const total = sorted
      .filter((row) => row.variantId === line.variantId)
      .reduce((sum, row) => sum + row.availableQuantity, 0);
    return total < line.quantity
      ? [{ variantId: line.variantId, requestedQuantity: line.quantity, availableQuantity: total }]
      : [];
  });
  if (shortLines.length > 0) return { isAllocated: false, shortLines };

  const single = warehouses.find((warehouse) =>
    requestLines.every(
      (line) =>
        (availableAt.get(`${line.variantId}/${warehouse.warehouseId}`) ?? 0) >= line.quantity,
    ),
  );
  if (single !== undefined) {
    return {
      isAllocated: true,
      lines: requestLines.map((line) => ({ ...line, warehouseId: single.warehouseId })),
      warehouseIds: [single.warehouseId],
    };
  }

  const lines: AllocatedLine[] = [];
  for (const line of requestLines) {
    const candidates = sorted.filter((row) => row.variantId === line.variantId);
    const whole = candidates.find((row) => row.availableQuantity >= line.quantity);
    if (whole !== undefined) {
      lines.push({
        variantId: line.variantId,
        warehouseId: whole.warehouseId,
        quantity: line.quantity,
      });
      continue;
    }
    let remaining = line.quantity;
    for (const row of candidates) {
      if (remaining === 0) break;
      const taken = Math.min(remaining, row.availableQuantity);
      if (taken === 0) continue;
      lines.push({ variantId: line.variantId, warehouseId: row.warehouseId, quantity: taken });
      remaining -= taken;
    }
  }
  const priorityOf = new Map(warehouses.map((warehouse) => [warehouse.warehouseId, warehouse]));
  const warehouseIds = [...new Set(lines.map(({ warehouseId }) => warehouseId))].sort(
    (left, right) => {
      const leftRow = priorityOf.get(left);
      const rightRow = priorityOf.get(right);
      return leftRow === undefined || rightRow === undefined
        ? 0
        : warehouseOrder(leftRow, rightRow);
    },
  );
  return { isAllocated: true, lines, warehouseIds };
}

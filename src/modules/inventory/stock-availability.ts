import type { Prisma } from '@/generated/prisma/client';

// The single definition of countable stock, shared by availability totals and the catalogue stock
// filter: stock rows in active warehouses (D30). available_quantity is the generated column
// on_hand_quantity − reserved_quantity, never computed again in application code.
export const countedStockWhere = {
  warehouse: { isActive: true },
} as const satisfies Prisma.InventoryLevelWhereInput;

// A stock row that can be sold now: counted, with something available.
export const sellableStockWhere = {
  ...countedStockWhere,
  availableQuantity: { gt: 0 },
} as const satisfies Prisma.InventoryLevelWhereInput;

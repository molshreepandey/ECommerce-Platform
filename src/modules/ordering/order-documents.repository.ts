import type { DatabaseClient } from '@/lib/db';

export function findManifestWarehouse(database: DatabaseClient, warehouseId: string) {
  return database.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, name: true, code: true },
  });
}

export function listWarehouseOptions(database: DatabaseClient) {
  return database.warehouse.findMany({
    select: { id: true, name: true, code: true },
    orderBy: [{ priority: 'asc' }, { code: 'asc' }],
  });
}

// The live shipments of these orders with the value of their goods, for the per-package COD amount.
export function listCodShipmentGoods(database: DatabaseClient, orderIds: readonly string[]) {
  return database.shipment.findMany({
    where: { orderId: { in: [...orderIds] }, status: { not: 'CANCELLED' } },
    select: {
      id: true,
      orderId: true,
      items: {
        select: {
          quantity: true,
          orderItem: { select: { quantity: true, lineTotalPaise: true } },
        },
      },
    },
  });
}

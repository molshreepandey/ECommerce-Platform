import type { SeededVariant } from './catalogue.seed';
import type { InventoryEvent } from './orders.seed';
import type { SeedClient } from './seed-client';
import { daysFromSeedDay } from './seed-clock';
import { deterministicUuidV7, requireValue } from './seed-ids';
import type { WarehouseCode } from './warehouses.seed';

const lowStockThreshold = 5;
const reservationSafetyMargin = 5;

const seededWarehouseCodes: readonly WarehouseCode[] = ['WH-BLR', 'WH-DEL', 'WH-MUM'];

interface StockLevel {
  onHandQuantity: number;
  reservedQuantity: number;
}

interface StockPosition {
  sku: string;
  warehouseCode: WarehouseCode;
}

function stockLevelKey(sku: string, warehouseCode: WarehouseCode): string {
  return `${sku}@${warehouseCode}`;
}

function openingStockPattern(variantIndex: number): Partial<Record<WarehouseCode, number>> {
  switch (variantIndex % 9) {
    case 0:
      return { 'WH-BLR': 15 };
    case 1:
      return { 'WH-DEL': 9 };
    case 2:
      return { 'WH-BLR': 2, 'WH-DEL': 1 };
    case 3:
      return { 'WH-BLR': 0 };
    case 4:
      return { 'WH-MUM': 6 };
    default:
      return {
        'WH-BLR': 20 + (variantIndex % 5) * 4,
        'WH-DEL': 10 + (variantIndex % 4) * 3,
        ...(variantIndex % 2 === 0 ? { 'WH-MUM': 8 } : {}),
      };
  }
}

function openingStockBySkuAndWarehouse(
  variants: SeededVariant[],
  orderEvents: InventoryEvent[],
): Map<string, StockPosition & { quantity: number }> {
  const openingStock = new Map<string, StockPosition & { quantity: number }>();
  for (const [variantIndex, variant] of variants.entries()) {
    const pattern = openingStockPattern(variantIndex);
    for (const warehouseCode of seededWarehouseCodes) {
      const quantity = pattern[warehouseCode];
      if (quantity !== undefined) {
        openingStock.set(stockLevelKey(variant.sku, warehouseCode), {
          sku: variant.sku,
          warehouseCode,
          quantity,
        });
      }
    }
  }

  for (const event of orderEvents.filter((orderEvent) => orderEvent.movementType === 'RESERVE')) {
    const key = stockLevelKey(event.sku, event.warehouseCode);
    const currentQuantity = openingStock.get(key)?.quantity ?? 0;
    const reservedByOrders = orderEvents
      .filter(
        (orderEvent) =>
          orderEvent.movementType === 'RESERVE' &&
          stockLevelKey(orderEvent.sku, orderEvent.warehouseCode) === key,
      )
      .reduce((sum, orderEvent) => sum + orderEvent.reservedDelta, 0);
    openingStock.set(key, {
      sku: event.sku,
      warehouseCode: event.warehouseCode,
      quantity: Math.max(currentQuantity, reservedByOrders + reservationSafetyMargin),
    });
  }
  return openingStock;
}

function applyEvent(stockLevel: StockLevel, event: InventoryEvent): StockLevel {
  const nextLevel = {
    onHandQuantity: stockLevel.onHandQuantity + event.onHandDelta,
    reservedQuantity: stockLevel.reservedQuantity + event.reservedDelta,
  };
  if (
    nextLevel.onHandQuantity < 0 ||
    nextLevel.reservedQuantity < 0 ||
    nextLevel.reservedQuantity > nextLevel.onHandQuantity
  ) {
    throw new Error(`Seed inventory became invalid for ${event.sku} at ${event.warehouseCode}`);
  }
  return nextLevel;
}

function movementQuantityDelta(event: InventoryEvent): number {
  return event.movementType === 'RESERVE' || event.movementType === 'RELEASE'
    ? event.reservedDelta
    : event.onHandDelta;
}

export async function seedInventory(
  client: SeedClient,
  input: {
    variants: SeededVariant[];
    warehouseIdByCode: Map<WarehouseCode, string>;
    orderEvents: InventoryEvent[];
  },
): Promise<void> {
  const variantIdBySku = new Map(input.variants.map((variant) => [variant.sku, variant.id]));
  const openingStockTakenAt = daysFromSeedDay(-40);
  const openingEvents: InventoryEvent[] = [
    ...openingStockBySkuAndWarehouse(input.variants, input.orderEvents).values(),
  ].map((openingStock) => ({
    occurredAt: openingStockTakenAt,
    sku: openingStock.sku,
    warehouseCode: openingStock.warehouseCode,
    movementType: 'ADJUSTMENT',
    onHandDelta: openingStock.quantity,
    reservedDelta: 0,
    referenceType: 'opening_stock',
    referenceId: deterministicUuidV7(
      `opening-stock:${openingStock.sku}:${openingStock.warehouseCode}`,
      openingStockTakenAt,
    ),
    actorType: 'SYSTEM',
  }));

  const orderedEvents = [...openingEvents, ...input.orderEvents].sort(
    (first, second) => first.occurredAt.getTime() - second.occurredAt.getTime(),
  );
  const stockLevelByKey = new Map<string, StockPosition & StockLevel>();
  const movementRows = orderedEvents.map((event, eventIndex) => {
    const key = stockLevelKey(event.sku, event.warehouseCode);
    const nextLevel = applyEvent(
      stockLevelByKey.get(key) ?? { onHandQuantity: 0, reservedQuantity: 0 },
      event,
    );
    stockLevelByKey.set(key, { sku: event.sku, warehouseCode: event.warehouseCode, ...nextLevel });
    return {
      id: deterministicUuidV7(
        `inventory-movement:${String(eventIndex)}:${event.movementType}:${key}:${event.referenceId}`,
        event.occurredAt,
      ),
      variantId: requireValue(variantIdBySku.get(event.sku), `variant ${event.sku}`),
      warehouseId: requireValue(
        input.warehouseIdByCode.get(event.warehouseCode),
        `warehouse ${event.warehouseCode}`,
      ),
      movementType: event.movementType,
      quantityDelta: movementQuantityDelta(event),
      onHandAfter: nextLevel.onHandQuantity,
      reservedAfter: nextLevel.reservedQuantity,
      referenceType: event.referenceType,
      referenceId: event.referenceId,
      actorType: event.actorType,
      reason: event.referenceType === 'opening_stock' ? 'Opening stock' : null,
      createdAt: event.occurredAt,
    };
  });

  for (const { sku, warehouseCode, ...stockLevel } of stockLevelByKey.values()) {
    const variantId = requireValue(variantIdBySku.get(sku), `variant ${sku}`);
    const warehouseId = requireValue(
      input.warehouseIdByCode.get(warehouseCode),
      `warehouse ${warehouseCode}`,
    );
    await client.inventoryLevel.upsert({
      where: { variantId_warehouseId: { variantId, warehouseId } },
      create: {
        variantId,
        warehouseId,
        ...stockLevel,
        lowStockThreshold,
        createdAt: openingStockTakenAt,
      },
      update: { ...stockLevel, lowStockThreshold },
    });
  }
  await client.inventoryMovement.createMany({ data: movementRows, skipDuplicates: true });
}

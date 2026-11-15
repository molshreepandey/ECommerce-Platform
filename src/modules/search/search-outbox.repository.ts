import type { DatabaseClient } from '@/lib/db';

import { scheduleSearchOutboxDrain } from './search-outbox-schedule';

// Written in the same transaction as the catalogue change. Each function also schedules a drain after the
// response (search-outbox-schedule.ts), which processes the rows once the transaction has committed.
export async function enqueueProductReindex(
  database: DatabaseClient,
  productId: string,
): Promise<void> {
  await database.searchOutbox.create({
    data: { entityType: 'product', entityId: productId },
    select: { id: true },
  });
  scheduleSearchOutboxDrain();
}

export async function enqueueProductsOfBrand(
  database: DatabaseClient,
  brandId: string,
): Promise<number> {
  scheduleSearchOutboxDrain();
  return database.$executeRaw`
    INSERT INTO search_outbox (entity_type, entity_id)
    SELECT 'product', id FROM products WHERE brand_id = ${brandId}::uuid`;
}

export async function enqueueProductsOfType(
  database: DatabaseClient,
  productTypeId: string,
): Promise<number> {
  scheduleSearchOutboxDrain();
  return database.$executeRaw`
    INSERT INTO search_outbox (entity_type, entity_id)
    SELECT 'product', id FROM products WHERE product_type_id = ${productTypeId}::uuid`;
}

export async function enqueueProductsReindex(
  database: DatabaseClient,
  productIds: readonly string[],
): Promise<void> {
  if (productIds.length === 0) return;
  await database.searchOutbox.createMany({
    data: productIds.map((entityId) => ({ entityType: 'product', entityId })),
  });
  scheduleSearchOutboxDrain();
}

// A category's name or path is in its products' search documents, so the whole subtree is reindexed.
export async function enqueueProductsInCategorySubtree(
  database: DatabaseClient,
  categoryPath: string,
): Promise<number> {
  scheduleSearchOutboxDrain();
  return database.$executeRaw`
    INSERT INTO search_outbox (entity_type, entity_id)
    SELECT 'product', p.id FROM products p JOIN categories c ON c.id = p.category_id
    WHERE c.path LIKE ${categoryPath} || '%'`;
}

// A warehouse's status decides whether its stock counts as available, so every product stocked there is
// reindexed. Reads stock rows without locking them (a warehouse change never waits on stock rows).
export async function enqueueProductsStockedInWarehouse(
  database: DatabaseClient,
  warehouseId: string,
): Promise<number> {
  scheduleSearchOutboxDrain();
  return database.$executeRaw`
    INSERT INTO search_outbox (entity_type, entity_id)
    SELECT DISTINCT 'product', variant.product_id
    FROM inventory_levels AS level JOIN product_variants AS variant ON variant.id = level.variant_id
    WHERE level.warehouse_id = ${warehouseId}::uuid`;
}

// Stock changes alter availability, which is part of each product's search document.
export async function enqueueProductsOfVariants(
  database: DatabaseClient,
  variantIds: readonly string[],
): Promise<number> {
  if (variantIds.length === 0) return 0;
  scheduleSearchOutboxDrain();
  return database.$executeRaw`
    INSERT INTO search_outbox (entity_type, entity_id)
    SELECT DISTINCT 'product', product_id FROM product_variants WHERE id = ANY(${[...variantIds]}::uuid[])`;
}

export interface OutboxRow {
  id: string;
  entityId: string;
}

// Oldest first, by the partial index on unprocessed rows. Read without locking: processing is idempotent
// (documents carry external versions), so two drains reading the same rows only repeat work.
export function listUnprocessedProductRows(
  database: DatabaseClient,
  limit: number,
): Promise<OutboxRow[]> {
  return database.searchOutbox.findMany({
    where: { processedAt: null, entityType: 'product' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { id: true, entityId: true },
  });
}

export async function markOutboxRowsProcessed(
  database: DatabaseClient,
  rowIds: readonly string[],
): Promise<number> {
  if (rowIds.length === 0) return 0;
  const { count } = await database.searchOutbox.updateMany({
    where: { id: { in: [...rowIds] }, processedAt: null },
    data: { processedAt: new Date() },
  });
  return count;
}

export async function productIdsQueuedSince(
  database: DatabaseClient,
  since: Date,
): Promise<string[]> {
  const rows = await database.searchOutbox.findMany({
    where: { entityType: 'product', createdAt: { gte: since } },
    distinct: ['entityId'],
    select: { entityId: true },
  });
  return rows.map(({ entityId }) => entityId);
}

// D48: how many queued changes wait, and since when (the partial index on unprocessed rows).
export async function outboxBacklog(
  database: DatabaseClient,
): Promise<{ pendingCount: number; oldestPendingAt: Date | null }> {
  const [pendingCount, oldest] = await Promise.all([
    database.searchOutbox.count({ where: { processedAt: null } }),
    database.searchOutbox.findFirst({
      where: { processedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { createdAt: true },
    }),
  ]);
  return { pendingCount, oldestPendingAt: oldest?.createdAt ?? null };
}

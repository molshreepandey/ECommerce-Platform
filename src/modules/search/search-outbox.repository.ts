import type { DatabaseClient } from '@/lib/db';

// Written in the same transaction as the catalogue change; Wave 6 processes the rows after commit.
export async function enqueueProductReindex(
  database: DatabaseClient,
  productId: string,
): Promise<void> {
  await database.searchOutbox.create({
    data: { entityType: 'product', entityId: productId },
    select: { id: true },
  });
}

export async function enqueueProductsOfBrand(
  database: DatabaseClient,
  brandId: string,
): Promise<number> {
  return database.$executeRaw`
    INSERT INTO search_outbox (entity_type, entity_id)
    SELECT 'product', id FROM products WHERE brand_id = ${brandId}::uuid`;
}

export async function enqueueProductsOfType(
  database: DatabaseClient,
  productTypeId: string,
): Promise<number> {
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
}

// A category's name or path is in its products' search documents, so the whole subtree is reindexed.
export async function enqueueProductsInCategorySubtree(
  database: DatabaseClient,
  categoryPath: string,
): Promise<number> {
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
  return database.$executeRaw`
    INSERT INTO search_outbox (entity_type, entity_id)
    SELECT DISTINCT 'product', product_id FROM product_variants WHERE id = ANY(${[...variantIds]}::uuid[])`;
}

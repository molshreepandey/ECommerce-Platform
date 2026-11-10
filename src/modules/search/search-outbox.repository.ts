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

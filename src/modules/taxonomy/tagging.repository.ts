import type { DatabaseClient } from '@/lib/db';

// tagging_status follows category_id (a CHECK enforces it); the product version moves too, so an open
// editor notices the change.
export async function setProductsCategory(
  database: DatabaseClient,
  input: { productIds: readonly string[]; categoryId: string | null },
): Promise<void> {
  if (input.productIds.length === 0) return;
  const ids = [...input.productIds];
  const taggingStatus = input.categoryId === null ? 'UNTAGGED' : 'TAGGED';
  await database.$executeRaw`
    UPDATE products SET
      category_id = ${input.categoryId}::uuid,
      tagging_status = ${taggingStatus}::"TaggingStatus",
      version = version + 1,
      updated_at = now()
    WHERE id = ANY(${ids}::uuid[])`;
}

// D21: the products a re-categorise moves (archived ones stay, as tagging refuses them).
export async function findMovableProductIds(
  database: DatabaseClient,
  categoryId: string,
  limit: number,
): Promise<string[]> {
  const rows = await database.product.findMany({
    where: { categoryId, status: { not: 'ARCHIVED' } },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: limit,
  });
  return rows.map(({ id }) => id);
}

export function countArchivedOnCategory(database: DatabaseClient, categoryId: string) {
  return database.product.count({ where: { categoryId, status: 'ARCHIVED' } });
}

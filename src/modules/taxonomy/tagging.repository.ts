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

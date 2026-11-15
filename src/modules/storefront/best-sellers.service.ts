import { z } from 'zod';

import { getDatabase } from '@/lib/db';
import type { ProductSearchHit } from '@/modules/search/product-search.schema';
import { findProductCardsByIds } from '@/modules/search/postgres-product-search.repository';

const rowsSchema = z.array(z.object({ product_id: z.string() }));

// Home page "Best sellers": the products with the most units in orders that were not cancelled or
// returned to origin. Real order data only: with no orders there are no best sellers (the section hides).
export async function findBestSellingProducts(limit: number): Promise<ProductSearchHit[]> {
  const database = getDatabase();
  const rows = rowsSchema.parse(
    await database.$queryRaw`
      SELECT item.product_id::text AS product_id
      FROM order_items AS item
      JOIN orders AS placed ON placed.id = item.order_id
      WHERE placed.status NOT IN ('CANCELLED', 'RTO')
      GROUP BY item.product_id
      ORDER BY sum(item.quantity) DESC, item.product_id
      LIMIT ${limit}`,
  );
  return findProductCardsByIds(
    database,
    rows.map((row) => row.product_id),
  );
}

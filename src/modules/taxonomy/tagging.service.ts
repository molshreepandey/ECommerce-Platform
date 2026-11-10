import { getDatabase } from '@/lib/db';
import type { DatabaseClient } from '@/lib/db';
import { type CatalogueActor, recordCatalogueEvents } from '@/modules/catalogue/catalogue-audit';
import { lockProductsInIdOrder } from '@/modules/catalogue/product.repository';
import { assertStaffPermission } from '@/modules/identity/access-control';
import { enqueueProductsReindex } from '@/modules/search/search-outbox.repository';

import { type CategoryRow, countChildren, lockCategoryForShare } from './category.repository';
import { setProductsCategory } from './tagging.repository';
import { taxonomyErrors } from './taxonomy.errors';
import type { TagProductsInput } from './taxonomy.schema';

export interface TaggingResult {
  changedProductIds: string[];
  unchangedProductIds: string[];
}

// The category is share-locked, so it cannot gain children, be deactivated or be deleted until this
// change commits; a child creation takes the parent FOR UPDATE and waits.
async function lockTargetLeaf(
  transaction: DatabaseClient,
  categoryId: string,
): Promise<CategoryRow> {
  const category = await lockCategoryForShare(transaction, categoryId);
  if (category === null) throw taxonomyErrors.categoryNotFound();
  if ((await countChildren(transaction, categoryId)) > 0) throw taxonomyErrors.notLeaf();
  if (!category.isActive) throw taxonomyErrors.inactive();
  return category;
}

// Tag (categoryId set) or untag (null) up to 100 products, all or nothing (D20).
export async function tagProducts(
  actor: CatalogueActor,
  input: TagProductsInput,
): Promise<TaggingResult> {
  assertStaffPermission(actor.staff, 'taxonomy.write');
  return await getDatabase().$transaction(async (transaction) => {
    if (input.categoryId !== null) await lockTargetLeaf(transaction, input.categoryId);
    const products = await lockProductsInIdOrder(transaction, input.productIds);
    const foundIds = new Set(products.map(({ id }) => id));
    const missing = input.productIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) throw taxonomyErrors.productsNotFound(missing);
    const archived = products.filter(({ status }) => status === 'ARCHIVED').map(({ id }) => id);
    if (archived.length > 0) throw taxonomyErrors.productsArchived(archived);

    const changing = products.filter(({ categoryId }) => categoryId !== input.categoryId);
    const changedIds = changing.map(({ id }) => id);
    await setProductsCategory(transaction, {
      productIds: changedIds,
      categoryId: input.categoryId,
    });
    await recordCatalogueEvents(
      transaction,
      actor,
      changing.map((product) => ({
        action: 'taxonomy.product_tagged' as const,
        entityType: 'product' as const,
        entityId: product.id,
        before: { categoryId: product.categoryId },
        after: { categoryId: input.categoryId },
      })),
    );
    await enqueueProductsReindex(transaction, changedIds);
    return {
      changedProductIds: changedIds,
      unchangedProductIds: products
        .filter(({ id }) => !changedIds.includes(id))
        .map(({ id }) => id),
    };
  });
}

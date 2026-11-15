import { getDatabase } from '@/lib/db';
import type { DatabaseClient } from '@/lib/db';
import { type CatalogueActor, recordCatalogueEvents } from '@/modules/catalogue/catalogue-audit';
import { lockProductsInIdOrder } from '@/modules/catalogue/product.repository';
import { assertStaffPermission } from '@/modules/identity/access-control';
import { enqueueProductsReindex } from '@/modules/search/search-outbox.repository';

import { type CategoryRow, countChildren, lockCategoryForShare } from './category.repository';
import {
  countArchivedOnCategory,
  findMovableProductIds,
  setProductsCategory,
} from './tagging.repository';
import { taxonomyErrors } from './taxonomy.errors';
import {
  maximumProductsPerRecategorise,
  type RecategoriseProductsInput,
  type TagProductsInput,
} from './taxonomy.schema';

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

export interface RecategoriseResult {
  movedProductIds: string[];
  archivedProductCount: number;
}

// D21: move every non-archived product on category A to the active leaf category B, all or nothing.
// Both categories are share-locked in id order (so neither can be deleted or restructured meanwhile),
// then the products in id order, the same lock order as tagging. Archived products stay on A (tagging
// refuses them) and are counted in the result.
export async function recategoriseProducts(
  actor: CatalogueActor,
  input: RecategoriseProductsInput,
): Promise<RecategoriseResult> {
  assertStaffPermission(actor.staff, 'taxonomy.write');
  return await getDatabase().$transaction(async (transaction) => {
    for (const categoryId of [input.fromCategoryId, input.toCategoryId].sort()) {
      if (categoryId === input.toCategoryId) await lockTargetLeaf(transaction, categoryId);
      else if ((await lockCategoryForShare(transaction, categoryId)) === null)
        throw taxonomyErrors.categoryNotFound();
    }
    const productIds = await findMovableProductIds(
      transaction,
      input.fromCategoryId,
      maximumProductsPerRecategorise + 1,
    );
    if (productIds.length > maximumProductsPerRecategorise) {
      throw taxonomyErrors.tooManyToRecategorise(productIds.length, maximumProductsPerRecategorise);
    }
    // A product re-tagged or archived between the read and its lock is left alone.
    const moving = (await lockProductsInIdOrder(transaction, productIds)).filter(
      (product) => product.categoryId === input.fromCategoryId && product.status !== 'ARCHIVED',
    );
    const movedIds = moving.map(({ id }) => id);
    await setProductsCategory(transaction, {
      productIds: movedIds,
      categoryId: input.toCategoryId,
    });
    await recordCatalogueEvents(transaction, actor, [
      ...moving.map((product) => ({
        action: 'taxonomy.product_tagged' as const,
        entityType: 'product' as const,
        entityId: product.id,
        before: { categoryId: input.fromCategoryId },
        after: { categoryId: input.toCategoryId },
      })),
      {
        action: 'taxonomy.products_recategorised' as const,
        entityType: 'category' as const,
        entityId: input.fromCategoryId,
        before: { categoryId: input.fromCategoryId },
        after: { categoryId: input.toCategoryId, productCount: movedIds.length },
      },
    ]);
    await enqueueProductsReindex(transaction, movedIds);
    return {
      movedProductIds: movedIds,
      archivedProductCount: await countArchivedOnCategory(transaction, input.fromCategoryId),
    };
  });
}

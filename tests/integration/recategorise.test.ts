import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { createCategory } from '@/modules/taxonomy/category.service';
import { recategoriseProducts, tagProducts } from '@/modules/taxonomy/tagging.service';
import {
  createCategorySchema,
  recategoriseProductsSchema,
  tagProductsSchema,
} from '@/modules/taxonomy/taxonomy.schema';

import {
  actorFor,
  catalogueWriterWithoutTaxonomy,
  createApparelType,
  createTestBrand,
  createTestProduct,
} from './support/catalogue-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error instanceof DomainError ? `${String(error.httpStatus)} ${error.code}` : String(error);
}

function category(name: string, parentId: string | null = null) {
  return createCategory(actorFor(), createCategorySchema.parse({ name, parentId }));
}

let catalogue: { productTypeId: string; brandId: string } | null = null;

async function productsOn(categoryId: string, count: number) {
  catalogue ??= {
    productTypeId: (await createApparelType()).id,
    brandId: (await createTestBrand()).id,
  };
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const product = await createTestProduct({
      ...catalogue,
      slug: `move-${categoryId.slice(-8)}-${String(index)}`,
    });
    ids.push(product.id);
  }
  await tagProducts(actorFor(), tagProductsSchema.parse({ productIds: ids, categoryId }));
  return ids;
}

function recategorise(fromCategoryId: string, toCategoryId: string, actor = actorFor()) {
  return recategoriseProducts(
    actor,
    recategoriseProductsSchema.parse({ fromCategoryId, toCategoryId }),
  );
}

beforeEach(async () => {
  await truncateAllTestTables();
  catalogue = null;
});

describe('bulk re-categorise A → B (D21)', () => {
  it('moves every non-archived product, audits each one and the batch, queues reindexing; archived stay', async () => {
    const parent = await category('Apparel');
    const from = await category('Kurtas', parent.id);
    const to = await category('Kurta sets', parent.id);
    const ids = await productsOn(from.id, 3);
    const archivedId = ids[2] ?? '';
    await database.product.update({
      where: { id: archivedId },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await database.searchOutbox.deleteMany();
    const result = await recategorise(from.id, to.id);
    expect(result.movedProductIds.sort()).toEqual(ids.slice(0, 2).sort());
    expect(result.archivedProductCount).toBe(1);
    const rows = await database.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, categoryId: true, taggingStatus: true },
    });
    expect(rows.find(({ id }) => id === archivedId)?.categoryId).toBe(from.id);
    expect(rows.filter(({ categoryId }) => categoryId === to.id)).toHaveLength(2);
    expect(
      await database.auditLog.count({
        where: {
          action: 'taxonomy.product_tagged',
          after: { path: ['categoryId'], equals: to.id },
        },
      }),
    ).toBe(2);
    expect(
      await database.auditLog.count({
        where: { action: 'taxonomy.products_recategorised', entityId: from.id },
      }),
    ).toBe(1);
    expect(await database.searchOutbox.count()).toBe(2);
  });

  it('refuses a target that is not an active leaf (422), an unknown source (404) and the same category', async () => {
    const parent = await category('Footwear');
    const from = await category('Sandals', parent.id);
    await productsOn(from.id, 1);
    expect(await failure(recategorise(from.id, parent.id))).toBe('422 CATEGORY_NOT_LEAF');
    const inactive = await category('Retired', parent.id);
    await database.category.update({ where: { id: inactive.id }, data: { isActive: false } });
    expect(await failure(recategorise(from.id, inactive.id))).toBe('422 CATEGORY_INACTIVE');
    expect(await failure(recategorise('0195f2a0-0000-7000-8000-000000000999', from.id))).toBe(
      '404 CATEGORY_NOT_FOUND',
    );
    expect(() =>
      recategoriseProductsSchema.parse({ fromCategoryId: from.id, toCategoryId: from.id }),
    ).toThrow();
    expect(await database.product.count({ where: { categoryId: from.id } })).toBe(1);
  });

  it('needs taxonomy.write (403)', async () => {
    const from = await category('Bags');
    const to = await category('Wallets');
    expect(
      await failure(recategorise(from.id, to.id, actorFor(catalogueWriterWithoutTaxonomy))),
    ).toBe('403 PERMISSION_DENIED');
  });

  it('two opposite re-categorisations at once finish without deadlock and lose no product', async () => {
    const left = await category('Left');
    const right = await category('Right');
    const ids = [...(await productsOn(left.id, 3)), ...(await productsOn(right.id, 3))];
    await Promise.all([recategorise(left.id, right.id), recategorise(right.id, left.id)]);
    const placed = await database.product.findMany({
      where: { id: { in: ids } },
      select: { categoryId: true },
    });
    expect(
      placed.every(({ categoryId }) => categoryId === left.id || categoryId === right.id),
    ).toBe(true);
  });
});

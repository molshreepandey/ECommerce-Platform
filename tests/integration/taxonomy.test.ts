import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import {
  changeCategoryStatus,
  createCategory,
  deleteCategory,
  listCategoryTree,
  moveCategory,
  updateCategory,
} from '@/modules/taxonomy/category.service';
import { tagProducts } from '@/modules/taxonomy/tagging.service';
import {
  changeCategoryStatusSchema,
  createCategorySchema,
  moveCategorySchema,
  tagProductsSchema,
  updateCategorySchema,
} from '@/modules/taxonomy/taxonomy.schema';

import {
  actorFor,
  catalogueWriterWithoutTaxonomy,
  createApparelType,
  createTestBrand,
  createTestProduct,
  supportStaff,
} from './support/catalogue-fixtures';
import { createDependents, dependentRecords } from './support/dependent-records';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

function category(name: string, parentId: string | null = null, slug?: string) {
  return createCategory(
    actorFor(),
    createCategorySchema.parse({ name, parentId, ...(slug === undefined ? {} : { slug }) }),
  );
}

async function chain(...names: string[]) {
  const created = [];
  let parentId: string | null = null;
  for (const name of names) {
    const node = await category(name, parentId);
    created.push(node);
    parentId = node.id;
  }
  return created;
}

function move(categoryId: string, parentId: string | null) {
  return moveCategory(actorFor(), categoryId, moveCategorySchema.parse({ parentId }));
}

function tag(productIds: string[], categoryId: string | null) {
  return tagProducts(actorFor(), tagProductsSchema.parse({ productIds, categoryId }));
}

async function products(count: number) {
  const productType = await createApparelType();
  const brand = await createTestBrand();
  const created = [];
  for (let index = 0; index < count; index += 1) {
    created.push(
      await createTestProduct({
        productTypeId: productType.id,
        brandId: brand.id,
        slug: `item-${index}`,
      }),
    );
  }
  return created;
}

// Every stored path must equal parent path + slug, and the level must match: no cycles, no drift.
async function treeIsConsistent(): Promise<boolean> {
  const rows = await database.category.findMany();
  const byId = new Map(rows.map((row) => [row.id, row]));
  return rows.every((row) => {
    const parent = row.parentId === null ? null : byId.get(row.parentId);
    if (row.parentId !== null && parent === undefined) return false;
    return (
      row.path === `${parent?.path ?? '/'}${row.slug}/` && row.level === (parent?.level ?? 0) + 1
    );
  });
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('creating categories', () => {
  it('builds levels 1–4 with paths from slugs, audits each, and refuses a fifth level (422)', async () => {
    const [apparel, men, topwear, shirts] = await chain('Apparel', 'Men', 'Topwear', 'Shirts');
    expect(shirts).toMatchObject({
      level: 4,
      path: '/apparel/men/topwear/shirts/',
      parentId: topwear?.id,
    });
    expect(apparel?.path).toBe('/apparel/');
    expect(men?.level).toBe(2);
    await expect(category('Formal', shirts?.id ?? null)).rejects.toMatchObject({
      code: 'CATEGORY_TOO_DEEP',
      httpStatus: 422,
    });
    expect(await database.auditLog.count({ where: { action: 'taxonomy.category_created' } })).toBe(
      4,
    );
  });

  it('refuses a duplicate slug anywhere in the tree (409)', async () => {
    const [apparel] = await chain('Apparel');
    await category('Shoes', apparel?.id ?? null, 'shoes');
    await expect(category('Shoes again', null, 'shoes')).rejects.toMatchObject({
      code: 'CATEGORY_SLUG_TAKEN',
      httpStatus: 409,
    });
  });

  it('refuses children under a category that has products, so products stay on leaves (409)', async () => {
    const [apparel, kurtas] = await chain('Apparel', 'Kurtas');
    const [product] = await products(1);
    await tag([product?.id ?? ''], kurtas?.id ?? null);
    await expect(category('Silk kurtas', kurtas?.id ?? null)).rejects.toMatchObject({
      code: 'CATEGORY_HAS_PRODUCTS',
      httpStatus: 409,
    });
    expect(apparel).toBeDefined();
  });

  it('refuses every write to read-only staff and staff without taxonomy.write (403), changing nothing', async () => {
    const [root, leaf] = await chain('Rbac root', 'Rbac leaf');
    const [product] = await products(1);
    if (root === undefined || leaf === undefined || product === undefined) {
      throw new Error('setup did not create the tree and product');
    }
    const treeBefore = await database.category.findMany({ orderBy: { id: 'asc' } });
    const auditBefore = await database.auditLog.count();
    const outboxBefore = await database.searchOutbox.count();
    for (const staff of [supportStaff, catalogueWriterWithoutTaxonomy]) {
      const actor = actorFor(staff);
      for (const attempt of [
        () => createCategory(actor, createCategorySchema.parse({ name: 'Nope' })),
        () => updateCategory(actor, leaf.id, updateCategorySchema.parse({ name: 'Renamed' })),
        () => moveCategory(actor, leaf.id, moveCategorySchema.parse({ parentId: null })),
        () =>
          changeCategoryStatus(
            actor,
            root.id,
            changeCategoryStatusSchema.parse({ isActive: false }),
          ),
        () => deleteCategory(actor, leaf.id),
        () =>
          tagProducts(
            actor,
            tagProductsSchema.parse({ productIds: [product.id], categoryId: leaf.id }),
          ),
      ]) {
        await expect(attempt()).rejects.toMatchObject({
          code: 'PERMISSION_DENIED',
          httpStatus: 403,
        });
      }
    }
    expect(await database.category.findMany({ orderBy: { id: 'asc' } })).toEqual(treeBefore);
    expect(await database.auditLog.count()).toBe(auditBefore);
    expect(await database.searchOutbox.count()).toBe(outboxBefore);
    expect(
      (await database.product.findUniqueOrThrow({ where: { id: product.id } })).categoryId,
    ).toBeNull();
    await expect(listCategoryTree(supportStaff)).resolves.toHaveLength(2);
  });
});

describe('moving and renaming', () => {
  it('refuses a move under itself or its own descendant (409)', async () => {
    const [apparel, men, topwear] = await chain('Apparel', 'Men', 'Topwear');
    for (const target of [apparel, men, topwear]) {
      await expect(move(apparel?.id ?? '', target?.id ?? null)).rejects.toMatchObject({
        code: 'CATEGORY_MOVE_CYCLE',
        httpStatus: 409,
      });
    }
  });

  it('refuses a move that would make the tree deeper than four levels (422)', async () => {
    const [, men] = await chain('Apparel', 'Men', 'Topwear', 'Shirts');
    const [, sneakers] = await chain('Footwear', 'Sneakers');
    await expect(move(men?.id ?? '', sneakers?.id ?? null)).rejects.toMatchObject({
      code: 'CATEGORY_TOO_DEEP',
      httpStatus: 422,
    });
  });

  it('rewrites the paths and levels of the whole subtree in one move and reindexes its products', async () => {
    const [, men, topwear, shirts] = await chain('Apparel', 'Men', 'Topwear', 'Shirts');
    const [footwear] = await chain('Footwear');
    const [product] = await products(1);
    await tag([product?.id ?? ''], shirts?.id ?? null);
    const outboxBefore = await database.searchOutbox.count();
    const moved = await move(topwear?.id ?? '', footwear?.id ?? null);
    expect(moved).toMatchObject({ parentId: footwear?.id, level: 2, path: '/footwear/topwear/' });
    const movedShirts = await database.category.findUniqueOrThrow({
      where: { id: shirts?.id ?? '' },
    });
    expect(movedShirts).toMatchObject({ level: 3, path: '/footwear/topwear/shirts/' });
    expect(await treeIsConsistent()).toBe(true);
    expect(await database.searchOutbox.count()).toBe(outboxBefore + 1);
    expect(men).toBeDefined();
  });

  it('moves a category to the top level', async () => {
    const [, men] = await chain('Apparel', 'Men');
    expect(await move(men?.id ?? '', null)).toMatchObject({
      parentId: null,
      level: 1,
      path: '/men/',
    });
    expect(await treeIsConsistent()).toBe(true);
  });

  it('rewrites descendant paths when a slug is renamed', async () => {
    const [apparel, , topwear] = await chain('Apparel', 'Men', 'Topwear');
    await updateCategory(
      actorFor(),
      apparel?.id ?? '',
      updateCategorySchema.parse({ slug: 'clothing', name: 'Clothing' }),
    );
    const renamed = await database.category.findUniqueOrThrow({ where: { id: topwear?.id ?? '' } });
    expect(renamed.path).toBe('/clothing/men/topwear/');
    expect(await treeIsConsistent()).toBe(true);
  });

  it('never creates a cycle when two opposite moves race', async () => {
    for (let round = 0; round < 5; round += 1) {
      await truncateAllTestTables();
      const [left] = await chain('Left');
      const [right] = await chain('Right');
      const results = await Promise.allSettled([
        move(left?.id ?? '', right?.id ?? null),
        move(right?.id ?? '', left?.id ?? null),
      ]);
      expect(
        results.filter(({ status }) => status === 'fulfilled'),
        `round ${round}`,
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected?.reason).toMatchObject({ code: 'CATEGORY_MOVE_CYCLE' });
      expect(await treeIsConsistent(), `round ${round}`).toBe(true);
    }
  });
});

describe('activating and deactivating', () => {
  it('deactivates the whole subtree and only activates a child under an active parent (422)', async () => {
    const [apparel, men, topwear] = await chain('Apparel', 'Men', 'Topwear');
    await changeCategoryStatus(
      actorFor(),
      apparel?.id ?? '',
      changeCategoryStatusSchema.parse({ isActive: false }),
    );
    const statuses = await database.category.findMany({ select: { isActive: true } });
    expect(statuses.every(({ isActive }) => !isActive)).toBe(true);
    await expect(
      changeCategoryStatus(
        actorFor(),
        men?.id ?? '',
        changeCategoryStatusSchema.parse({ isActive: true }),
      ),
    ).rejects.toMatchObject({ code: 'PARENT_CATEGORY_INACTIVE', httpStatus: 422 });
    await changeCategoryStatus(
      actorFor(),
      apparel?.id ?? '',
      changeCategoryStatusSchema.parse({ isActive: true }),
    );
    const activated = await changeCategoryStatus(
      actorFor(),
      men?.id ?? '',
      changeCategoryStatusSchema.parse({ isActive: true }),
    );
    expect(activated.isActive).toBe(true);
    expect(
      (await database.category.findUniqueOrThrow({ where: { id: topwear?.id ?? '' } })).isActive,
    ).toBe(false);
  });
});

describe('deleting', () => {
  it('refuses a category with products or children (409) and deletes an empty leaf with an audit record', async () => {
    const [apparel, kurtas] = await chain('Apparel', 'Kurtas');
    const [product] = await products(1);
    await tag([product?.id ?? ''], kurtas?.id ?? null);
    await expect(deleteCategory(actorFor(), kurtas?.id ?? '')).rejects.toMatchObject({
      code: 'CATEGORY_HAS_PRODUCTS',
      httpStatus: 409,
    });
    await expect(deleteCategory(actorFor(), apparel?.id ?? '')).rejects.toMatchObject({
      code: 'CATEGORY_HAS_CHILDREN',
    });
    await tag([product?.id ?? ''], null);
    await deleteCategory(actorFor(), kurtas?.id ?? '');
    expect(await database.category.count()).toBe(1);
    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'taxonomy.category_deleted' },
      select: { before: true },
    });
    expect(audit.before).toMatchObject({ name: 'Kurtas', path: '/apparel/kurtas/' });
  });
});

describe('the category tree listing', () => {
  it('counts products through the whole subtree and leaves archived products out', async () => {
    const [apparel, men, shirts] = await chain('Apparel', 'Men', 'Shirts');
    const items = await products(3);
    await tag(
      items.map(({ id }) => id),
      shirts?.id ?? null,
    );
    await database.product.update({
      where: { id: items[0]?.id ?? '' },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    const tree = await listCategoryTree(supportStaff);
    const byId = new Map(tree.map((node) => [node.id, node]));
    expect(byId.get(apparel?.id ?? '')).toMatchObject({
      productCount: 2,
      directProductCount: 0,
      childCount: 1,
    });
    expect(byId.get(men?.id ?? '')).toMatchObject({ productCount: 2 });
    expect(byId.get(shirts?.id ?? '')).toMatchObject({
      productCount: 2,
      directProductCount: 2,
      childCount: 0,
    });
  });
});

describe('tagging', () => {
  it('tags products to a leaf, bumps their versions, and writes one audit and outbox row each', async () => {
    const [, kurtas] = await chain('Apparel', 'Kurtas');
    const items = await products(2);
    const result = await tag(
      items.map(({ id }) => id),
      kurtas?.id ?? null,
    );
    expect(result.changedProductIds.sort()).toEqual(items.map(({ id }) => id).sort());
    const tagged = await database.product.findMany({
      select: { categoryId: true, taggingStatus: true, version: true },
    });
    expect(
      tagged.every(
        (row) =>
          row.categoryId === kurtas?.id && row.taggingStatus === 'TAGGED' && row.version === 1,
      ),
    ).toBe(true);
    expect(await database.auditLog.count({ where: { action: 'taxonomy.product_tagged' } })).toBe(2);
    expect(
      await database.searchOutbox.count({ where: { entityId: { in: items.map(({ id }) => id) } } }),
    ).toBe(4);

    const again = await tag(
      items.map(({ id }) => id),
      kurtas?.id ?? null,
    );
    expect(again.changedProductIds).toEqual([]);
    expect(await database.auditLog.count({ where: { action: 'taxonomy.product_tagged' } })).toBe(2);

    await tag([items[0]?.id ?? ''], null);
    expect(
      (await database.product.findUniqueOrThrow({ where: { id: items[0]?.id ?? '' } }))
        .taggingStatus,
    ).toBe('UNTAGGED');
  });

  it('refuses a non-leaf (422), an inactive leaf (422), an unknown category (404) and unknown products (422)', async () => {
    const [apparel, kurtas] = await chain('Apparel', 'Kurtas');
    const [product] = await products(1);
    await expect(tag([product?.id ?? ''], apparel?.id ?? null)).rejects.toMatchObject({
      code: 'CATEGORY_NOT_LEAF',
      httpStatus: 422,
    });
    await changeCategoryStatus(
      actorFor(),
      kurtas?.id ?? '',
      changeCategoryStatusSchema.parse({ isActive: false }),
    );
    await expect(tag([product?.id ?? ''], kurtas?.id ?? null)).rejects.toMatchObject({
      code: 'CATEGORY_INACTIVE',
      httpStatus: 422,
    });
    await expect(
      tag([product?.id ?? ''], '0195f2a0-0000-7000-8000-000000000999'),
    ).rejects.toMatchObject({
      code: 'CATEGORY_NOT_FOUND',
      httpStatus: 404,
    });
    await expect(tag(['0195f2a0-0000-7000-8000-000000000998'], null)).rejects.toMatchObject({
      code: 'PRODUCTS_NOT_FOUND',
    });
  });

  it('is all or nothing: one archived product stops the whole bulk change (409)', async () => {
    const [, kurtas] = await chain('Apparel', 'Kurtas');
    const items = await products(3);
    await database.product.update({
      where: { id: items[1]?.id ?? '' },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await expect(
      tag(
        items.map(({ id }) => id),
        kurtas?.id ?? null,
      ),
    ).rejects.toMatchObject({
      code: 'PRODUCTS_ARCHIVED',
      httpStatus: 409,
      details: { productIds: [items[1]?.id] },
    });
    expect(await database.product.count({ where: { categoryId: { not: null } } })).toBe(0);
    expect(await database.auditLog.count({ where: { action: 'taxonomy.product_tagged' } })).toBe(0);
  });

  it('never leaves products on a category that has children when tagging races child creation', async () => {
    for (let round = 0; round < 5; round += 1) {
      await truncateAllTestTables();
      const [, kurtas] = await chain('Apparel', 'Kurtas');
      const [product] = await products(1);
      const results = await Promise.allSettled([
        tag([product?.id ?? ''], kurtas?.id ?? null),
        category(`Silk ${round}`, kurtas?.id ?? null),
      ]);
      expect(
        results.filter(({ status }) => status === 'fulfilled'),
        `round ${round}`,
      ).toHaveLength(1);
      const children = await database.category.count({ where: { parentId: kurtas?.id ?? '' } });
      const onKurtas = await database.product.count({ where: { categoryId: kurtas?.id ?? '' } });
      expect(children > 0 && onKurtas > 0, `round ${round}`).toBe(false);
    }
  });

  it('completes overlapping bulk changes in opposite orders without deadlocking', async () => {
    const [, kurtas] = await chain('Apparel', 'Kurtas');
    const [, shirts] = await chain('Menswear', 'Shirts');
    const ids = (await products(6)).map(({ id }) => id);
    const results = await Promise.allSettled([
      tag(ids, kurtas?.id ?? null),
      tag([...ids].reverse(), shirts?.id ?? null),
      tag(ids.slice(2), kurtas?.id ?? null),
    ]);
    expect(results.every(({ status }) => status === 'fulfilled')).toBe(true);
    const categoryIds = new Set(
      (await database.product.findMany({ select: { categoryId: true } })).map(
        ({ categoryId }) => categoryId,
      ),
    );
    expect([...categoryIds].every((id) => id === kurtas?.id || id === shirts?.id)).toBe(true);
  });
});

describe('category changes never touch orders, carts, stock, reviews or collections', () => {
  it('keeps every dependent row byte-identical through tagging, moving, renaming and untagging', async () => {
    const [, kurtas] = await chain('Apparel', 'Kurtas');
    const [footwear] = await chain('Footwear');
    const [product] = await products(1);
    const variant = await database.productVariant.create({
      data: {
        productId: product?.id ?? '',
        sku: 'KURTA-M',
        optionSignature: 'size=M',
        optionValues: { size: 'M' },
        mrpPaise: 99_900,
        pricePaise: 79_900,
        weightGrams: 300,
        lengthMm: 300,
        breadthMm: 250,
        heightMm: 30,
      },
    });
    await createDependents(product?.id ?? '', variant.id);
    const before = await dependentRecords();
    await tag([product?.id ?? ''], kurtas?.id ?? null);
    await move(kurtas?.id ?? '', footwear?.id ?? null);
    await updateCategory(
      actorFor(),
      kurtas?.id ?? '',
      updateCategorySchema.parse({ slug: 'ethnic-kurtas' }),
    );
    await tag([product?.id ?? ''], null);
    expect(await dependentRecords()).toEqual(before);
  });
});

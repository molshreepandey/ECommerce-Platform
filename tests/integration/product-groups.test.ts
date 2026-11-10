import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { getDatabase } from '@/lib/db';
import {
  addGroupMembers,
  createProductGroup,
  deleteProductGroup,
  getProductGroup,
  listProductGroups,
  removeGroupMember,
  renameProductGroup,
  setGroupMembers,
} from '@/modules/grouping/product-group.service';
import {
  addGroupMembersSchema,
  createProductGroupSchema,
  listProductGroupsSchema,
  renameProductGroupSchema,
  setGroupMembersSchema,
} from '@/modules/grouping/grouping.schema';
import { createCategory } from '@/modules/taxonomy/category.service';
import { tagProducts } from '@/modules/taxonomy/tagging.service';
import { createCategorySchema, tagProductsSchema } from '@/modules/taxonomy/taxonomy.schema';

import {
  actorFor,
  catalogueWriterWithoutTaxonomy,
  createApparelType,
  createTestBrand,
  supportStaff,
} from './support/catalogue-fixtures';
import { createDependents, dependentRecords } from './support/dependent-records';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

// Many products quickly: one insert, the same columns the product service would write.
async function products(count: number, prefix = 'item'): Promise<string[]> {
  const productType = await createApparelType(`apparel_${prefix.replaceAll('-', '_')}`);
  const brand = await createTestBrand(`brand-${prefix}`);
  const rows = await database.product.createManyAndReturn({
    data: Array.from({ length: count }, (_, index) => ({
      productTypeId: productType.id,
      brandId: brand.id,
      name: `${prefix} ${index}`,
      slug: `${prefix}-${index}`,
      attributes: { fabric: 'Cotton' },
      taxRateBasisPoints: 500,
    })),
    select: { id: true },
  });
  return rows.map(({ id }) => id).sort();
}

function group(name: string) {
  return createProductGroup(actorFor(), createProductGroupSchema.parse({ name }));
}

function add(groupId: string, productIds: string[]) {
  return addGroupMembers(actorFor(), groupId, addGroupMembersSchema.parse({ productIds }));
}

async function storedCount(groupId: string) {
  const row = await database.productGroup.findUniqueOrThrow({ where: { id: groupId } });
  return {
    stored: row.memberCount,
    actual: await database.product.count({ where: { productGroupId: groupId } }),
  };
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('groups', () => {
  it('creates, renames, searches and lists groups with member counts, auditing each change', async () => {
    const prints = await group('Anarkali prints');
    await group('Runner colours');
    await renameProductGroup(
      actorFor(),
      prints.id,
      renameProductGroupSchema.parse({ name: 'Anarkali kurta prints' }),
    );
    const found = await listProductGroups(
      supportStaff,
      listProductGroupsSchema.parse({ search: 'KURTA' }),
    );
    expect(found).toEqual([{ id: prints.id, name: 'Anarkali kurta prints', memberCount: 0 }]);
    expect(
      await database.auditLog.count({
        where: { action: { in: ['grouping.group_created', 'grouping.group_renamed'] } },
      }),
    ).toBe(3);
  });

  it('refuses every write to read-only staff and staff without taxonomy.write (403), and answers 404 for an unknown group', async () => {
    const [member, outsider] = await products(2, 'rbac');
    if (member === undefined || outsider === undefined)
      throw new Error('setup created no products');
    const prints = await group('Rbac prints');
    await add(prints.id, [member]);
    const groupsBefore = await database.productGroup.findMany({ orderBy: { id: 'asc' } });
    const productsBefore = await database.product.findMany({
      where: { id: { in: [member, outsider] } },
      orderBy: { id: 'asc' },
    });
    const auditBefore = await database.auditLog.count();
    const outboxBefore = await database.searchOutbox.count();
    for (const staff of [supportStaff, catalogueWriterWithoutTaxonomy]) {
      const actor = actorFor(staff);
      for (const attempt of [
        () => createProductGroup(actor, createProductGroupSchema.parse({ name: 'Nope' })),
        () =>
          renameProductGroup(actor, prints.id, renameProductGroupSchema.parse({ name: 'Nope' })),
        () =>
          addGroupMembers(
            actor,
            prints.id,
            addGroupMembersSchema.parse({ productIds: [outsider] }),
          ),
        () =>
          setGroupMembers(
            actor,
            prints.id,
            setGroupMembersSchema.parse({ members: [{ productId: member, swatchLabel: 'Red' }] }),
          ),
        () => removeGroupMember(actor, prints.id, member),
        () => deleteProductGroup(actor, prints.id),
      ]) {
        await expect(attempt()).rejects.toMatchObject({
          code: 'PERMISSION_DENIED',
          httpStatus: 403,
        });
      }
    }
    expect(await database.productGroup.findMany({ orderBy: { id: 'asc' } })).toEqual(groupsBefore);
    expect(
      await database.product.findMany({
        where: { id: { in: [member, outsider] } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(productsBefore);
    expect(await database.auditLog.count()).toBe(auditBefore);
    expect(await database.searchOutbox.count()).toBe(outboxBefore);
    await expect(
      getProductGroup(supportStaff, '0195f2a0-0000-7000-8000-000000000999'),
    ).rejects.toMatchObject({
      code: 'PRODUCT_GROUP_NOT_FOUND',
      httpStatus: 404,
    });
  });
});

describe('members', () => {
  it('adds members in order, keeps the count exact, bumps versions and skips products already in the group', async () => {
    const ids = await products(3);
    const prints = await group('Prints');
    const added = await add(prints.id, ids);
    expect(added.memberCount).toBe(3);
    expect(added.members.map(({ id, groupDisplayOrder }) => [id, groupDisplayOrder])).toEqual(
      ids.map((id, index) => [id, index + 1]),
    );
    const versions = await database.product.findMany({
      where: { id: { in: ids } },
      select: { version: true },
    });
    expect(versions.every(({ version }) => version === 1)).toBe(true);
    expect(await database.searchOutbox.count({ where: { entityId: { in: ids } } })).toBe(3);

    const again = await add(prints.id, ids);
    expect(again.memberCount).toBe(3);
    expect(await database.auditLog.count({ where: { action: 'grouping.members_added' } })).toBe(1);
  });

  it('refuses the 51st member (422) and writes nothing', async () => {
    const ids = await products(51);
    const prints = await group('Prints');
    await add(prints.id, ids.slice(0, 50));
    await expect(add(prints.id, ids.slice(50))).rejects.toMatchObject({
      code: 'GROUP_FULL',
      httpStatus: 422,
      details: { limit: 50, memberCount: 50 },
    });
    expect(await storedCount(prints.id)).toEqual({ stored: 50, actual: 50 });
  });

  it('refuses a product already in another group (409), archived products (409) and unknown ones (422)', async () => {
    const ids = await products(3);
    const prints = await group('Prints');
    const colours = await group('Colours');
    await add(prints.id, [ids[0] ?? '']);
    await expect(add(colours.id, [ids[0] ?? '', ids[1] ?? ''])).rejects.toMatchObject({
      code: 'PRODUCT_IN_ANOTHER_GROUP',
      httpStatus: 409,
      details: { productIds: [ids[0]] },
    });
    await database.product.update({
      where: { id: ids[2] ?? '' },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await expect(add(colours.id, [ids[2] ?? ''])).rejects.toMatchObject({
      code: 'PRODUCTS_ARCHIVED',
      httpStatus: 409,
    });
    await expect(add(colours.id, ['0195f2a0-0000-7000-8000-000000000999'])).rejects.toMatchObject({
      code: 'PRODUCTS_NOT_FOUND',
    });
    expect(await storedCount(colours.id)).toEqual({ stored: 0, actual: 0 });
  });

  it('removes a member, renumbers the rest and answers 404 for a product not in the group', async () => {
    const ids = await products(3);
    const prints = await group('Prints');
    await add(prints.id, ids);
    const after = await removeGroupMember(actorFor(), prints.id, ids[1] ?? '');
    expect(after.members.map(({ id, groupDisplayOrder }) => [id, groupDisplayOrder])).toEqual([
      [ids[0], 1],
      [ids[2], 2],
    ]);
    expect(after.memberCount).toBe(2);
    const removed = await database.product.findUniqueOrThrow({ where: { id: ids[1] ?? '' } });
    expect(removed).toMatchObject({
      productGroupId: null,
      groupDisplayOrder: null,
      groupSwatchLabel: null,
    });
    await expect(removeGroupMember(actorFor(), prints.id, ids[1] ?? '')).rejects.toMatchObject({
      code: 'PRODUCT_NOT_IN_GROUP',
      httpStatus: 404,
    });
  });

  it('sets the display order and swatch labels from the full list and refuses a stale list (409)', async () => {
    const ids = await products(3);
    const prints = await group('Prints');
    await add(prints.id, ids);
    const [first, second, third] = ids;
    const reordered = await setGroupMembers(
      actorFor(),
      prints.id,
      setGroupMembersSchema.parse({
        members: [
          { productId: third, swatchLabel: 'Indigo' },
          { productId: first, swatchLabel: 'Rust' },
          { productId: second, swatchLabel: null },
        ],
      }),
    );
    expect(
      reordered.members.map(({ id, groupDisplayOrder, groupSwatchLabel }) => [
        id,
        groupDisplayOrder,
        groupSwatchLabel,
      ]),
    ).toEqual([
      [third, 1, 'Indigo'],
      [first, 2, 'Rust'],
      [second, 3, null],
    ]);
    await expect(
      setGroupMembers(
        actorFor(),
        prints.id,
        setGroupMembersSchema.parse({ members: [{ productId: first, swatchLabel: null }] }),
      ),
    ).rejects.toMatchObject({ code: 'STALE_GROUP_MEMBERS', httpStatus: 409 });
  });

  it('deletes a group by ungrouping every member, archived ones included, and keeps them in the audit row', async () => {
    const ids = await products(2);
    const prints = await group('Prints');
    await add(prints.id, ids);
    await database.product.update({
      where: { id: ids[0] ?? '' },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await deleteProductGroup(actorFor(), prints.id);
    expect(await database.productGroup.count()).toBe(0);
    expect(await database.product.count({ where: { productGroupId: { not: null } } })).toBe(0);
    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'grouping.group_deleted' },
      select: { before: true },
    });
    // Parsed, not cast: the audit row must really hold the member list as JSON text.
    const before = z
      .object({ name: z.string(), memberCount: z.number(), members: z.string() })
      .parse(audit.before);
    expect(before).toMatchObject({ name: 'Prints', memberCount: 2 });
    const members = z
      .array(z.object({ id: z.string(), swatchLabel: z.string().nullable() }))
      .parse(JSON.parse(before.members));
    expect(members.map(({ id }) => id).sort()).toEqual([...ids].sort());
  });
});

describe('membership under concurrency', () => {
  it('never lets concurrent additions pass 50 members and keeps the count exact', async () => {
    const ids = await products(60);
    const prints = await group('Prints');
    const results = await Promise.allSettled([
      add(prints.id, ids.slice(0, 30)),
      add(prints.id, ids.slice(30, 60)),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')?.reason).toMatchObject({
      code: 'GROUP_FULL',
    });
    expect(await storedCount(prints.id)).toEqual({ stored: 30, actual: 30 });

    const roomy = await group('Roomy');
    const more = await products(40, 'more');
    await Promise.all([add(roomy.id, more.slice(0, 20)), add(roomy.id, more.slice(20, 40))]);
    expect(await storedCount(roomy.id)).toEqual({ stored: 40, actual: 40 });
    const orders = (await getProductGroup(supportStaff, roomy.id)).members.map(
      ({ groupDisplayOrder }) => groupDisplayOrder,
    );
    expect(new Set(orders).size).toBe(40);
  });

  it('puts a product in only one group when two groups claim it at once', async () => {
    const [productId] = await products(1);
    const prints = await group('Prints');
    const colours = await group('Colours');
    const results = await Promise.allSettled([
      add(prints.id, [productId ?? '']),
      add(colours.id, [productId ?? '']),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')?.reason).toMatchObject({
      code: 'PRODUCT_IN_ANOTHER_GROUP',
    });
  });

  it('completes a group change and an overlapping bulk tagging without deadlocking', async () => {
    const ids = await products(8);
    const prints = await group('Prints');
    const apparel = await createCategory(
      actorFor(),
      createCategorySchema.parse({ name: 'Apparel' }),
    );
    const kurtas = await createCategory(
      actorFor(),
      createCategorySchema.parse({ name: 'Kurtas', parentId: apparel.id }),
    );
    const results = await Promise.allSettled([
      add(prints.id, [...ids].reverse()),
      tagProducts(actorFor(), tagProductsSchema.parse({ productIds: ids, categoryId: kurtas.id })),
    ]);
    expect(results.every(({ status }) => status === 'fulfilled')).toBe(true);
    expect(await storedCount(prints.id)).toEqual({ stored: 8, actual: 8 });
  });
});

describe('group changes never touch orders, carts, stock, reviews or collections', () => {
  it('keeps every dependent row byte-identical through add, reorder, remove and delete', async () => {
    const [productId, otherId] = await products(2);
    const variant = await database.productVariant.create({
      data: {
        productId: productId ?? '',
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
    await createDependents(productId ?? '', variant.id);
    const before = await dependentRecords();
    const prints = await group('Prints');
    await add(prints.id, [productId ?? '', otherId ?? '']);
    await setGroupMembers(
      actorFor(),
      prints.id,
      setGroupMembersSchema.parse({
        members: [
          { productId: otherId, swatchLabel: 'A' },
          { productId, swatchLabel: 'B' },
        ],
      }),
    );
    await removeGroupMember(actorFor(), prints.id, otherId ?? '');
    await deleteProductGroup(actorFor(), prints.id);
    expect(await dependentRecords()).toEqual(before);
  });
});

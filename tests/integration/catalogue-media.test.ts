import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import {
  addMediaSchema,
  createVariantSchema,
  reorderMediaSchema,
  updateMediaSchema,
} from '@/modules/catalogue/catalogue.schema';
import {
  addMedia,
  deleteMedia,
  reorderMedia,
  updateMedia,
} from '@/modules/catalogue/media.service';
import { createVariant } from '@/modules/catalogue/variant.service';

import {
  actorFor,
  createApparelType,
  createTestBrand,
  createTestProduct,
  supportStaff,
} from './support/catalogue-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();
const imageUrl = (seed: string) => `https://picsum.photos/seed/${seed}/600/800`;

async function setUp() {
  const productType = await createApparelType();
  const brand = await createTestBrand();
  const product = await createTestProduct({ productTypeId: productType.id, brandId: brand.id });
  const other = await createTestProduct({
    productTypeId: productType.id,
    brandId: brand.id,
    slug: 'other',
  });
  const variantFor = async (productId: string, sku: string) =>
    (
      await createVariant(
        actorFor(),
        productId,
        createVariantSchema.parse({
          sku,
          optionValues: { size: 'M' },
          mrpPaise: 99_900,
          pricePaise: 79_900,
          weightGrams: 300,
          lengthMm: 300,
          breadthMm: 250,
          heightMm: 30,
        }),
      )
    ).variant;
  return {
    product,
    other,
    ownVariant: await variantFor(product.id, 'KURTA-M'),
    otherVariant: await variantFor(other.id, 'OTHER-M'),
  };
}

function add(productId: string, seed: string, variantId?: string) {
  return addMedia(
    actorFor(),
    productId,
    addMediaSchema.parse({ url: imageUrl(seed), altText: `Photo ${seed}`, variantId }),
  );
}

async function positions(productId: string) {
  const rows = await database.productMedia.findMany({
    where: { productId },
    select: { altText: true, position: true },
    orderBy: { position: 'asc' },
  });
  return rows.map(({ altText, position }) => `${position}:${altText}`);
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('adding images', () => {
  it('appends in order, links an image to the product’s own variant, and audits each one', async () => {
    const { product, ownVariant } = await setUp();
    await add(product.id, 'front');
    const { media } = await add(product.id, 'back', ownVariant.id);
    expect(media).toMatchObject({ position: 1, variantId: ownVariant.id });
    expect(await positions(product.id)).toEqual(['0:Photo front', '1:Photo back']);
    expect(await database.auditLog.count({ where: { action: 'catalogue.media_added' } })).toBe(2);
  });

  it('refuses a variant that belongs to another product (422) and writes nothing', async () => {
    const { product, otherVariant } = await setUp();
    await expect(add(product.id, 'wrong', otherVariant.id)).rejects.toMatchObject({
      code: 'VARIANT_NOT_IN_PRODUCT',
      httpStatus: 422,
    });
    await expect(
      add(product.id, 'missing', '0195f2a0-0000-7000-8000-000000000999'),
    ).rejects.toMatchObject({
      code: 'VARIANT_NOT_IN_PRODUCT',
    });
    expect(await database.productMedia.count()).toBe(0);
    expect(await database.auditLog.count({ where: { action: 'catalogue.media_added' } })).toBe(0);
  });

  it('refuses images from hosts the Content-Security-Policy does not allow', async () => {
    const { product } = await setUp();
    await expect(
      addMedia(
        actorFor(),
        product.id,
        addMediaSchema.parse({ url: 'https://images.example.test/kurta.jpg', altText: 'Front' }),
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fieldErrors: { url: [expect.stringContaining('picsum.photos')] } },
    });
  });

  it('stops at 20 images per product', async () => {
    const { product } = await setUp();
    for (let index = 0; index < 20; index += 1) await add(product.id, `photo-${index}`);
    await expect(add(product.id, 'one-too-many')).rejects.toMatchObject({
      code: 'MEDIA_LIMIT_REACHED',
      httpStatus: 409,
    });
  });

  it('gives concurrent uploads distinct positions', async () => {
    const { product } = await setUp();
    await Promise.all(
      Array.from({ length: 6 }, (_, index) => add(product.id, `parallel-${index}`)),
    );
    const rows = await database.productMedia.findMany({
      where: { productId: product.id },
      select: { position: true },
      orderBy: { position: 'asc' },
    });
    expect(rows.map(({ position }) => position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('needs catalogue.write and refuses changes to an archived product', async () => {
    const { product } = await setUp();
    await expect(
      addMedia(
        actorFor(supportStaff),
        product.id,
        addMediaSchema.parse({ url: imageUrl('x'), altText: 'Front' }),
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await database.product.update({
      where: { id: product.id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await expect(add(product.id, 'late')).rejects.toMatchObject({ code: 'PRODUCT_ARCHIVED' });
  });
});

describe('changing and reordering images', () => {
  it('updates alt text and variant links, refusing another product’s variant', async () => {
    const { product, ownVariant, otherVariant } = await setUp();
    const { media } = await add(product.id, 'front');
    const { media: updated } = await updateMedia(
      actorFor(),
      media.id,
      updateMediaSchema.parse({ altText: 'Front, indigo', variantId: ownVariant.id }),
    );
    expect(updated).toMatchObject({ altText: 'Front, indigo', variantId: ownVariant.id });
    await expect(
      updateMedia(actorFor(), media.id, updateMediaSchema.parse({ variantId: otherVariant.id })),
    ).rejects.toMatchObject({ code: 'VARIANT_NOT_IN_PRODUCT' });
    const unlinked = await updateMedia(
      actorFor(),
      media.id,
      updateMediaSchema.parse({ variantId: null }),
    );
    expect(unlinked.media.variantId).toBeNull();
  });

  it('reorders in one go and refuses an order made from a stale list', async () => {
    const { product } = await setUp();
    const ids = [];
    for (const seed of ['a', 'b', 'c']) ids.push((await add(product.id, seed)).media.id);
    const [first, second, third] = ids;
    if (first === undefined || second === undefined || third === undefined)
      throw new Error('fixture');
    const { media } = await reorderMedia(
      actorFor(),
      product.id,
      reorderMediaSchema.parse({ mediaIds: [third, first, second] }),
    );
    expect(media.map(({ id, position }) => [id, position])).toEqual([
      [third, 0],
      [first, 1],
      [second, 2],
    ]);
    await expect(
      reorderMedia(actorFor(), product.id, reorderMediaSchema.parse({ mediaIds: [first, second] })),
    ).rejects.toMatchObject({ code: 'STALE_MEDIA_ORDER', httpStatus: 409 });
    await expect(
      reorderMedia(
        actorFor(),
        product.id,
        reorderMediaSchema.parse({
          mediaIds: [first, second, '0195f2a0-0000-7000-8000-000000000999'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'STALE_MEDIA_ORDER' });
  });
});

describe('deleting images', () => {
  it('removes the row, closes the gap and keeps the complete record in the audit trail', async () => {
    const { product, ownVariant } = await setUp();
    await add(product.id, 'front');
    const { media: doomed } = await add(product.id, 'side', ownVariant.id);
    await add(product.id, 'back');
    const actor = actorFor();
    await deleteMedia(actor, doomed.id);
    expect(await database.productMedia.findUnique({ where: { id: doomed.id } })).toBeNull();
    expect(await positions(product.id)).toEqual(['0:Photo front', '1:Photo back']);
    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'catalogue.media_deleted', entityId: doomed.id },
      select: { actorId: true, entityType: true, before: true, after: true },
    });
    expect(audit).toEqual({
      actorId: actor.staff.staffUserId,
      entityType: 'product_media',
      before: {
        imageId: doomed.id,
        productId: product.id,
        variantId: ownVariant.id,
        url: imageUrl('side'),
        altText: 'Photo side',
        position: 1,
      },
      after: null,
    });
  });

  it('answers 404 for an image that does not exist', async () => {
    await expect(
      deleteMedia(actorFor(), '0195f2a0-0000-7000-8000-000000000999'),
    ).rejects.toMatchObject({
      code: 'MEDIA_NOT_FOUND',
      httpStatus: 404,
    });
  });
});

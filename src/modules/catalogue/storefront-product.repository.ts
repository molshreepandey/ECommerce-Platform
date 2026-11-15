import type { DatabaseClient } from '@/lib/db';

export function findProductIdBySlug(database: DatabaseClient, slug: string) {
  return database.product.findUnique({ where: { slug }, select: { id: true } });
}

export function findStorefrontProductRow(database: DatabaseClient, productId: string) {
  return database.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      status: true,
      attributes: true,
      productTypeId: true,
      categoryId: true,
      productGroupId: true,
      brand: { select: { name: true, slug: true } },
      variants: {
        where: { status: 'ACTIVE' },
        select: { id: true, sku: true, optionValues: true, pricePaise: true, mrpPaise: true },
        orderBy: [{ pricePaise: 'asc' }, { sku: 'asc' }],
      },
      media: {
        select: { id: true, url: true, altText: true, variantId: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      },
    },
  });
}

// Active members of a group in display order, each with its first image (one query, no N+1).
export function listGroupSwatchRows(database: DatabaseClient, productGroupId: string) {
  return database.product.findMany({
    where: { productGroupId, status: 'ACTIVE', variants: { some: { status: 'ACTIVE' } } },
    select: {
      id: true,
      slug: true,
      name: true,
      groupSwatchLabel: true,
      media: {
        select: { url: true, altText: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        take: 1,
      },
    },
    orderBy: [{ groupDisplayOrder: 'asc' }, { name: 'asc' }],
  });
}

export function listFilterableDefinitionLabels(database: DatabaseClient) {
  return database.attributeDefinition.findMany({
    where: { isFilterable: true, archivedAt: null, productType: { archivedAt: null } },
    select: { code: true, label: true, allowedValues: true },
    orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
  });
}

// Cart and checkout lines: one query for every variant in the cart, with what a line shows and what an
// order line snapshots (L23 dimensions, L31 category and group).
export function findPurchasableVariantRows(
  database: DatabaseClient,
  variantIds: readonly string[],
) {
  return database.productVariant.findMany({
    where: { id: { in: [...variantIds] } },
    select: {
      id: true,
      sku: true,
      status: true,
      optionValues: true,
      pricePaise: true,
      mrpPaise: true,
      weightGrams: true,
      lengthMm: true,
      breadthMm: true,
      heightMm: true,
      media: {
        select: { url: true, altText: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        take: 1,
      },
      product: {
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          taxRateBasisPoints: true,
          productGroupId: true,
          brand: { select: { name: true } },
          category: { select: { id: true, name: true, path: true } },
          media: {
            select: { url: true, altText: true },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            take: 1,
          },
        },
      },
    },
  });
}

// Proxy check (unique slug index): an ACTIVE product with at least one ACTIVE variant.
export async function storefrontProductSlugExists(
  database: DatabaseClient,
  slug: string,
): Promise<boolean> {
  const count = await database.product.count({
    where: { slug, status: 'ACTIVE', variants: { some: { status: 'ACTIVE' } } },
  });
  return count > 0;
}

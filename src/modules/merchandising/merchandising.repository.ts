import type { DatabaseClient } from '@/lib/db';

import type { BannerInput, CollectionInput } from './merchandising.schema';

const collectionSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
} as const;

export function listCollectionRows(database: DatabaseClient) {
  return database.collection.findMany({
    select: { ...collectionSelect, _count: { select: { products: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

export function findCollectionRow(database: DatabaseClient, collectionId: string) {
  return database.collection.findUnique({
    where: { id: collectionId },
    select: {
      ...collectionSelect,
      products: {
        select: {
          productId: true,
          position: true,
          product: { select: { name: true, status: true } },
        },
        orderBy: [{ position: 'asc' }, { productId: 'asc' }],
      },
    },
  });
}

export function findCollectionBySlug(database: DatabaseClient, slug: string) {
  return database.collection.findUnique({
    where: { slug },
    select: {
      ...collectionSelect,
      products: {
        select: { productId: true },
        orderBy: [{ position: 'asc' }, { productId: 'asc' }],
      },
    },
  });
}

export function insertCollection(database: DatabaseClient, input: CollectionInput) {
  return database.collection.create({ data: input, select: collectionSelect });
}

export function updateCollectionRow(
  database: DatabaseClient,
  collectionId: string,
  input: CollectionInput,
) {
  return database.collection.update({
    where: { id: collectionId },
    data: input,
    select: collectionSelect,
  });
}

export async function lockCollection(
  database: DatabaseClient,
  collectionId: string,
): Promise<boolean> {
  const rows = await database.$queryRaw<{ id: string }[]>`
    SELECT id FROM collections WHERE id = ${collectionId}::uuid FOR UPDATE`;
  return rows.length === 1;
}

export async function replaceCollectionProducts(
  database: DatabaseClient,
  collectionId: string,
  productIds: readonly string[],
): Promise<void> {
  await database.collectionProduct.deleteMany({ where: { collectionId } });
  if (productIds.length === 0) return;
  await database.collectionProduct.createMany({
    data: productIds.map((productId, position) => ({ collectionId, productId, position })),
  });
}

export function countExistingProducts(database: DatabaseClient, productIds: readonly string[]) {
  return database.product.count({ where: { id: { in: [...productIds] } } });
}

const bannerSelect = {
  id: true,
  title: true,
  imageUrl: true,
  linkUrl: true,
  position: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
} as const;

export function listBannerRows(database: DatabaseClient) {
  return database.banner.findMany({
    select: bannerSelect,
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  });
}

export function insertBanner(database: DatabaseClient, input: BannerInput) {
  return database.banner.create({ data: input, select: bannerSelect });
}

export function findBannerRow(database: DatabaseClient, bannerId: string) {
  return database.banner.findUnique({ where: { id: bannerId }, select: bannerSelect });
}

export function updateBannerRow(database: DatabaseClient, bannerId: string, input: BannerInput) {
  return database.banner.update({ where: { id: bannerId }, data: input, select: bannerSelect });
}

export function deleteBannerRow(database: DatabaseClient, bannerId: string) {
  return database.banner.deleteMany({ where: { id: bannerId } });
}

// Proxy check for /collections/<slug> (unique slug index), with the same window rule as the page.
export async function isCollectionVisible(
  database: DatabaseClient,
  slug: string,
  now: Date,
): Promise<boolean> {
  const count = await database.collection.count({
    where: {
      slug,
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      ],
    },
  });
  return count > 0;
}

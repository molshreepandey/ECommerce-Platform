import type { DatabaseClient } from '@/lib/db';

import { mediaSelect, type MediaRow } from './product.repository';

export function listMedia(database: DatabaseClient, productId: string): Promise<MediaRow[]> {
  return database.productMedia.findMany({
    where: { productId },
    select: mediaSelect,
    orderBy: { position: 'asc' },
  });
}

export function findMedia(database: DatabaseClient, mediaId: string): Promise<MediaRow | null> {
  return database.productMedia.findUnique({ where: { id: mediaId }, select: mediaSelect });
}

export function insertMedia(
  database: DatabaseClient,
  data: {
    productId: string;
    variantId: string | null;
    url: string;
    altText: string;
    position: number;
  },
): Promise<MediaRow> {
  return database.productMedia.create({ data, select: mediaSelect });
}

export function updateMediaRow(
  database: DatabaseClient,
  mediaId: string,
  data: { altText?: string; variantId?: string | null },
): Promise<MediaRow> {
  return database.productMedia.update({ where: { id: mediaId }, data, select: mediaSelect });
}

export async function deleteMediaRow(database: DatabaseClient, mediaId: string): Promise<void> {
  await database.productMedia.delete({ where: { id: mediaId }, select: { id: true } });
}

// Keeps positions 0..n-1 after a delete, so the order never has gaps.
export async function closePositionGap(
  database: DatabaseClient,
  input: { productId: string; deletedPosition: number },
): Promise<void> {
  await database.$executeRaw`
    UPDATE product_media SET position = position - 1, updated_at = now()
    WHERE product_id = ${input.productId}::uuid AND position > ${input.deletedPosition}`;
}

// One statement for the whole new order; the caller holds the product lock.
export async function setMediaPositions(
  database: DatabaseClient,
  input: { productId: string; orderedMediaIds: readonly string[] },
): Promise<void> {
  const orderedMediaIds = [...input.orderedMediaIds];
  await database.$executeRaw`
    UPDATE product_media AS media
    SET position = ordered.ordinality - 1, updated_at = now()
    FROM unnest(${orderedMediaIds}::uuid[]) WITH ORDINALITY AS ordered(id, ordinality)
    WHERE media.id = ordered.id AND media.product_id = ${input.productId}::uuid`;
}

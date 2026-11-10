import { getConfig } from '@/lib/config';
import { foreignKeyViolationConstraintName, getDatabase, isForeignKeyViolation } from '@/lib/db';
import type { DatabaseClient } from '@/lib/db';
import type { AuditData } from '@/modules/audit/audit.types';
import { assertStaffPermission } from '@/modules/identity/access-control';
import { enqueueProductReindex } from '@/modules/search/search-outbox.repository';

import { type CatalogueActor, jsonText, recordCatalogueEvent } from './catalogue-audit';
import {
  CatalogueNotFoundError,
  CatalogueValidationError,
  catalogueConflicts,
  catalogueUnprocessable,
} from './catalogue.errors';
import {
  type AddMediaInput,
  maximumImagesPerProduct,
  type ReorderMediaInput,
  type UpdateMediaInput,
} from './catalogue.schema';
import { allowedImageOrigins, isAllowedImageUrl } from './image-url';
import {
  closePositionGap,
  deleteMediaRow,
  findMedia,
  insertMedia,
  listMedia,
  setMediaPositions,
  updateMediaRow,
} from './media.repository';
import { lockUnarchivedProduct } from './product.service';
import { bumpProductVersion, type MediaRow } from './product.repository';

// Everything needed to know later exactly which image was removed (owner requirement, TD-016).
export function mediaAuditData(media: MediaRow): AuditData {
  return {
    imageId: media.id,
    productId: media.productId,
    variantId: media.variantId,
    url: media.url,
    altText: media.altText,
    position: media.position,
  };
}

function rethrowWrongVariant(error: unknown): never {
  if (
    isForeignKeyViolation(error) &&
    foreignKeyViolationConstraintName(error) === 'product_media_product_id_variant_id_fkey'
  ) {
    throw catalogueUnprocessable.variantNotInProduct();
  }
  throw error;
}

function assertAllowedImageUrl(url: string): void {
  const origins = allowedImageOrigins(getConfig().security.contentSecurityPolicy.imageSources);
  if (!isAllowedImageUrl(url, origins)) {
    throw new CatalogueValidationError({
      url: [`Use an image hosted on: ${origins.join(', ')}`],
    });
  }
}

async function lockMediaForChange(transaction: DatabaseClient, mediaId: string): Promise<MediaRow> {
  const unlocked = await findMedia(transaction, mediaId);
  if (unlocked === null) throw new CatalogueNotFoundError('MEDIA');
  await lockUnarchivedProduct(transaction, unlocked.productId);
  const media = await findMedia(transaction, mediaId);
  if (media === null) throw new CatalogueNotFoundError('MEDIA');
  return media;
}

async function finishMediaChange(
  transaction: DatabaseClient,
  actor: CatalogueActor,
  event: Parameters<typeof recordCatalogueEvent>[2] & { productId: string },
): Promise<number> {
  const productVersion = await bumpProductVersion(transaction, event.productId);
  await recordCatalogueEvent(transaction, actor, event);
  await enqueueProductReindex(transaction, event.productId);
  return productVersion;
}

export async function addMedia(
  actor: CatalogueActor,
  productId: string,
  input: AddMediaInput,
): Promise<{ media: MediaRow; productVersion: number }> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  assertAllowedImageUrl(input.url);
  try {
    return await getDatabase().$transaction(async (transaction) => {
      await lockUnarchivedProduct(transaction, productId);
      const existing = await listMedia(transaction, productId);
      if (existing.length >= maximumImagesPerProduct) {
        throw catalogueConflicts.mediaLimitReached(maximumImagesPerProduct);
      }
      const media = await insertMedia(transaction, {
        productId,
        variantId: input.variantId ?? null,
        url: input.url,
        altText: input.altText,
        position: existing.length,
      });
      const productVersion = await finishMediaChange(transaction, actor, {
        productId,
        action: 'catalogue.media_added',
        entityType: 'product_media',
        entityId: media.id,
        after: mediaAuditData(media),
      });
      return { media, productVersion };
    });
  } catch (error) {
    rethrowWrongVariant(error);
  }
}

export async function updateMedia(
  actor: CatalogueActor,
  mediaId: string,
  input: UpdateMediaInput,
): Promise<{ media: MediaRow; productVersion: number }> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  try {
    return await getDatabase().$transaction(async (transaction) => {
      const before = await lockMediaForChange(transaction, mediaId);
      const media = await updateMediaRow(transaction, mediaId, {
        ...(input.altText === undefined ? {} : { altText: input.altText }),
        ...(input.variantId === undefined ? {} : { variantId: input.variantId }),
      });
      const productVersion = await finishMediaChange(transaction, actor, {
        productId: before.productId,
        action: 'catalogue.media_updated',
        entityType: 'product_media',
        entityId: mediaId,
        before: mediaAuditData(before),
        after: mediaAuditData(media),
      });
      return { media, productVersion };
    });
  } catch (error) {
    rethrowWrongVariant(error);
  }
}

// The client sends the full order it saw; if images were added or removed meanwhile, it is stale.
export async function reorderMedia(
  actor: CatalogueActor,
  productId: string,
  input: ReorderMediaInput,
): Promise<{ media: MediaRow[]; productVersion: number }> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  return await getDatabase().$transaction(async (transaction) => {
    await lockUnarchivedProduct(transaction, productId);
    const before = await listMedia(transaction, productId);
    const currentIds = new Set(before.map(({ id }) => id));
    const sameSet =
      input.mediaIds.length === currentIds.size && input.mediaIds.every((id) => currentIds.has(id));
    if (!sameSet) throw catalogueConflicts.staleMediaOrder();
    await setMediaPositions(transaction, { productId, orderedMediaIds: input.mediaIds });
    const productVersion = await finishMediaChange(transaction, actor, {
      productId,
      action: 'catalogue.media_reordered',
      entityType: 'product',
      entityId: productId,
      before: { order: jsonText(before.map(({ id }) => id)) },
      after: { order: jsonText(input.mediaIds) },
    });
    return { media: await listMedia(transaction, productId), productVersion };
  });
}

// A hard delete (owner-approved): the audit row keeps the full image record, and order lines keep
// their own image_url snapshot, so no history is lost.
export async function deleteMedia(
  actor: CatalogueActor,
  mediaId: string,
): Promise<{ productVersion: number }> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  return await getDatabase().$transaction(async (transaction) => {
    const media = await lockMediaForChange(transaction, mediaId);
    await deleteMediaRow(transaction, mediaId);
    await closePositionGap(transaction, {
      productId: media.productId,
      deletedPosition: media.position,
    });
    const productVersion = await finishMediaChange(transaction, actor, {
      productId: media.productId,
      action: 'catalogue.media_deleted',
      entityType: 'product_media',
      entityId: mediaId,
      before: mediaAuditData(media),
    });
    return { productVersion };
  });
}

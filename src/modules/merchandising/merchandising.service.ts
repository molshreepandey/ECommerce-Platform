import { cacheTags, expireCacheTagsAfterCommit } from '@/lib/cache-tags';
import { getConfig } from '@/lib/config';
import { type DatabaseClient, getDatabase, isUniqueViolation } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { recordAuditEvent } from '@/modules/audit/audit.service';
import type { AuditAction, AuditData } from '@/modules/audit/audit.types';
import { allowedImageOrigins, isAllowedImageUrl } from '@/modules/catalogue/image-url';
import {
  assertStaffPermission,
  type RequestMetadata,
  type StaffContext,
} from '@/modules/identity/access-control';
import { findProductCardsByIds } from '@/modules/search/postgres-product-search.repository';

import type { BannerInput, CollectionInput } from './merchandising.schema';
import { isWithinWindow } from './merchandising.schema';
import {
  countExistingProducts,
  deleteBannerRow,
  findBannerRow,
  findCollectionBySlug,
  findCollectionRow,
  insertBanner,
  insertCollection,
  listBannerRows,
  listCollectionRows,
  lockCollection,
  replaceCollectionProducts,
  updateBannerRow,
  updateCollectionRow,
} from './merchandising.repository';

const notFound = (what: 'COLLECTION' | 'BANNER') =>
  new DomainError({
    kind: 'NOT_FOUND',
    code: `${what}_NOT_FOUND`,
    message: `This ${what.toLowerCase()} was not found.`,
  });

function windowAudit(item: {
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}): AuditData {
  return {
    isActive: item.isActive,
    startsAt: item.startsAt?.toISOString() ?? null,
    endsAt: item.endsAt?.toISOString() ?? null,
  };
}

async function audit(
  database: DatabaseClient,
  staff: StaffContext,
  metadata: RequestMetadata,
  event: {
    action: AuditAction;
    entityType: string;
    entityId: string;
    before?: AuditData;
    after?: AuditData;
  },
) {
  await recordAuditEvent(database, {
    actorType: 'STAFF',
    actorId: staff.staffUserId,
    ...event,
    ipAddress: metadata.clientIp,
    requestId: metadata.requestId,
  });
}

async function afterChange<Result>(change: Promise<Result>): Promise<Result> {
  const result = await change;
  await expireCacheTagsAfterCommit([cacheTags.merchandising]);
  return result;
}

function assertAllowedImage(imageUrl: string): void {
  const origins = allowedImageOrigins(getConfig().security.contentSecurityPolicy.imageSources);
  if (!isAllowedImageUrl(imageUrl, origins)) {
    throw new DomainError({
      kind: 'VALIDATION',
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      details: { fieldErrors: { imageUrl: ['Use an https image from an allowed image host.'] } },
    });
  }
}

function slugTaken(): DomainError {
  return new DomainError({
    kind: 'CONFLICT',
    code: 'COLLECTION_SLUG_TAKEN',
    message: 'A collection with this slug already exists.',
    details: { fieldErrors: { slug: ['A collection with this slug already exists.'] } },
  });
}

// ── Collections (D50, C13) ──

export function listCollections(staff: StaffContext) {
  assertStaffPermission(staff, 'catalogue.read');
  return listCollectionRows(getDatabase());
}

export async function getCollection(staff: StaffContext, collectionId: string) {
  assertStaffPermission(staff, 'catalogue.read');
  const collection = await findCollectionRow(getDatabase(), collectionId);
  if (collection === null) throw notFound('COLLECTION');
  return collection;
}

export async function createCollection(
  staff: StaffContext,
  input: CollectionInput,
  metadata: RequestMetadata,
) {
  assertStaffPermission(staff, 'merchandising.write');
  return afterChange(
    getDatabase()
      .$transaction(async (transaction) => {
        const collection = await insertCollection(transaction, input);
        await audit(transaction, staff, metadata, {
          action: 'merchandising.collection_created',
          entityType: 'collection',
          entityId: collection.id,
          after: { name: collection.name, slug: collection.slug, ...windowAudit(collection) },
        });
        return collection;
      })
      .catch((error: unknown) => {
        throw isUniqueViolation(error) ? slugTaken() : error;
      }),
  );
}

export async function updateCollection(
  staff: StaffContext,
  collectionId: string,
  input: CollectionInput,
  metadata: RequestMetadata,
) {
  assertStaffPermission(staff, 'merchandising.write');
  return afterChange(
    getDatabase()
      .$transaction(async (transaction) => {
        const before = await findCollectionRow(transaction, collectionId);
        if (before === null) throw notFound('COLLECTION');
        const collection = await updateCollectionRow(transaction, collectionId, input);
        await audit(transaction, staff, metadata, {
          action: 'merchandising.collection_updated',
          entityType: 'collection',
          entityId: collectionId,
          before: { name: before.name, slug: before.slug, ...windowAudit(before) },
          after: { name: collection.name, slug: collection.slug, ...windowAudit(collection) },
        });
        return collection;
      })
      .catch((error: unknown) => {
        throw isUniqueViolation(error) ? slugTaken() : error;
      }),
  );
}

// The hand-picked list in display order, replaced as a whole (the editor always sends the full list).
export async function setCollectionProducts(
  staff: StaffContext,
  collectionId: string,
  productIds: readonly string[],
  metadata: RequestMetadata,
) {
  assertStaffPermission(staff, 'merchandising.write');
  return afterChange(
    getDatabase().$transaction(async (transaction) => {
      if (!(await lockCollection(transaction, collectionId))) throw notFound('COLLECTION');
      if ((await countExistingProducts(transaction, productIds)) !== productIds.length) {
        throw new DomainError({
          kind: 'UNPROCESSABLE',
          code: 'PRODUCT_NOT_FOUND',
          message: 'One of the products does not exist.',
        });
      }
      await replaceCollectionProducts(transaction, collectionId, productIds);
      await audit(transaction, staff, metadata, {
        action: 'merchandising.collection_products_changed',
        entityType: 'collection',
        entityId: collectionId,
        after: { productCount: productIds.length },
      });
    }),
  );
}

// The collection page: 404 unless active and inside its window; products that are not sellable are
// left out, the rest keep the hand-picked order.
export async function loadStorefrontCollection(slug: string, now: Date = new Date()) {
  const database = getDatabase();
  const collection = await findCollectionBySlug(database, slug);
  if (collection === null || !isWithinWindow(collection, now)) throw notFound('COLLECTION');
  return {
    name: collection.name,
    slug: collection.slug,
    description: collection.description,
    products: await findProductCardsByIds(
      database,
      collection.products.map(({ productId }) => productId),
    ),
  };
}

// ── Banners (D51, C6) ──

export function listBanners(staff: StaffContext) {
  assertStaffPermission(staff, 'catalogue.read');
  return listBannerRows(getDatabase());
}

export async function createBanner(
  staff: StaffContext,
  input: BannerInput,
  metadata: RequestMetadata,
) {
  assertStaffPermission(staff, 'merchandising.write');
  assertAllowedImage(input.imageUrl);
  return afterChange(
    getDatabase().$transaction(async (transaction) => {
      const banner = await insertBanner(transaction, input);
      await audit(transaction, staff, metadata, {
        action: 'merchandising.banner_created',
        entityType: 'banner',
        entityId: banner.id,
        after: { title: banner.title, linkUrl: banner.linkUrl, ...windowAudit(banner) },
      });
      return banner;
    }),
  );
}

export async function updateBanner(
  staff: StaffContext,
  bannerId: string,
  input: BannerInput,
  metadata: RequestMetadata,
) {
  assertStaffPermission(staff, 'merchandising.write');
  assertAllowedImage(input.imageUrl);
  return afterChange(
    getDatabase().$transaction(async (transaction) => {
      const before = await findBannerRow(transaction, bannerId);
      if (before === null) throw notFound('BANNER');
      const banner = await updateBannerRow(transaction, bannerId, input);
      await audit(transaction, staff, metadata, {
        action: 'merchandising.banner_updated',
        entityType: 'banner',
        entityId: bannerId,
        before: { title: before.title, linkUrl: before.linkUrl, ...windowAudit(before) },
        after: { title: banner.title, linkUrl: banner.linkUrl, ...windowAudit(banner) },
      });
      return banner;
    }),
  );
}

export async function deleteBanner(
  staff: StaffContext,
  bannerId: string,
  metadata: RequestMetadata,
) {
  assertStaffPermission(staff, 'merchandising.write');
  return afterChange(
    getDatabase().$transaction(async (transaction) => {
      const before = await findBannerRow(transaction, bannerId);
      if (before === null) throw notFound('BANNER');
      await deleteBannerRow(transaction, bannerId);
      await audit(transaction, staff, metadata, {
        action: 'merchandising.banner_deleted',
        entityType: 'banner',
        entityId: bannerId,
        before: { title: before.title, linkUrl: before.linkUrl, ...windowAudit(before) },
      });
    }),
  );
}

// Home page data (C6), cached by the caller; the date window is applied again at render time so a cached
// list never shows an expired banner.
export async function loadHomeMerchandising() {
  const database = getDatabase();
  const [banners, collections] = await Promise.all([
    listBannerRows(database),
    listCollectionRows(database),
  ]);
  return {
    banners: banners.filter(({ isActive }) => isActive),
    collections: collections.filter(({ isActive, _count }) => isActive && _count.products > 0),
  };
}

export function visibleNow<
  Item extends { isActive: boolean; startsAt: Date | null; endsAt: Date | null },
>(items: readonly Item[], now: Date): Item[] {
  return items.filter((item) => isWithinWindow(item, now));
}

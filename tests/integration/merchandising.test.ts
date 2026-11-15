import { randomInt, randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { getConfig } from '@/lib/config';
import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { checkPincodeServiceability } from '@/modules/fulfilment/courier-serviceability.service';
import {
  createBanner,
  createCollection,
  loadHomeMerchandising,
  loadStorefrontCollection,
  setCollectionProducts,
  visibleNow,
} from '@/modules/merchandising/merchandising.service';
import { createReview, getProductReviews } from '@/modules/merchandising/review.service';
import { limitPublicSearch } from '@/modules/search/search-rate-limit';
import {
  loadStoreBranding,
  updateStoreBranding,
} from '@/modules/merchandising/store-branding.service';
import { confirmOrder } from '@/modules/ordering/order-lifecycle.service';
import { createShipmentAwb, runShipmentAction } from '@/modules/ordering/shipment-actions.service';

import {
  checkoutWith,
  createCourier,
  createShopper,
  orderStaff,
  stockedVariant,
} from './support/commerce-fixtures';
import { testMetadata } from './support/identity-fixtures';
import { createVariantRow } from './support/inventory-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();
const hour = 3_600_000;

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error instanceof DomainError ? `${String(error.httpStatus)} ${error.code}` : String(error);
}

async function deliveredLine() {
  const staff = await orderStaff();
  const variant = await stockedVariant([{ priority: 1, onHandQuantity: 5 }]);
  const { customer, addressId } = await createShopper();
  const placed = await checkoutWith({
    customer,
    addressId,
    lines: [{ variantId: variant.variantId, quantity: 1 }],
  });
  const order = await database.order.findUniqueOrThrow({
    where: { id: placed.orderId },
    select: { items: { select: { id: true } }, shipments: { select: { id: true } } },
  });
  const orderItemId = order.items[0]?.id ?? '';
  const shipmentId = order.shipments[0]?.id ?? '';
  return {
    customer,
    variant,
    orderItemId,
    async deliver() {
      await confirmOrder(staff, placed.orderId, testMetadata());
      await runShipmentAction(staff, shipmentId, 'pack', null, testMetadata());
      await createShipmentAwb(staff, shipmentId, testMetadata());
      for (const action of ['ship', 'out-for-delivery', 'deliver'] as const) {
        await runShipmentAction(staff, shipmentId, action, null, testMetadata());
      }
    },
  };
}

beforeEach(async () => {
  await truncateAllTestTables();
  await createCourier({ pincodes: ['411001', '799001'] });
});

describe('verified-buyer reviews (C21)', () => {
  it('refuses a review before delivery (403), accepts it after, refuses a second one (409)', async () => {
    const line = await deliveredLine();
    const review = { orderItemId: line.orderItemId, rating: 4, title: 'Good', body: 'Fits well' };
    expect(await failure(createReview(line.customer, review))).toBe('403 REVIEW_NOT_ALLOWED');
    await line.deliver();
    await createReview(line.customer, review);
    expect(await failure(createReview(line.customer, { ...review, rating: 5 }))).toBe(
      '409 REVIEW_EXISTS',
    );
    const reviews = await getProductReviews(line.variant.productId);
    expect(reviews).toMatchObject({ averageRating: 4, reviewCount: 1 });
    expect(reviews.reviews[0]).toMatchObject({ rating: 4, authorName: 'Asha' });
    expect(
      await database.searchOutbox.count({ where: { entityId: line.variant.productId } }),
    ).toBeGreaterThan(0);
  });

  it('refuses a review of someone else’s delivered item (403)', async () => {
    const line = await deliveredLine();
    await line.deliver();
    const stranger = await createShopper();
    expect(
      await failure(
        createReview(stranger.customer, {
          orderItemId: line.orderItemId,
          rating: 5,
          title: '',
          body: '',
        }),
      ),
    ).toBe('403 REVIEW_NOT_ALLOWED');
  });

  it('limits review attempts per customer (L5), before any other check', async () => {
    const { maxRequests } = getConfig().rateLimits['review-write'];
    const { customer } = await createShopper();
    const attempt = { orderItemId: randomUUID(), rating: 5, title: '', body: '' };
    for (let index = 0; index < maxRequests; index += 1) {
      expect(await failure(createReview(customer, attempt))).toBe('403 REVIEW_NOT_ALLOWED');
    }
    expect(await failure(createReview(customer, attempt))).toBe('429 RATE_LIMITED');
  });
});

describe('public search rate limit (L5)', () => {
  it('limits per known client IP; an unknown IP is never put in one shared bucket', async () => {
    const { maxRequests } = getConfig().rateLimits['public-search'];
    const clientIp = `198.18.${String(randomInt(250))}.${String(randomInt(250))}`;
    for (let index = 0; index < maxRequests; index += 1) {
      await limitPublicSearch({ requestId: 'search', clientIp });
    }
    expect(await failure(limitPublicSearch({ requestId: 'search', clientIp }))).toBe(
      '429 RATE_LIMITED',
    );
    for (let index = 0; index < maxRequests + 5; index += 1) {
      await limitPublicSearch({ requestId: 'search', clientIp: null });
    }
  });
});

describe('pincode check (C19)', () => {
  it('reports serviceability, delivery days and Cash on Delivery', async () => {
    await createCourier({ pincodes: ['560001'], codAvailable: false, priority: 2 });
    expect(await checkPincodeServiceability(database, '411001')).toEqual({
      pincode: '411001',
      isServiceable: true,
      estimatedDeliveryDays: 3,
      isCashOnDeliveryAvailable: true,
    });
    expect(await checkPincodeServiceability(database, '560001')).toMatchObject({
      isServiceable: true,
      isCashOnDeliveryAvailable: false,
    });
    expect(await checkPincodeServiceability(database, '999999')).toMatchObject({
      isServiceable: false,
      estimatedDeliveryDays: null,
    });
  });
});

describe('banners and collections (C6, C13, D50, D51)', () => {
  it('hides an expired or future banner and shows the live one', async () => {
    const staff = await orderStaff(['catalogue.read', 'merchandising.write']);
    const now = new Date();
    const base = {
      imageUrl: 'https://picsum.photos/seed/b/1600/500',
      linkUrl: '/search',
      isActive: true,
    };
    await createBanner(
      staff,
      {
        ...base,
        title: 'Live',
        position: 1,
        startsAt: new Date(now.getTime() - hour),
        endsAt: new Date(now.getTime() + hour),
      },
      testMetadata(),
    );
    await createBanner(
      staff,
      {
        ...base,
        title: 'Expired',
        position: 2,
        startsAt: null,
        endsAt: new Date(now.getTime() - 1),
      },
      testMetadata(),
    );
    await createBanner(
      staff,
      {
        ...base,
        title: 'Future',
        position: 3,
        startsAt: new Date(now.getTime() + hour),
        endsAt: null,
      },
      testMetadata(),
    );
    const { banners } = await loadHomeMerchandising();
    expect(visibleNow(banners, now).map(({ title }) => title)).toEqual(['Live']);
  });

  it('refuses a banner image from a host the CSP does not allow (400)', async () => {
    const staff = await orderStaff(['merchandising.write']);
    expect(
      await failure(
        createBanner(
          staff,
          {
            title: 'Bad',
            imageUrl: 'https://evil.example/x.png',
            linkUrl: '/',
            position: 0,
            isActive: true,
            startsAt: null,
            endsAt: null,
          },
          testMetadata(),
        ),
      ),
    ).toBe('400 VALIDATION_FAILED');
  });

  it('shows a live collection in hand-picked order without unsellable products; others are 404', async () => {
    const staff = await orderStaff(['catalogue.read', 'merchandising.write']);
    const first = await createVariantRow();
    const second = await createVariantRow();
    const archived = await createVariantRow({ productStatus: 'ARCHIVED' });
    const collection = await createCollection(
      staff,
      {
        name: 'Festive',
        slug: 'festive',
        description: '',
        isActive: true,
        startsAt: null,
        endsAt: null,
      },
      testMetadata(),
    );
    await setCollectionProducts(
      staff,
      collection.id,
      [second.productId, archived.productId, first.productId],
      testMetadata(),
    );
    const page = await loadStorefrontCollection('festive');
    expect(page.products.map(({ productId }) => productId)).toEqual([
      second.productId,
      first.productId,
    ]);
    expect(await failure(loadStorefrontCollection('missing'))).toBe('404 COLLECTION_NOT_FOUND');
    await database.collection.update({
      where: { id: collection.id },
      data: { endsAt: new Date(Date.now() - 1) },
    });
    expect(await failure(loadStorefrontCollection('festive'))).toBe('404 COLLECTION_NOT_FOUND');
    expect(
      await failure(
        createCollection(
          staff,
          {
            name: 'Again',
            slug: 'festive',
            description: '',
            isActive: true,
            startsAt: null,
            endsAt: null,
          },
          testMetadata(),
        ),
      ),
    ).toBe('409 COLLECTION_SLUG_TAKEN');
  });

  it('needs merchandising.write (403)', async () => {
    const support = await orderStaff(['catalogue.read']);
    expect(
      await failure(
        createCollection(
          support,
          { name: 'X', slug: 'x-x', description: '', isActive: true, startsAt: null, endsAt: null },
          testMetadata(),
        ),
      ),
    ).toBe('403 PERMISSION_DENIED');
  });
});

describe('store branding (D52)', () => {
  it('saves name, logo and colour with an audit row, and refuses a logo from another host', async () => {
    const staff = await orderStaff(['merchandising.write']);
    expect(await loadStoreBranding()).toEqual({
      storeName: 'ShopSphere',
      logoUrl: null,
      primaryColour: null,
    });
    await updateStoreBranding(
      staff,
      {
        storeName: 'Kurta House',
        logoUrl: 'https://picsum.photos/seed/logo/64/64',
        primaryColour: '#aa3300',
      },
      testMetadata(),
    );
    expect(await loadStoreBranding()).toEqual({
      storeName: 'Kurta House',
      logoUrl: 'https://picsum.photos/seed/logo/64/64',
      primaryColour: '#aa3300',
    });
    expect(
      await database.auditLog.count({ where: { action: 'merchandising.branding_updated' } }),
    ).toBe(1);
    expect(
      await failure(
        updateStoreBranding(
          staff,
          { storeName: 'X store', logoUrl: 'https://evil.example/logo.png', primaryColour: null },
          testMetadata(),
        ),
      ),
    ).toBe('400 VALIDATION_FAILED');
  });
});

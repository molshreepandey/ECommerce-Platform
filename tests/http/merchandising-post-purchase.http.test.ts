import { randomInt, randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { callApi, getPage, sessionCookieFrom, storeHost, visibleMarkup } from './app-server';
import { errorCode, idSchema, staffCookie } from './support/catalogue-api';
import {
  createSellableVariant,
  createWarehouse,
  orderBody,
  placedBody,
  placeOrder,
  receiveStock,
  registeredShopper,
  type SellableVariant,
  type Shopper,
} from './support/commerce-api';

const runId = `${String(Date.now())}${String(randomInt(1000))}`;
const pincode = '411001';
let catalogueManager = '';
let inventoryManager = '';
let orderOps = '';
let support = '';
let sellable: SellableVariant;

const storeOrderBody = z.object({
  order: z.object({ items: z.array(z.object({ id: z.uuid() })) }),
});

function shopper(): Promise<Shopper> {
  return registeredShopper(runId, pincode);
}

async function placedOrder(customer: Shopper) {
  const response = await placeOrder(customer, sellable.variantId, 'COD');
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const placed = placedBody.parse(response.body).order;
  const detail = await callApi('get', 'admin', `/api/admin/orders/${placed.orderId}`, {
    cookie: orderOps,
  });
  const shipmentId = orderBody.parse(detail.body).order.shipments[0]?.id ?? '';
  const order = await callApi('get', 'store', `/api/store/orders/${placed.orderId}`, {
    cookie: customer.cookie,
  });
  const orderItemId = storeOrderBody.parse(order.body).order.items[0]?.id ?? '';
  return { ...placed, shipmentId, orderItemId };
}

async function adminPost(path: string, body: object = {}, cookie = orderOps) {
  return callApi('post', 'admin', path, { cookie, body });
}

// Confirm → pack → AWB → three simulated scans (shipped, out for delivery, delivered).
async function deliveredOrder(customer: Shopper) {
  const order = await placedOrder(customer);
  expect((await adminPost(`/api/admin/orders/${order.orderId}/confirm`)).status).toBe(204);
  for (const action of ['pack', 'create-awb']) {
    const response = await adminPost(`/api/admin/shipments/${order.shipmentId}/${action}`);
    expect(response.status, `${action} ${JSON.stringify(response.body)}`).toBe(204);
  }
  for (let scan = 0; scan < 3; scan += 1) {
    const response = await adminPost(`/api/admin/shipments/${order.shipmentId}/simulate-scan`, {
      outcome: 'DELIVERED',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  }
  return order;
}

function isoInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

beforeAll(async () => {
  let superAdmin = '';
  [catalogueManager, inventoryManager, superAdmin, orderOps, support] = await Promise.all([
    staffCookie('catalogue.manager@demo-store.test'),
    staffCookie('inventory.manager@demo-store.test'),
    staffCookie('super.admin@demo-store.test'),
    staffCookie('order.ops@demo-store.test'),
    staffCookie('support@demo-store.test'),
  ]);
  sellable = await createSellableVariant({
    runId: `m${runId}`,
    pincode,
    catalogueManager,
    inventoryManager,
    superAdmin,
  });
});

describe('Wave 11 over HTTP: merchandising and discovery', () => {
  it('pincode check (C19): serviceable with delivery days and COD; unserviceable; malformed is 400', async () => {
    const served = await callApi('get', 'store', `/api/store/serviceability?pincode=${pincode}`);
    expect(served.status).toBe(200);
    expect(served.body).toMatchObject({
      serviceability: { pincode, isServiceable: true, isCashOnDeliveryAvailable: true },
    });
    const unserved = await callApi('get', 'store', '/api/store/serviceability?pincode=190001');
    expect(unserved.body).toMatchObject({
      serviceability: { isServiceable: false, estimatedDeliveryDays: null },
    });
    const malformed = await callApi('get', 'store', '/api/store/serviceability?pincode=12');
    expect(malformed.status).toBe(400);
  });

  it('banners (D51, C6): merchandising.write only; the live banner is on the home page, an expired one is not', async () => {
    const banner = (title: string, startsAt: string | null, endsAt: string | null) => ({
      title,
      imageUrl: 'https://picsum.photos/seed/http-banner/1200/400',
      linkUrl: '/search?q=kurta',
      position: 0,
      isActive: true,
      startsAt,
      endsAt,
    });
    const liveTitle = `Live banner ${runId}`;
    const expiredTitle = `Expired banner ${runId}`;
    const refused = await callApi('post', 'admin', '/api/admin/banners', {
      cookie: support,
      body: banner(liveTitle, null, null),
    });
    expect(refused.status).toBe(403);
    const offSite = await callApi('post', 'admin', '/api/admin/banners', {
      cookie: catalogueManager,
      body: { ...banner(liveTitle, null, null), linkUrl: 'https://evil.example/' },
    });
    expect(offSite.status).toBe(400);
    const bannerIds: string[] = [];
    try {
      for (const body of [
        banner(liveTitle, isoInDays(-1), isoInDays(1)),
        banner(expiredTitle, isoInDays(-3), isoInDays(-1)),
      ]) {
        const created = await callApi('post', 'admin', '/api/admin/banners', {
          cookie: catalogueManager,
          body,
        });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        bannerIds.push(z.object({ banner: idSchema }).parse(created.body).banner.id);
      }
      const home = visibleMarkup((await getPage(storeHost, '/')).text);
      expect(home).toContain(liveTitle);
      expect(home).not.toContain(expiredTitle);
    } finally {
      // Banners are shared home-page state; leave none behind for other test files.
      for (const bannerId of bannerIds) {
        const deleted = await callApi('delete', 'admin', `/api/admin/banners/${bannerId}`, {
          cookie: catalogueManager,
        });
        expect(deleted.status).toBe(204);
      }
    }
  });

  it('collections (D50, C13): hand-picked products on the store; an inactive collection is 404', async () => {
    const slug = `edit-${runId}`;
    const created = await callApi('post', 'admin', '/api/admin/collections', {
      cookie: catalogueManager,
      body: {
        name: `Edit ${runId}`,
        slug,
        description: 'Hand-picked',
        isActive: true,
        startsAt: null,
        endsAt: null,
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const collectionId = z.object({ collection: idSchema }).parse(created.body).collection.id;
    const picked = await callApi(
      'put',
      'admin',
      `/api/admin/collections/${collectionId}/products`,
      { cookie: catalogueManager, body: { productIds: [sellable.productId] } },
    );
    expect(picked.status, JSON.stringify(picked.body)).toBe(204);
    const api = await callApi('get', 'store', `/api/store/collections/${slug}`);
    expect(api.status).toBe(200);
    expect(api.body).toMatchObject({
      collection: { slug, products: [{ slug: sellable.productSlug }] },
    });
    const page = await getPage(storeHost, `/collections/${slug}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain(`/products/${sellable.productSlug}`);

    const hiddenSlug = `hidden-${runId}`;
    const hidden = await callApi('post', 'admin', '/api/admin/collections', {
      cookie: catalogueManager,
      body: { name: 'Hidden', slug: hiddenSlug, isActive: false, startsAt: null, endsAt: null },
    });
    expect(hidden.status).toBe(201);
    const missing = await callApi('get', 'store', `/api/store/collections/${hiddenSlug}`);
    expect(missing.status).toBe(404);
    expect(errorCode(missing.body)).toBe('COLLECTION_NOT_FOUND');
    expect((await getPage(storeHost, `/collections/${hiddenSlug}`)).status).toBe(404);
  });

  it('store branding (D52): name and colour reach the storefront; SUPPORT is refused (403)', async () => {
    const brandingBody = z.object({
      branding: z.object({
        storeName: z.string(),
        logoUrl: z.string().nullable(),
        primaryColour: z.string().nullable(),
      }),
    });
    const before = brandingBody.parse(
      (await callApi('get', 'admin', '/api/admin/branding', { cookie: catalogueManager })).body,
    ).branding;
    const storeName = `Http Store ${runId}`.slice(0, 60);
    try {
      const saved = await callApi('put', 'admin', '/api/admin/branding', {
        cookie: catalogueManager,
        body: { storeName, logoUrl: null, primaryColour: '#AA3366' },
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect(saved.body).toMatchObject({ branding: { primaryColour: '#aa3366' } });
      const home = (await getPage(storeHost, '/')).text;
      expect(home).toContain(storeName);
      expect(home).toContain('--color-primary:#aa3366');
      const refused = await callApi('put', 'admin', '/api/admin/branding', {
        cookie: support,
        body: { storeName: 'Nope', logoUrl: null, primaryColour: null },
      });
      expect(refused.status).toBe(403);
      const injected = await callApi('put', 'admin', '/api/admin/branding', {
        cookie: catalogueManager,
        body: { storeName, logoUrl: null, primaryColour: 'red;}body{display:none' },
      });
      expect(injected.status).toBe(400);
    } finally {
      await callApi('put', 'admin', '/api/admin/branding', {
        cookie: catalogueManager,
        body: before,
      });
    }
  });

  it('reviews (C21): 403 before delivery, 201 after, 409 for a second one; shown on the product', async () => {
    const customer = await shopper();
    const pending = await placedOrder(customer);
    const early = await callApi('post', 'store', '/api/store/reviews', {
      cookie: customer.cookie,
      body: { orderItemId: pending.orderItemId, rating: 5 },
    });
    expect(early.status).toBe(403);
    expect(errorCode(early.body)).toBe('REVIEW_NOT_ALLOWED');

    const delivered = await deliveredOrder(customer);
    const review = { orderItemId: delivered.orderItemId, rating: 4, title: 'Good fit', body: '' };
    const anonymous = await callApi('post', 'store', '/api/store/reviews', { body: review });
    expect(anonymous.status).toBe(401);
    const stranger = await shopper();
    const notTheirs = await callApi('post', 'store', '/api/store/reviews', {
      cookie: stranger.cookie,
      body: review,
    });
    expect(notTheirs.status).toBe(403);
    const created = await callApi('post', 'store', '/api/store/reviews', {
      cookie: customer.cookie,
      body: review,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const second = await callApi('post', 'store', '/api/store/reviews', {
      cookie: customer.cookie,
      body: { ...review, rating: 1 },
    });
    expect(second.status).toBe(409);
    expect(errorCode(second.body)).toBe('REVIEW_EXISTS');
    const listed = await callApi(
      'get',
      'store',
      `/api/store/products/${sellable.productSlug}/reviews`,
    );
    expect(listed.body).toMatchObject({
      averageRating: 4,
      reviewCount: 1,
      reviews: [{ rating: 4, title: 'Good fit', authorName: 'Http' }],
    });
  });
});

describe('Wave 12 over HTTP: post-purchase and operations', () => {
  it('OTP login (C3): code shown in the demo, resend cooldown, wrong code, single use, other origin refused', async () => {
    const customer = await shopper();
    const crossSite = await callApi('post', 'store', '/api/store/auth/otp/request', {
      body: { phone: customer.phone },
      origin: 'https://evil.example',
    });
    expect(crossSite.status).toBe(403);
    const requested = await callApi('post', 'store', '/api/store/auth/otp/request', {
      body: { phone: customer.phone },
    });
    expect(requested.status, JSON.stringify(requested.body)).toBe(200);
    const code = z
      .object({ otp: z.object({ displayedOtpCode: z.string().regex(/^\d{6}$/) }) })
      .parse(requested.body).otp.displayedOtpCode;
    const again = await callApi('post', 'store', '/api/store/auth/otp/request', {
      body: { phone: customer.phone },
    });
    expect(again.status).toBe(429);
    expect(errorCode(again.body)).toBe('OTP_RESEND_COOLDOWN');
    const unknown = await callApi('post', 'store', '/api/store/auth/otp/request', {
      body: { phone: `8${String(randomInt(100_000_000, 999_999_999))}` },
    });
    expect(unknown.status).toBe(200);
    expect(unknown.body).not.toHaveProperty('otp.displayedOtpCode');

    const wrong = await callApi('post', 'store', '/api/store/auth/otp/verify', {
      body: { phone: customer.phone, code: code === '000000' ? '111111' : '000000' },
    });
    expect(wrong.status).toBe(401);
    expect(errorCode(wrong.body)).toBe('OTP_INVALID');
    const verified = await callApi('post', 'store', '/api/store/auth/otp/verify', {
      body: { phone: customer.phone, code },
    });
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    const session = sessionCookieFrom(verified.headers['set-cookie'], 'store_session');
    expect((await callApi('get', 'store', '/api/store/orders', { cookie: session })).status).toBe(
      200,
    );
    const reused = await callApi('post', 'store', '/api/store/auth/otp/verify', {
      body: { phone: customer.phone, code },
    });
    expect(reused.status).toBe(401);
  });

  it('returns (C37, D43): window rules, staff steps with permissions, restock and a capped manual refund', async () => {
    const customer = await shopper();
    const undelivered = await placedOrder(customer);
    const tooEarly = await callApi(
      'post',
      'store',
      `/api/store/orders/${undelivered.orderId}/returns`,
      {
        cookie: customer.cookie,
        body: {
          requestType: 'RETURN',
          reason: 'Does not fit',
          items: [{ orderItemId: undelivered.orderItemId, quantity: 1 }],
        },
      },
    );
    expect(tooEarly.status).toBe(422);
    expect(errorCode(tooEarly.body)).toBe('RETURN_NOT_DELIVERED');

    const order = await deliveredOrder(customer);
    const overview = await callApi('get', 'store', `/api/store/orders/${order.orderId}/returns`, {
      cookie: customer.cookie,
    });
    expect(overview.body).toMatchObject({ lines: [{ returnableQuantity: 1 }], requests: [] });
    const request = (quantity: number) =>
      callApi('post', 'store', `/api/store/orders/${order.orderId}/returns`, {
        cookie: customer.cookie,
        body: {
          requestType: 'RETURN',
          reason: 'Does not fit',
          items: [{ orderItemId: order.orderItemId, quantity }],
        },
      });
    const tooMany = await request(2);
    expect(tooMany.status).toBe(422);
    expect(errorCode(tooMany.body)).toBe('RETURN_QUANTITY_EXCEEDED');
    const created = await request(1);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const returnRequest = z
      .object({ returnRequest: z.object({ id: z.uuid(), returnNumber: z.string() }) })
      .parse(created.body).returnRequest;
    const step = (action: string, body: object = {}, cookie = orderOps) =>
      adminPost(`/api/admin/returns/${returnRequest.id}/${action}`, body, cookie);

    expect((await step('pick-up')).status).toBe(409);
    expect(
      (
        await step(
          'decide',
          { decision: 'APPROVE', receivingWarehouseId: sellable.warehouseId },
          support,
        )
      ).status,
    ).toBe(403);
    expect(
      (await step('decide', { decision: 'APPROVE', receivingWarehouseId: sellable.warehouseId }))
        .status,
    ).toBe(204);
    for (const action of ['pick-up', 'receive', 'restock']) {
      const response = await step(action);
      expect(response.status, `${action} ${JSON.stringify(response.body)}`).toBe(204);
    }
    const tooLarge = await step('refund', {
      refundMethod: 'UPI',
      reference: `UTR${runId}`,
      amountPaise: 79_901,
    });
    expect(tooLarge.status).toBe(422);
    expect(errorCode(tooLarge.body)).toBe('REFUND_TOO_LARGE');
    expect(
      (await step('refund', { refundMethod: 'UPI', reference: `UTR${runId}`, amountPaise: 79_900 }))
        .status,
    ).toBe(204);
    expect((await step('exchange')).status).toBe(409);
    const queue = await callApi('get', 'admin', '/api/admin/returns?status=REFUNDED', {
      cookie: support,
    });
    expect(queue.status).toBe(200);
    expect(
      z
        .object({ returns: z.array(z.object({ returnNumber: z.string(), status: z.string() })) })
        .parse(queue.body)
        .returns.find(({ returnNumber }) => returnNumber === returnRequest.returnNumber),
    ).toMatchObject({ status: 'REFUNDED' });
  });

  it('documents (C36, D35, D39): invoice, packing slip, label and the day manifest; owners and permissions only', async () => {
    const customer = await shopper();
    const order = await deliveredOrder(customer);
    const invoice = await callApi('get', 'store', `/api/store/orders/${order.orderId}/invoice`, {
      cookie: customer.cookie,
    });
    expect(invoice.status).toBe(200);
    expect(invoice.headers['content-type']).toBe('application/pdf');
    expect(invoice.headers['cache-control']).toBe('private, no-store');
    const stranger = await shopper();
    expect(
      (
        await callApi('get', 'store', `/api/store/orders/${order.orderId}/invoice`, {
          cookie: stranger.cookie,
        })
      ).status,
    ).toBe(404);
    for (const path of [
      `/api/admin/orders/${order.orderId}/invoice`,
      `/api/admin/shipments/${order.shipmentId}/packing-slip`,
      `/api/admin/shipments/${order.shipmentId}/label`,
    ]) {
      const response = await callApi('get', 'admin', path, { cookie: support });
      expect(response.status, path).toBe(200);
      expect(response.headers['content-type']).toBe('application/pdf');
    }
    const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const manifest = await callApi(
      'get',
      'admin',
      `/api/admin/manifests?warehouseId=${sellable.warehouseId}&date=${today}`,
      { cookie: support },
    );
    expect(manifest.status).toBe(200);
    expect(
      z
        .object({ manifest: z.object({ shipments: z.array(z.object({ shipmentId: z.uuid() })) }) })
        .parse(manifest.body)
        .manifest.shipments.map(({ shipmentId }) => shipmentId),
    ).toContain(order.shipmentId);
    const pdf = await callApi(
      'get',
      'admin',
      `/api/admin/manifests/pdf?warehouseId=${sellable.warehouseId}&date=${today}`,
      { cookie: support },
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const badDate = await callApi(
      'get',
      'admin',
      `/api/admin/manifests?warehouseId=${sellable.warehouseId}&date=14-11-2026`,
      { cookie: support },
    );
    expect(badDate.status).toBe(400);
    const asCustomer = await callApi('get', 'admin', `/api/admin/orders/${order.orderId}/invoice`, {
      cookie: `admin_session=${customer.cookie.split('=')[1] ?? ''}`,
    });
    expect([401, 403]).toContain(asCustomer.status);
  });

  it('re-allocation (D34): 409 without stock and nothing changes; with stock the reservation moves', async () => {
    const order = await placedOrder(await shopper());
    const target = await createWarehouse(inventoryManager, `R${runId}`, 9);
    const path = `/api/admin/shipments/${order.shipmentId}/reallocate`;
    expect((await adminPost(path, { warehouseId: target }, support)).status).toBe(403);
    const missing = await adminPost(path, {});
    expect(missing.status).toBe(400);
    expect(errorCode(missing.body)).toBe('WAREHOUSE_REQUIRED');
    const empty = await adminPost(path, { warehouseId: target });
    expect(empty.status).toBe(409);
    expect(errorCode(empty.body)).toBe('OUT_OF_STOCK');
    let detail = orderBody.parse(
      (await callApi('get', 'admin', `/api/admin/orders/${order.orderId}`, { cookie: orderOps }))
        .body,
    ).order;
    expect(detail.shipments.map(({ status }) => status)).toEqual(['PENDING']);

    await receiveStock(inventoryManager, {
      warehouseId: target,
      variantId: sellable.variantId,
      quantity: 2,
      reference: `RE-${runId}`,
    });
    const moved = await adminPost(path, { warehouseId: target });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const newShipmentId = z.object({ shipmentId: z.uuid() }).parse(moved.body).shipmentId;
    detail = orderBody.parse(
      (await callApi('get', 'admin', `/api/admin/orders/${order.orderId}`, { cookie: orderOps }))
        .body,
    ).order;
    expect(Object.fromEntries(detail.shipments.map(({ id, status }) => [id, status]))).toEqual({
      [order.shipmentId]: 'CANCELLED',
      [newShipmentId]: 'PENDING',
    });
    expect((await adminPost(path, { warehouseId: sellable.warehouseId })).status).toBe(409);
  });

  it('bulk actions (D38): one result per order, partial success reported, permission enforced', async () => {
    const first = await placedOrder(await shopper());
    const second = await placedOrder(await shopper());
    const missing = randomUUID();
    const body = { action: 'confirm', orderIds: [first.orderId, second.orderId, missing] };
    expect((await adminPost('/api/admin/orders/bulk', body, support)).status).toBe(403);
    const resultBody = z.object({
      results: z.array(
        z.object({ orderId: z.string(), isSuccess: z.boolean(), code: z.string().nullable() }),
      ),
      succeeded: z.number(),
      failed: z.number(),
    });
    const confirmed = resultBody.parse((await adminPost('/api/admin/orders/bulk', body)).body);
    expect(confirmed.results.map(({ isSuccess, code }) => [isSuccess, code])).toEqual([
      [true, null],
      [true, null],
      [false, 'ORDER_NOT_FOUND'],
    ]);
    expect([confirmed.succeeded, confirmed.failed]).toEqual([2, 1]);
    const repeated = resultBody.parse((await adminPost('/api/admin/orders/bulk', body)).body);
    expect(repeated.results.map(({ code }) => code)).toEqual([
      'INVALID_TRANSITION',
      'INVALID_TRANSITION',
      'ORDER_NOT_FOUND',
    ]);
    const packed = resultBody.parse(
      (
        await adminPost('/api/admin/orders/bulk', {
          action: 'pack',
          orderIds: [first.orderId, second.orderId],
        })
      ).body,
    );
    expect(packed.succeeded).toBe(2);
    const duplicate = await adminPost('/api/admin/orders/bulk', {
      action: 'confirm',
      orderIds: [first.orderId, first.orderId],
    });
    expect(duplicate.status).toBe(400);
  });
});

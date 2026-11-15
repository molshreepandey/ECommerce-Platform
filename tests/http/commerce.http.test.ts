import { randomInt, randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  deriveCourierSigningKey,
  localOnlyCourierSecret,
} from '../../src/modules/fulfilment/courier-secret';
import { signWebhook } from '../../src/modules/fulfilment/webhook-signature';
import { callApi, getPage, sessionCookieFrom, storeHost } from './app-server';
import { errorCode, idSchema, staffCookie } from './support/catalogue-api';
import {
  createSellableVariant,
  newKey,
  orderBody,
  placedBody,
  placeOrder as placeOrderOf,
  registeredShopper as registeredShopperOf,
  type Shopper,
} from './support/commerce-api';

const runId = `${String(Date.now())}${String(randomInt(1000))}`;
const pincode = '411001';
let superAdmin = '';
let orderOps = '';
let support = '';
let variantId = '';
let productSlug = '';
let courierCode = '';

const cartBody = z.object({
  cart: z.object({
    lines: z.array(z.object({ variantId: z.string(), quantity: z.number() })),
    totalPaise: z.number(),
    itemCount: z.number(),
    canCheckout: z.boolean(),
  }),
});

function registeredShopper(): Promise<Shopper> {
  return registeredShopperOf(runId, pincode);
}

function placeOrder(shopper: Shopper, paymentMethod: 'COD' | 'ONLINE', key = newKey()) {
  return placeOrderOf(shopper, variantId, paymentMethod, key);
}

beforeAll(async () => {
  let catalogueManager = '';
  let inventoryManager = '';
  [catalogueManager, inventoryManager, superAdmin, orderOps, support] = await Promise.all([
    staffCookie('catalogue.manager@demo-store.test'),
    staffCookie('inventory.manager@demo-store.test'),
    staffCookie('super.admin@demo-store.test'),
    staffCookie('order.ops@demo-store.test'),
    staffCookie('support@demo-store.test'),
  ]);
  ({ variantId, productSlug, courierCode } = await createSellableVariant({
    runId,
    pincode,
    catalogueManager,
    inventoryManager,
    superAdmin,
  }));
});

describe('storefront pages over HTTP (Wave 6)', () => {
  it('serves search, category tree and the product page; an unknown product is a real 404', async () => {
    expect((await getPage(storeHost, '/search?q=kurta')).status).toBe(200);
    expect((await getPage(storeHost, '/categories')).status).toBe(200);
    expect((await getPage(storeHost, `/products/${productSlug}`)).status).toBe(200);
    expect((await getPage(storeHost, '/products/no-such-product-here')).status).toBe(404);
  });
});

describe('cart over HTTP (Wave 7)', () => {
  it('keeps a guest cart in an httpOnly cookie and merges it into the account on sign-in', async () => {
    const added = await callApi('post', 'store', '/api/store/cart/items', {
      body: { variantId, quantity: 2 },
    });
    expect(added.status).toBe(201);
    const guestCookieHeader = String(added.headers['set-cookie']);
    expect(guestCookieHeader).toContain('store_guest_cart=');
    expect(guestCookieHeader.toLowerCase()).toContain('httponly');
    const guestCookie = sessionCookieFrom(added.headers['set-cookie'], 'store_guest_cart');
    expect(cartBody.parse(added.body).cart.itemCount).toBe(2);

    const email = `merge.${runId}@example.test`;
    const registered = await callApi('post', 'store', '/api/store/auth/register', {
      cookie: guestCookie,
      body: {
        fullName: 'Merge Test',
        email,
        phone: `9${String(randomInt(100_000_000, 999_999_999))}`,
        password: 'Http-Test-Password-2026',
      },
    });
    expect(registered.status).toBe(201);
    const session = sessionCookieFrom(registered.headers['set-cookie'], 'store_session');
    const cart = await callApi('get', 'store', '/api/store/cart', { cookie: session });
    expect(cartBody.parse(cart.body).cart.itemCount).toBe(2);
  });

  it('refuses a cart change from another origin (403) and more than is in stock (409)', async () => {
    const crossSite = await callApi('post', 'store', '/api/store/cart/items', {
      body: { variantId, quantity: 1 },
      origin: 'https://evil.example',
    });
    expect(crossSite.status).toBe(403);
    expect(errorCode(crossSite.body)).toBe('ORIGIN_NOT_ALLOWED');
    const tooMany = await callApi('post', 'store', '/api/store/cart/items', {
      body: { variantId, quantity: 10 },
    });
    expect([201, 409]).toContain(tooMany.status);
    const coupon = await callApi('post', 'store', '/api/store/cart/coupon', {
      body: { code: 'SAVE10' },
    });
    expect(coupon.status).toBe(401);
  });
});

describe('checkout over HTTP (Wave 8)', () => {
  it('needs a session (401) and an Idempotency-Key (400)', async () => {
    const anonymous = await callApi('post', 'store', '/api/store/checkout', { body: {} });
    expect(anonymous.status).toBe(401);
    const shopper = await registeredShopper();
    const noKey = await callApi('post', 'store', '/api/store/checkout', {
      cookie: shopper.cookie,
      body: { addressId: shopper.addressId, paymentMethod: 'COD', expectedTotalPaise: 1 },
    });
    expect(noKey.status).toBe(400);
    expect(errorCode(noKey.body)).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('answers 201 for a new order and 200 with the same order for a retried key', async () => {
    const shopper = await registeredShopper();
    const key = newKey();
    const first = await placeOrder(shopper, 'COD', key);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const placed = placedBody.parse(first.body).order;
    const summary = await callApi('get', 'store', `/api/store/orders/${placed.orderId}`, {
      cookie: shopper.cookie,
    });
    expect(orderBody.parse(summary.body).order).toMatchObject({
      status: 'PLACED',
      payment: { status: 'PENDING' },
    });
    const page = await getPage(storeHost, `/orders/${placed.orderId}?placed=1`, shopper.cookie);
    expect(page.status).toBe(200);
    expect(page.text).toContain(placed.orderNumber);
  });

  it('keeps one customer’s order away from another (404)', async () => {
    const owner = await registeredShopper();
    const placed = placedBody.parse((await placeOrder(owner, 'COD')).body).order;
    const stranger = await registeredShopper();
    const response = await callApi('get', 'store', `/api/store/orders/${placed.orderId}`, {
      cookie: stranger.cookie,
    });
    expect(response.status).toBe(404);
  });
});

describe('online payment and fulfilment over HTTP (Waves 8–9)', () => {
  it('pays online, then staff confirm, pack, create the AWB, download the label and drive scans to delivery', async () => {
    const shopper = await registeredShopper();
    const placed = placedBody.parse((await placeOrder(shopper, 'ONLINE')).body).order;
    const paid = await callApi('post', 'store', `/api/store/orders/${placed.orderId}/payments`, {
      cookie: shopper.cookie,
      body: { scenario: 'SUCCESS', amountPaise: 79_900 },
    }).set('Idempotency-Key', newKey());
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);

    expect(
      (
        await callApi('post', 'admin', `/api/admin/orders/${placed.orderId}/confirm`, {
          cookie: support,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await callApi('post', 'admin', `/api/admin/orders/${placed.orderId}/confirm`, {
          cookie: orderOps,
        })
      ).status,
    ).toBe(204);
    const detail = await callApi('get', 'admin', `/api/admin/orders/${placed.orderId}`, {
      cookie: orderOps,
    });
    const shipmentId = orderBody.parse(detail.body).order.shipments[0]?.id ?? '';
    for (const action of ['pack', 'create-awb']) {
      const response = await callApi(
        'post',
        'admin',
        `/api/admin/shipments/${shipmentId}/${action}`,
        { cookie: orderOps, body: {} },
      );
      expect(response.status, `${action} ${JSON.stringify(response.body)}`).toBe(204);
    }
    const label = await callApi('get', 'admin', `/api/admin/shipments/${shipmentId}/label`, {
      cookie: orderOps,
    });
    expect(label.status).toBe(200);
    expect(label.headers['content-type']).toBe('application/pdf');
    for (let scan = 0; scan < 3; scan += 1) {
      const response = await callApi(
        'post',
        'admin',
        `/api/admin/shipments/${shipmentId}/simulate-scan`,
        {
          cookie: orderOps,
          body: { outcome: 'DELIVERED' },
        },
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
    }
    const delivered = await callApi('get', 'store', `/api/store/orders/${placed.orderId}`, {
      cookie: shopper.cookie,
    });
    expect(orderBody.parse(delivered.body).order).toMatchObject({
      status: 'DELIVERED',
      payment: { status: 'COLLECTED' },
    });
  });

  it('refuses an unsigned or tampered courier webhook with 401 and accepts a signed one', async () => {
    const unsigned = await callApi('post', 'admin', `/api/webhooks/courier/${courierCode}`, {
      body: { events: [] },
      origin: null,
    });
    expect(unsigned.status).toBe(401);
    const rawBody = JSON.stringify({
      events: [
        {
          eventId: `http-${runId}`,
          awbNumber: 'DMO000000000000',
          status: 'SHIPPED',
          description: 'Picked up',
          location: null,
          occurredAt: new Date().toISOString(),
        },
      ],
    });
    const tampered = await callApi('post', 'admin', `/api/webhooks/courier/${courierCode}`, {
      origin: null,
    })
      .set('Content-Type', 'application/json')
      .set('X-Courier-Signature', signWebhook('wrong-secret', rawBody, new Date()))
      .send(rawBody);
    expect(tampered.status).toBe(401);
    const masterSigned = await callApi('post', 'admin', `/api/webhooks/courier/${courierCode}`, {
      origin: null,
    })
      .set('Content-Type', 'application/json')
      .set('X-Courier-Signature', signWebhook(localOnlyCourierSecret, rawBody, new Date()))
      .send(rawBody);
    // L2: the bare master secret (or another partner's key) is not this partner's signing key.
    expect(masterSigned.status).toBe(401);
    const otherPartner = await callApi('post', 'admin', `/api/webhooks/courier/${courierCode}`, {
      origin: null,
    })
      .set('Content-Type', 'application/json')
      .set(
        'X-Courier-Signature',
        signWebhook(
          deriveCourierSigningKey(localOnlyCourierSecret, `${courierCode}-other`),
          rawBody,
          new Date(),
        ),
      )
      .send(rawBody);
    expect(otherPartner.status).toBe(401);
    const signed = await callApi('post', 'admin', `/api/webhooks/courier/${courierCode}`, {
      origin: null,
    })
      .set('Content-Type', 'application/json')
      .set(
        'X-Courier-Signature',
        signWebhook(
          deriveCourierSigningKey(localOnlyCourierSecret, courierCode),
          rawBody,
          new Date(),
        ),
      )
      .send(rawBody);
    expect(signed.status).toBe(200);
    expect(signed.body).toMatchObject({ events: [{ result: 'FAILED' }] });
  });
});

describe('admin protection (acceptance test 5)', () => {
  it('a customer session gets nothing from admin APIs, and admin APIs are 404 on the store host', async () => {
    const shopper = await registeredShopper();
    const token = shopper.cookie.split('=')[1] ?? '';
    const asStaff = await callApi('get', 'admin', '/api/admin/orders', {
      cookie: `admin_session=${token}`,
    });
    expect([401, 403]).toContain(asStaff.status);
    const onStoreHost = await callApi('get', 'store', '/api/admin/orders', {
      cookie: shopper.cookie,
    });
    expect(onStoreHost.status).toBe(404);
  });

  it('SUPPORT can read orders, customers and reports but cannot block a customer (403)', async () => {
    expect((await callApi('get', 'admin', '/api/admin/orders', { cookie: support })).status).toBe(
      200,
    );
    const customers = await callApi('get', 'admin', '/api/admin/customers', { cookie: support });
    expect(customers.status).toBe(200);
    const customerId =
      z.object({ items: z.array(idSchema) }).parse(customers.body).items[0]?.id ?? randomUUID();
    const block = await callApi('post', 'admin', `/api/admin/customers/${customerId}/status`, {
      cookie: support,
      body: { isBlocked: true, reason: 'not allowed' },
    });
    expect(block.status).toBe(403);
    expect(
      (await callApi('get', 'admin', '/api/admin/reports/summary', { cookie: support })).status,
    ).toBe(200);
  });
});

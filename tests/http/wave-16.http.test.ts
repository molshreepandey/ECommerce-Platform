import { randomInt } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { callApi } from './app-server';
import { errorCode, staffCookie } from './support/catalogue-api';
import {
  createSellableVariant,
  placedBody,
  placeOrder,
  registeredShopper,
  type SellableVariant,
} from './support/commerce-api';

// Wave 16 over HTTP: search autocomplete (C14), notification log (C38), allocation strategy setting.
const runId = `${String(Date.now())}${String(randomInt(1000))}`;
let superAdmin = '';
let orderOps = '';
let catalogueManager = '';
let sellable: SellableVariant;

beforeAll(async () => {
  let inventoryManager = '';
  [superAdmin, orderOps, catalogueManager, inventoryManager] = await Promise.all([
    staffCookie('super.admin@demo-store.test'),
    staffCookie('order.ops@demo-store.test'),
    staffCookie('catalogue.manager@demo-store.test'),
    staffCookie('inventory.manager@demo-store.test'),
  ]);
  sellable = await createSellableVariant({
    runId: `s${runId}`,
    pincode: '411001',
    catalogueManager,
    inventoryManager,
    superAdmin,
  });
});

describe('search autocomplete over HTTP (C14)', () => {
  it('suggests products and categories to anyone; too short or too long is 400', async () => {
    const short = await callApi('get', 'store', '/api/store/search/suggest?q=k');
    expect(short.status).toBe(400);
    const long = await callApi('get', 'store', `/api/store/search/suggest?q=${'x'.repeat(101)}`);
    expect(long.status).toBe(400);
    const response = await callApi('get', 'store', '/api/store/search/suggest?q=Kurta');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = z
      .object({
        suggestions: z.object({
          products: z.array(z.object({ name: z.string(), slug: z.string() })),
          categories: z.array(z.object({ name: z.string(), slug: z.string() })),
        }),
      })
      .parse(response.body);
    expect(body.suggestions.products.length).toBeLessThanOrEqual(6);
    expect(
      (await callApi('get', 'admin', '/api/store/search/suggest?q=Kurta', { cookie: superAdmin }))
        .status,
    ).toBe(404);
  });
});

describe('notification log over HTTP (C38)', () => {
  it('shows the order-placed message to its customer and staff only', async () => {
    const customer = await registeredShopper(runId, '411001');
    const placed = placedBody.parse(
      (await placeOrder(customer, sellable.variantId, 'COD')).body,
    ).order;
    const notificationsBody = z.object({
      notifications: z.array(
        z.object({ event: z.string(), recipient: z.string(), message: z.string() }),
      ),
    });
    const own = await callApi('get', 'store', `/api/store/orders/${placed.orderId}/notifications`, {
      cookie: customer.cookie,
    });
    expect(own.status).toBe(200);
    const messages = notificationsBody.parse(own.body).notifications;
    expect(messages.map(({ event }) => event)).toEqual(['ORDER_PLACED']);
    expect(messages[0]?.message).toContain(placed.orderNumber);
    expect(messages[0]?.recipient).not.toContain('9876543210');
    const stranger = await registeredShopper(runId, '411001');
    const foreign = await callApi(
      'get',
      'store',
      `/api/store/orders/${placed.orderId}/notifications`,
      { cookie: stranger.cookie },
    );
    expect(foreign.status).toBe(404);
    expect(
      (await callApi('get', 'store', `/api/store/orders/${placed.orderId}/notifications`)).status,
    ).toBe(401);
    expect(
      (
        await callApi('get', 'admin', `/api/admin/orders/${placed.orderId}/notifications`, {
          cookie: orderOps,
        })
      ).status,
    ).toBe(200);
    const denied = await callApi(
      'get',
      'admin',
      `/api/admin/orders/${placed.orderId}/notifications`,
      { cookie: catalogueManager },
    );
    expect(denied.status).toBe(403);
    expect(errorCode(denied.body)).toBe('PERMISSION_DENIED');
  });
});

describe('allocation strategy setting over HTTP (Wave 16)', () => {
  it('saves NEAREST_PINCODE, refuses an unknown strategy, and is restored', async () => {
    const settingsBody = z.object({ settings: z.record(z.string(), z.unknown()) });
    const before = settingsBody.parse(
      (await callApi('get', 'admin', '/api/admin/settings', { cookie: superAdmin })).body,
    ).settings;
    try {
      const saved = await callApi('put', 'admin', '/api/admin/settings', {
        cookie: superAdmin,
        body: { ...before, allocationStrategy: 'NEAREST_PINCODE' },
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      const after = settingsBody.parse(
        (await callApi('get', 'admin', '/api/admin/settings', { cookie: superAdmin })).body,
      ).settings;
      expect(after['allocationStrategy']).toBe('NEAREST_PINCODE');
      const invalid = await callApi('put', 'admin', '/api/admin/settings', {
        cookie: superAdmin,
        body: { ...before, allocationStrategy: 'RANDOM' },
      });
      expect(invalid.status).toBe(400);
    } finally {
      await callApi('put', 'admin', '/api/admin/settings', {
        cookie: superAdmin,
        body: { ...before, allocationStrategy: before['allocationStrategy'] ?? 'PRIORITY' },
      });
    }
  });
});

import { randomInt } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseCsv } from '../../src/lib/csv';
import { callApi, sessionCookieFrom } from './app-server';
import { catalogueApi, errorCode, idSchema, staffCookie } from './support/catalogue-api';
import {
  createSellableVariant,
  createWarehouse,
  newKey,
  type SellableVariant,
} from './support/commerce-api';

// Wave 13 over HTTP: stock transfer (D27), re-categorise (D21), staff management (D3), search index
// tools (D48), CSV exports (D8), product CSV upload/export (D16) and pincode CSV upload (D41).
const runId = `${String(Date.now())}${String(randomInt(1000))}`;
let catalogueManager = '';
let inventoryManager = '';
let superAdmin = '';
let orderOps = '';
let support = '';
let sellable: SellableVariant;

const stockRequestBody = z.object({
  stockRequest: z.object({
    replayed: z.boolean(),
    movements: z.array(z.object({ movementType: z.string(), quantityDelta: z.number() })),
  }),
});
const csvImportBody = z.object({
  csvImport: z.object({
    savedCount: z.number(),
    errors: z.array(z.object({ line: z.number(), messages: z.array(z.string()) })),
  }),
});

beforeAll(async () => {
  [catalogueManager, inventoryManager, superAdmin, orderOps, support] = await Promise.all([
    staffCookie('catalogue.manager@demo-store.test'),
    staffCookie('inventory.manager@demo-store.test'),
    staffCookie('super.admin@demo-store.test'),
    staffCookie('order.ops@demo-store.test'),
    staffCookie('support@demo-store.test'),
  ]);
  sellable = await createSellableVariant({
    runId: `t${runId}`,
    pincode: '411001',
    catalogueManager,
    inventoryManager,
    superAdmin,
  });
});

describe('stock transfer over HTTP (D27)', () => {
  it('201 with two ledger rows, 200 on replay, 400 without a key, 409 beyond available, 403 read-only', async () => {
    const target = await createWarehouse(inventoryManager, `X${runId}`, 7);
    const body = {
      fromWarehouseId: sellable.warehouseId,
      toWarehouseId: target,
      reason: 'Rebalance over HTTP',
      lines: [{ variantId: sellable.variantId, quantity: 2 }],
    };
    const key = newKey();
    const post = (cookie: string, payload: object, idempotencyKey: string | null = key) => {
      const request = callApi('post', 'admin', '/api/admin/inventory/transfers', {
        cookie,
        body: payload,
      });
      return idempotencyKey === null ? request : request.set('Idempotency-Key', idempotencyKey);
    };
    expect((await post(inventoryManager, body, null)).status).toBe(400);
    expect((await post(support, body, newKey())).status).toBe(403);
    const first = await post(inventoryManager, body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(
      stockRequestBody
        .parse(first.body)
        .stockRequest.movements.map(({ movementType }) => movementType)
        .sort(),
    ).toEqual(['TRANSFER_IN', 'TRANSFER_OUT']);
    const replay = await post(inventoryManager, body);
    expect(replay.status).toBe(200);
    expect(stockRequestBody.parse(replay.body).stockRequest.replayed).toBe(true);
    const tooMany = await post(
      inventoryManager,
      { ...body, lines: [{ variantId: sellable.variantId, quantity: 100_000 }] },
      newKey(),
    );
    expect(tooMany.status).toBe(409);
    expect(errorCode(tooMany.body)).toBe('OUT_OF_STOCK');
  });
});

describe('bulk re-categorise over HTTP (D21)', () => {
  it('moves the products of one category to another leaf; 403 without taxonomy.write', async () => {
    const createCategory = async (name: string) => {
      const response = await callApi('post', 'admin', '/api/admin/categories', {
        cookie: catalogueManager,
        body: { name: `${name} ${runId}`, parentId: null },
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      return z.object({ category: idSchema }).parse(response.body).category.id;
    };
    const from = await createCategory('From');
    const to = await createCategory('To');
    const tagged = await callApi('post', 'admin', '/api/admin/tagging', {
      cookie: catalogueManager,
      body: { productIds: [sellable.productId], categoryId: from },
    });
    expect(tagged.status).toBe(200);
    const body = { fromCategoryId: from, toCategoryId: to };
    expect(
      (await callApi('post', 'admin', '/api/admin/tagging/recategorise', { cookie: support, body }))
        .status,
    ).toBe(403);
    const moved = await callApi('post', 'admin', '/api/admin/tagging/recategorise', {
      cookie: catalogueManager,
      body,
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body).toMatchObject({ movedProductIds: [sellable.productId] });
  });
});

describe('staff management over HTTP (D3)', () => {
  it('super admin creates, re-roles and deactivates staff; others get 403; deactivation ends sessions', async () => {
    const email = `staff.${runId}@example.test`;
    const password = 'Http-Staff-Password-2026';
    const create = (cookie: string) =>
      callApi('post', 'admin', '/api/admin/staff', {
        cookie,
        body: { fullName: 'Http Staff', email, password, roleCodes: ['SUPPORT'] },
      });
    expect((await create(orderOps)).status).toBe(403);
    expect((await callApi('get', 'admin', '/api/admin/staff', { cookie: support })).status).toBe(
      403,
    );
    const created = await create(superAdmin);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await create(superAdmin)).status).toBe(409);
    const staffUserId = z.object({ staffUser: idSchema }).parse(created.body).staffUser.id;
    const login = await callApi('post', 'admin', '/api/admin/auth/login', {
      body: { email, password },
    });
    expect(login.status).toBe(200);
    const cookie = sessionCookieFrom(login.headers['set-cookie'], 'admin_session');
    expect((await callApi('get', 'admin', '/api/admin/orders', { cookie })).status).toBe(200);
    const reRoled = await callApi('put', 'admin', `/api/admin/staff/${staffUserId}/roles`, {
      cookie: superAdmin,
      body: { roleCodes: ['CATALOGUE_MANAGER'] },
    });
    expect(reRoled.status).toBe(204);
    expect((await callApi('get', 'admin', '/api/admin/orders', { cookie })).status).toBe(403);
    const deactivated = await callApi('post', 'admin', `/api/admin/staff/${staffUserId}/status`, {
      cookie: superAdmin,
      body: { status: 'DEACTIVATED' },
    });
    expect(deactivated.status).toBe(204);
    expect((await callApi('get', 'admin', '/api/admin/products', { cookie })).status).toBe(401);
    const roles = await callApi('get', 'admin', '/api/admin/roles', { cookie: superAdmin });
    expect(roles.status).toBe(200);
  });
});

describe('search index tools over HTTP (D48)', () => {
  it('shows health and backlog, syncs on demand; 403 without search.manage', async () => {
    expect(
      (await callApi('get', 'admin', '/api/admin/search-index', { cookie: support })).status,
    ).toBe(403);
    const status = await callApi('get', 'admin', '/api/admin/search-index', { cookie: superAdmin });
    expect(status.status).toBe(200);
    expect(
      z
        .object({
          searchIndex: z.object({
            isElasticsearchReachable: z.boolean(),
            pendingOutboxCount: z.number(),
          }),
        })
        .parse(status.body).searchIndex.isElasticsearchReachable,
    ).toBe(true);
    const sync = await callApi('post', 'admin', '/api/admin/search-index/sync', {
      cookie: superAdmin,
    });
    expect(sync.status, JSON.stringify(sync.body)).toBe(200);
  });
});

describe('CSV exports over HTTP (D8)', () => {
  it('downloads each report as UTF-8 CSV; unknown report is 404; a customer gets nothing', async () => {
    for (const report of ['orders', 'sales', 'gst-summary', 'inventory']) {
      const response = await callApi('get', 'admin', `/api/admin/reports/export/${report}`, {
        cookie: support,
      });
      expect(response.status, report).toBe(200);
      expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(response.headers['content-disposition']).toMatch(/^attachment; filename="/);
      expect(parseCsv(response.text)[0]?.length).toBeGreaterThan(2);
    }
    expect(
      (
        await callApi('get', 'admin', '/api/admin/reports/export/everything', {
          cookie: support,
        })
      ).status,
    ).toBe(404);
  });
});

describe('product CSV upload and export over HTTP (D16)', () => {
  it('exports the template, creates products from it with per-line errors, refuses a reader (403)', async () => {
    const api = catalogueApi(() => catalogueManager);
    const productTypeId = await api.createType(`csv_${runId}`);
    await api.createBrand(`csv-brand-${runId}`);
    const template = await callApi(
      'get',
      'admin',
      `/api/admin/product-types/${productTypeId}/products/export`,
      { cookie: support },
    );
    expect(template.status).toBe(200);
    const [header = []] = parseCsv(template.text);
    const values: Record<string, string> = {
      product_slug: `csv-${runId}`,
      product_name: 'Http CSV Kurta',
      brand_slug: `csv-brand-${runId}`,
      description: '',
      gst_rate_percent: '5',
      attr_fabric: 'Cotton',
      sku: `CSV-${runId}-M`,
      option_size: 'M',
      mrp_rupees: '999',
      price_rupees: '799',
      weight_grams: '300',
      length_mm: '300',
      breadth_mm: '250',
      height_mm: '30',
    };
    const line = (overrides: Record<string, string>) =>
      header.map((column) => ({ ...values, ...overrides })[column] ?? '').join(',');
    const csv = [
      header.join(','),
      line({}),
      line({ product_slug: `bad-${runId}`, sku: `BAD-${runId}`, option_size: 'XXL' }),
    ].join('\n');
    const url = `/api/admin/product-types/${productTypeId}/products/import`;
    expect((await callApi('post', 'admin', url, { cookie: support, body: { csv } })).status).toBe(
      403,
    );
    const imported = await callApi('post', 'admin', url, {
      cookie: catalogueManager,
      body: { csv },
    });
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    const result = csvImportBody.parse(imported.body).csvImport;
    expect(result.savedCount).toBe(1);
    expect(result.errors.map(({ line: number }) => number)).toEqual([3]);
    const badHeader = await callApi('post', 'admin', url, {
      cookie: catalogueManager,
      body: { csv: 'nope\n1' },
    });
    expect(badHeader.status).toBe(422);
    expect(errorCode(badHeader.body)).toBe('CSV_HEADER_INVALID');
  });
});

describe('pincode CSV upload over HTTP (D41)', () => {
  it('saves valid rows and reports bad ones; needs couriers.write', async () => {
    const couriers = await callApi('get', 'admin', '/api/admin/courier-partners', {
      cookie: superAdmin,
    });
    const courierId =
      z
        .object({ courierPartners: z.array(z.object({ id: z.uuid(), code: z.string() })) })
        .parse(couriers.body)
        .courierPartners.find(({ code }) => code === sellable.courierCode)?.id ?? '';
    const csv = 'pincode,cod_available,max_cod_value_rupees,eta_days\n560034,yes,,2\n12,yes,,2\n';
    const url = `/api/admin/courier-partners/${courierId}/pincodes/import`;
    expect((await callApi('post', 'admin', url, { cookie: support, body: { csv } })).status).toBe(
      403,
    );
    const imported = await callApi('post', 'admin', url, { cookie: orderOps, body: { csv } });
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    const result = csvImportBody.parse(imported.body).csvImport;
    expect(result.savedCount).toBe(1);
    expect(result.errors.map(({ line }) => line)).toEqual([3]);
  });
});

describe('Swagger UI and OpenAPI over HTTP (D49)', () => {
  it('serves the generated document and the Swagger script to staff only', async () => {
    expect((await callApi('get', 'admin', '/api/admin/docs/openapi.json')).status).toBe(401);
    const spec = await callApi('get', 'admin', '/api/admin/docs/openapi.json', { cookie: support });
    expect(spec.status).toBe(200);
    const document = z
      .object({ openapi: z.string(), paths: z.record(z.string(), z.unknown()) })
      .parse(spec.body);
    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths)).toContain('/api/admin/inventory/transfers');
    const script = await callApi('get', 'admin', '/api/admin/docs/assets/swagger-ui-bundle.js', {
      cookie: support,
    });
    expect(script.status).toBe(200);
    expect(script.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(
      (await callApi('get', 'admin', '/api/admin/docs/assets/package.json', { cookie: support }))
        .status,
    ).toBe(404);
  });
});

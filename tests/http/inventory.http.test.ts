import { randomInt, randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { demoPassword } from '../../prisma/seed/demo-credentials';
import { callApi, sessionCookieFrom } from './app-server';
import {
  catalogueApi,
  errorCode,
  errorEnvelope,
  idSchema,
  staffCookie,
} from './support/catalogue-api';
import { holdRowLocksOnTestDatabase, runOnTestDatabase } from './support/test-database-writer';

// Admin inventory API (Wave 5 step 3). Every test works on warehouses, products and staff created for
// this run only, so it never depends on (or disturbs) data from other test files running in parallel.

const runId = `${Date.now().toString(36)}${randomInt(1_000_000).toString(36)}`.toUpperCase();
const unknownId = '0195f2a0-0000-7000-8000-000000000999';

let inventoryManager = '';
let superAdmin = '';
let support = '';
let catalogueManager = '';
let orderOps = '';
let noInventoryStaff = '';
let customerAsStaff = '';
let warehouseId = '';
let variantIds: string[] = [];

const measurements = {
  mrpPaise: 99_900,
  pricePaise: 79_900,
  weightGrams: 300,
  lengthMm: 300,
  breadthMm: 250,
  heightMm: 30,
};

const warehouseSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  priority: z.number(),
});
const warehouseBody = z.object({ warehouse: warehouseSchema });
const movementSchema = z.object({
  movementId: z.uuid(),
  variantId: z.uuid(),
  warehouseId: z.uuid(),
  movementType: z.string(),
  quantityDelta: z.number(),
  onHandBefore: z.number(),
  onHandAfter: z.number(),
  reservedBefore: z.number(),
  reservedAfter: z.number(),
  availableAfter: z.number(),
  reason: z.string().nullable(),
});
const stockRequestBody = z.object({
  stockRequest: z.object({
    changeRequestId: z.uuid(),
    operation: z.string(),
    replayed: z.boolean(),
    movements: z.array(movementSchema),
  }),
});
const ledgerBody = z.object({
  movements: z.array(
    z.object({
      movementId: z.uuid(),
      variantId: z.uuid(),
      warehouseId: z.uuid(),
      warehouseCode: z.string().nullable(),
      sku: z.string().nullable(),
      movementType: z.string(),
      quantityDelta: z.number(),
      onHandBefore: z.number(),
      onHandAfter: z.number(),
      referenceType: z.string().nullable(),
      actorType: z.string(),
      reason: z.string().nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
const matrixBody = z.object({
  items: z.array(
    z.object({
      productId: z.uuid(),
      variants: z.array(
        z.object({
          variantId: z.uuid(),
          sku: z.string(),
          levels: z.array(
            z.object({
              warehouseId: z.uuid(),
              onHandQuantity: z.number(),
              reservedQuantity: z.number(),
              availableQuantity: z.number(),
              lowStockThreshold: z.number(),
              isLowStock: z.boolean(),
            }),
          ),
        }),
      ),
    }),
  ),
  nextCursor: z.string().nullable(),
});
const lowStockBody = z.object({
  items: z.array(
    z.object({
      variantId: z.uuid(),
      warehouseId: z.uuid(),
      availableQuantity: z.number(),
      lowStockThreshold: z.number(),
    }),
  ),
  nextCursor: z.string().nullable(),
  totalCount: z.number(),
});

function warehouseInput(code: string) {
  return {
    code,
    name: `Warehouse ${code}`,
    addressLine1: '14, Industrial Area Phase 2',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560058',
    contactName: 'Store Keeper',
    contactPhone: '9876543210',
    priority: 50,
  };
}

async function createWarehouse(code: string): Promise<string> {
  const response = await callApi('post', 'admin', '/api/admin/warehouses', {
    cookie: inventoryManager,
    body: warehouseInput(code),
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return warehouseBody.parse(response.body).warehouse.id;
}

async function createVariants(slug: string, count: number): Promise<string[]> {
  const { createProduct } = catalogueApi(() => catalogueManager);
  const productId = await createProduct(slug);
  const ids: string[] = [];
  for (const size of ['S', 'M', 'L'].slice(0, count)) {
    const response = await callApi('post', 'admin', `/api/admin/products/${productId}/variants`, {
      cookie: catalogueManager,
      body: { sku: `${slug.toUpperCase()}-${size}`, optionValues: { size }, ...measurements },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    ids.push(z.object({ variant: idSchema }).parse(response.body).variant.id);
  }
  return ids;
}

function newKey(): string {
  return randomUUID();
}

function adjust(cookie: string, key: string | null, body: object, origin?: string | null) {
  const request = callApi('post', 'admin', '/api/admin/inventory/adjustments', {
    cookie,
    body,
    ...(origin === undefined ? {} : { origin }),
  });
  return key === null ? request : request.set('Idempotency-Key', key);
}

function receive(cookie: string, key: string | null, body: object) {
  const request = callApi('post', 'admin', '/api/admin/inventory/receipts', { cookie, body });
  return key === null ? request : request.set('Idempotency-Key', key);
}

async function onHandOf(variantId: string, inWarehouse = warehouseId): Promise<number> {
  const response = await callApi(
    'get',
    'admin',
    `/api/admin/inventory?warehouseId=${inWarehouse}&search=INV-${runId}&limit=100`,
    { cookie: inventoryManager },
  );
  expect(response.status).toBe(200);
  for (const product of matrixBody.parse(response.body).items) {
    for (const variant of product.variants) {
      if (variant.variantId !== variantId) continue;
      return variant.levels.find((level) => level.warehouseId === inWarehouse)?.onHandQuantity ?? 0;
    }
  }
  return 0;
}

async function ledgerOf(inWarehouse: string) {
  const response = await callApi(
    'get',
    'admin',
    `/api/admin/inventory/movements?warehouseId=${inWarehouse}&limit=100`,
    { cookie: inventoryManager },
  );
  expect(response.status).toBe(200);
  return ledgerBody.parse(response.body).movements;
}

// A staff member whose only permission is catalogue.read, created on the guarded test database with the
// demo password hash copied from an existing demo account (no hashing in the test).
async function staffWithoutInventoryAccess(): Promise<string> {
  const email = `no.inventory.${runId.toLowerCase()}@demo-store.test`;
  await runOnTestDatabase(
    `WITH new_role AS (
       INSERT INTO roles (code, name, description) VALUES ($1, 'No inventory access', 'HTTP test role')
       RETURNING id),
     granted AS (
       INSERT INTO role_permissions (role_id, permission_id)
       SELECT new_role.id, permissions.id FROM new_role, permissions WHERE permissions.code = 'catalogue.read'),
     new_staff AS (
       INSERT INTO staff_users (full_name, email, password_hash)
       SELECT 'No Inventory', $2, password_hash FROM staff_users WHERE email = 'support@demo-store.test'
       RETURNING id)
     INSERT INTO staff_user_roles (staff_user_id, role_id)
     SELECT new_staff.id, new_role.id FROM new_staff, new_role`,
    [`NO_INVENTORY_${runId}`, email],
  );
  return staffCookie(email);
}

beforeAll(async () => {
  [inventoryManager, superAdmin, support, catalogueManager, orderOps] = await Promise.all([
    staffCookie('inventory.manager@demo-store.test'),
    staffCookie('super.admin@demo-store.test'),
    staffCookie('support@demo-store.test'),
    staffCookie('catalogue.manager@demo-store.test'),
    staffCookie('order.ops@demo-store.test'),
  ]);
  noInventoryStaff = await staffWithoutInventoryAccess();
  const customer = await callApi('post', 'store', '/api/store/auth/login', {
    body: { email: 'asha.verma@demo-store.test', password: demoPassword },
  });
  expect(customer.status).toBe(200);
  const token =
    sessionCookieFrom(customer.headers['set-cookie'], 'store_session').split('=')[1] ?? '';
  customerAsStaff = `admin_session=${token}`;
  warehouseId = await createWarehouse(`H${runId}`);
  variantIds = await createVariants(`inv-${runId.toLowerCase()}`, 3);
});

function variant(index: number): string {
  const id = variantIds[index];
  if (id === undefined) throw new Error(`no variant ${String(index)}`);
  return id;
}

const readRoutes = (): string[] => [
  '/api/admin/warehouses',
  `/api/admin/warehouses/${warehouseId}`,
  '/api/admin/inventory',
  '/api/admin/inventory/movements',
  '/api/admin/inventory/low-stock',
];

const writeRoutes = (): [method: 'post' | 'patch' | 'put', path: string, body: object][] => [
  ['post', '/api/admin/warehouses', warehouseInput(`D${runId}`)],
  ['patch', `/api/admin/warehouses/${warehouseId}`, { name: 'Renamed by someone else' }],
  ['post', `/api/admin/warehouses/${warehouseId}/status`, { isActive: false }],
  [
    'post',
    '/api/admin/inventory/adjustments',
    { operation: 'ADD', variantId: variant(0), warehouseId, quantity: 1, reason: 'Not allowed' },
  ],
  [
    'post',
    '/api/admin/inventory/receipts',
    {
      warehouseId,
      supplierReference: 'NOT-ALLOWED',
      lines: [{ variantId: variant(0), quantity: 1 }],
    },
  ],
  [
    'put',
    '/api/admin/inventory/thresholds',
    { variantId: variant(0), warehouseId, lowStockThreshold: 3 },
  ],
];

describe('who may use the inventory API', () => {
  it('answers 401 without a session on every read and write route', async () => {
    for (const path of readRoutes()) {
      const response = await callApi('get', 'admin', path);
      expect(response.status, path).toBe(401);
      expect(errorCode(response.body)).toBe('UNAUTHENTICATED');
    }
    for (const [method, path, body] of writeRoutes()) {
      const response = await callApi(method, 'admin', path, { body }).set(
        'Idempotency-Key',
        newKey(),
      );
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(errorCode(response.body)).toBe('UNAUTHENTICATED');
    }
  });

  it('answers 403 WRONG_ACCOUNT_TYPE for a customer session on the admin API', async () => {
    const response = await callApi('get', 'admin', '/api/admin/inventory', {
      cookie: customerAsStaff,
    });
    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe('WRONG_ACCOUNT_TYPE');
  });

  it('answers 403 PERMISSION_DENIED on every read route for staff without inventory.read', async () => {
    for (const path of readRoutes()) {
      const response = await callApi('get', 'admin', path, { cookie: noInventoryStaff });
      expect(response.status, path).toBe(403);
      expect(errorEnvelope.parse(response.body).error).toMatchObject({
        code: 'PERMISSION_DENIED',
      });
    }
  });

  it('lets read-only roles read, but refuses every write with 403 and changes nothing', async () => {
    const ledgerBefore = await ledgerOf(warehouseId);
    const onHandBefore = await onHandOf(variant(0));
    for (const [role, cookie] of [
      ['support', support],
      ['catalogue manager', catalogueManager],
      ['order operations', orderOps],
    ] as const) {
      for (const path of readRoutes()) {
        const response = await callApi('get', 'admin', path, { cookie });
        expect(response.status, `${role} GET ${path}`).toBe(200);
      }
      for (const [method, path, body] of writeRoutes()) {
        const response = await callApi(method, 'admin', path, { cookie, body }).set(
          'Idempotency-Key',
          newKey(),
        );
        expect(response.status, `${role} ${method} ${path}`).toBe(403);
        expect(errorCode(response.body)).toBe('PERMISSION_DENIED');
      }
    }
    expect(await ledgerOf(warehouseId)).toEqual(ledgerBefore);
    expect(await onHandOf(variant(0))).toBe(onHandBefore);
    const warehouse = await callApi('get', 'admin', `/api/admin/warehouses/${warehouseId}`, {
      cookie: support,
    });
    expect(warehouseBody.parse(warehouse.body).warehouse).toMatchObject({
      name: `Warehouse H${runId}`,
      isActive: true,
    });
  });

  it('refuses writes from another site or with no Origin, and keeps the API off the store host', async () => {
    for (const origin of ['https://evil.example', null]) {
      for (const [method, path, body] of writeRoutes()) {
        const response = await callApi(method, 'admin', path, {
          cookie: inventoryManager,
          body,
          origin,
        }).set('Idempotency-Key', newKey());
        expect(response.status, `${String(origin)} ${method} ${path}`).toBe(403);
        expect(errorCode(response.body)).toBe('ORIGIN_NOT_ALLOWED');
      }
    }
    for (const path of readRoutes()) {
      const response = await callApi('get', 'store', path, { cookie: inventoryManager });
      expect(response.status, path).toBe(404);
    }
  });
});

describe('input validation', () => {
  it('answers 400 for malformed JSON, unknown fields, bad ids and bad query parameters', async () => {
    const malformed = await callApi('post', 'admin', '/api/admin/warehouses', {
      cookie: inventoryManager,
    })
      .set('Content-Type', 'application/json')
      .send('{"code": ');
    expect(malformed.status).toBe(400);
    expect(errorCode(malformed.body)).toBe('INVALID_JSON');

    for (const [method, path, body] of [
      ['post', '/api/admin/warehouses', { ...warehouseInput(`X${runId}`), isActive: false }],
      ['post', '/api/admin/warehouses', { ...warehouseInput(`Y${runId}`), pincode: '012345' }],
      ['patch', `/api/admin/warehouses/${warehouseId}`, {}],
      ['patch', `/api/admin/warehouses/${warehouseId}`, { code: 'NEW-CODE' }],
      ['post', `/api/admin/warehouses/${warehouseId}/status`, { isActive: 'no' }],
      [
        'put',
        '/api/admin/inventory/thresholds',
        { variantId: variant(0), warehouseId, lowStockThreshold: -1 },
      ],
    ] as const) {
      const response = await callApi(method, 'admin', path, { cookie: inventoryManager, body });
      expect(response.status, `${method} ${path} ${JSON.stringify(body)}`).toBe(400);
      expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
    }

    for (const path of [
      '/api/admin/warehouses/not-a-uuid',
      '/api/admin/inventory?limit=500',
      '/api/admin/inventory?lowStockOnly=yes',
      '/api/admin/inventory?cursor=tampered',
      '/api/admin/inventory?warehouseId=123',
      '/api/admin/inventory?colour=red',
      '/api/admin/inventory/movements?movementType=TELEPORT',
      '/api/admin/inventory/movements?createdFrom=yesterday',
      '/api/admin/inventory/movements?variantId=abc',
      '/api/admin/inventory/low-stock?cursor=abc',
      '/api/admin/inventory/low-stock?limit=0',
    ]) {
      const response = await callApi('get', 'admin', path, { cookie: inventoryManager });
      expect(response.status, path).toBe(400);
      expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
    }
    const badStatusId = await callApi('post', 'admin', '/api/admin/warehouses/123/status', {
      cookie: inventoryManager,
      body: { isActive: false },
    });
    expect(badStatusId.status).toBe(400);
  });

  it('answers 400 INVALID_CURSOR for a well-formed cursor that names no row', async () => {
    for (const path of [
      `/api/admin/inventory?cursor=${unknownId}`,
      `/api/admin/inventory/movements?cursor=${unknownId}`,
    ]) {
      const response = await callApi('get', 'admin', path, { cookie: inventoryManager });
      expect(response.status, path).toBe(400);
      expect(errorCode(response.body)).toBe('INVALID_CURSOR');
    }
  });

  it('needs a valid Idempotency-Key on adjustments and receipts, before anything is applied', async () => {
    const onHandBefore = await onHandOf(variant(0));
    const adjustment = {
      operation: 'ADD',
      variantId: variant(0),
      warehouseId,
      quantity: 1,
      reason: 'Missing key',
    };
    const receipt = {
      warehouseId,
      supplierReference: 'NO-KEY',
      lines: [{ variantId: variant(0), quantity: 1 }],
    };
    for (const response of [
      await adjust(inventoryManager, null, adjustment),
      await receive(inventoryManager, null, receipt),
    ]) {
      expect(response.status).toBe(400);
      expect(errorCode(response.body)).toBe('IDEMPOTENCY_KEY_REQUIRED');
    }
    for (const key of ['too-short', 'has spaces in it, not allowed', 'k'.repeat(101)]) {
      for (const response of [
        await adjust(inventoryManager, key, adjustment),
        await receive(inventoryManager, key, receipt),
      ]) {
        expect(response.status, key).toBe(400);
        expect(errorCode(response.body)).toBe('IDEMPOTENCY_KEY_INVALID');
      }
    }
    expect(await onHandOf(variant(0))).toBe(onHandBefore);
  });

  it('answers 400 for invalid adjustment and receipt bodies', async () => {
    for (const body of [
      { variantId: variant(0), warehouseId, quantity: 1, reason: 'No operation' },
      { operation: 'TRANSFER', variantId: variant(0), warehouseId, quantity: 1, reason: 'Unknown' },
      { operation: 'ADD', variantId: variant(0), warehouseId, quantity: 1.5, reason: 'Fraction' },
      { operation: 'ADD', variantId: variant(0), warehouseId, quantity: 100_001, reason: 'Huge' },
      { operation: 'ADD', variantId: variant(0), warehouseId, quantity: 1, reason: '  ' },
      { operation: 'ADD', variantId: 'not-a-uuid', warehouseId, quantity: 1, reason: 'Bad id' },
      {
        operation: 'SET',
        variantId: variant(0),
        warehouseId,
        quantity: 1,
        reason: 'Wrong fields for set',
      },
    ]) {
      const response = await adjust(inventoryManager, newKey(), body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
    }
    for (const body of [
      { warehouseId, supplierReference: 'EMPTY', lines: [] },
      {
        warehouseId,
        supplierReference: 'TWICE',
        lines: [
          { variantId: variant(0), quantity: 1 },
          { variantId: variant(0), quantity: 2 },
        ],
      },
      {
        warehouseId,
        supplierReference: 'TOO-MANY',
        lines: Array.from({ length: 101 }, () => ({ variantId: randomUUID(), quantity: 1 })),
      },
    ]) {
      const response = await receive(inventoryManager, newKey(), body);
      expect(response.status).toBe(400);
      expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
    }
  });

  it('answers 404 for a warehouse or variant that does not exist', async () => {
    for (const [method, path, body] of [
      ['get', `/api/admin/warehouses/${unknownId}`, undefined],
      ['patch', `/api/admin/warehouses/${unknownId}`, { name: 'Ghost' }],
      ['post', `/api/admin/warehouses/${unknownId}/status`, { isActive: false }],
    ] as const) {
      const response = await callApi(method, 'admin', path, {
        cookie: inventoryManager,
        ...(body === undefined ? {} : { body }),
      });
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(errorCode(response.body)).toBe('WAREHOUSE_NOT_FOUND');
    }
    const unknownVariant = await adjust(inventoryManager, newKey(), {
      operation: 'ADD',
      variantId: unknownId,
      warehouseId,
      quantity: 1,
      reason: 'Ghost variant',
    });
    expect(unknownVariant.status).toBe(404);
    expect(errorCode(unknownVariant.body)).toBe('VARIANT_NOT_FOUND');
    const unknownWarehouse = await receive(inventoryManager, newKey(), {
      warehouseId: unknownId,
      supplierReference: 'GHOST',
      lines: [{ variantId: variant(0), quantity: 1 }],
    });
    expect(unknownWarehouse.status).toBe(404);
    expect(errorCode(unknownWarehouse.body)).toBe('WAREHOUSE_NOT_FOUND');
    const threshold = await callApi('put', 'admin', '/api/admin/inventory/thresholds', {
      cookie: inventoryManager,
      body: { variantId: unknownId, warehouseId, lowStockThreshold: 2 },
    });
    expect(threshold.status).toBe(404);
  });
});

describe('warehouses over HTTP', () => {
  it('creates, lists, reads, edits, deactivates and reactivates a warehouse; a duplicate code is 409', async () => {
    const code = `W${runId}`;
    const created = await callApi('post', 'admin', '/api/admin/warehouses', {
      cookie: inventoryManager,
      body: { ...warehouseInput(code.toLowerCase()), addressLine2: 'Gate 3' },
    });
    expect(created.status).toBe(201);
    const warehouse = warehouseBody.parse(created.body).warehouse;
    expect(warehouse).toMatchObject({ code, isActive: true, priority: 50 });

    const duplicate = await callApi('post', 'admin', '/api/admin/warehouses', {
      cookie: inventoryManager,
      body: warehouseInput(code),
    });
    expect(duplicate.status).toBe(409);
    expect(errorCode(duplicate.body)).toBe('WAREHOUSE_CODE_TAKEN');

    const list = await callApi('get', 'admin', '/api/admin/warehouses', { cookie: support });
    expect(list.status).toBe(200);
    const listed = z.object({ warehouses: z.array(warehouseSchema) }).parse(list.body).warehouses;
    expect(listed.map(({ id }) => id)).toContain(warehouse.id);

    const edited = await callApi('patch', 'admin', `/api/admin/warehouses/${warehouse.id}`, {
      cookie: inventoryManager,
      body: { name: 'North hub', priority: 5 },
    });
    expect(edited.status).toBe(200);
    expect(warehouseBody.parse(edited.body).warehouse).toMatchObject({
      code,
      name: 'North hub',
      priority: 5,
    });

    for (const isActive of [false, false, true]) {
      const status = await callApi(
        'post',
        'admin',
        `/api/admin/warehouses/${warehouse.id}/status`,
        {
          cookie: superAdmin,
          body: { isActive },
        },
      );
      expect(status.status).toBe(200);
      expect(warehouseBody.parse(status.body).warehouse.isActive).toBe(isActive);
    }
    const read = await callApi('get', 'admin', `/api/admin/warehouses/${warehouse.id}`, {
      cookie: orderOps,
    });
    expect(warehouseBody.parse(read.body).warehouse).toMatchObject({
      name: 'North hub',
      isActive: true,
    });
  });
});

describe('stock changes over HTTP', () => {
  it('adds, removes and sets stock with a reason, one ledger row each with before and after', async () => {
    const target = variant(1);
    const added = await adjust(inventoryManager, newKey(), {
      operation: 'ADD',
      variantId: target,
      warehouseId,
      quantity: 10,
      reason: 'Opening count',
    });
    expect(added.status).toBe(201);
    const addedRequest = stockRequestBody.parse(added.body).stockRequest;
    expect(addedRequest).toMatchObject({ operation: 'ADJUST_ADD', replayed: false });
    expect(addedRequest.movements).toEqual([
      expect.objectContaining({
        variantId: target,
        warehouseId,
        movementType: 'ADJUSTMENT',
        quantityDelta: 10,
        onHandBefore: 0,
        onHandAfter: 10,
        reason: 'Opening count',
      }),
    ]);

    const removed = await adjust(inventoryManager, newKey(), {
      operation: 'REMOVE',
      variantId: target,
      warehouseId,
      quantity: 3,
      reason: 'Damaged in transit',
    });
    expect(removed.status).toBe(201);
    expect(stockRequestBody.parse(removed.body).stockRequest.movements[0]).toMatchObject({
      quantityDelta: -3,
      onHandBefore: 10,
      onHandAfter: 7,
    });

    const set = await adjust(inventoryManager, newKey(), {
      operation: 'SET',
      variantId: target,
      warehouseId,
      expectedOnHandQuantity: 7,
      newOnHandQuantity: 12,
      reason: 'Cycle count',
    });
    expect(set.status).toBe(201);
    expect(stockRequestBody.parse(set.body).stockRequest).toMatchObject({
      operation: 'ADJUST_SET',
    });
    expect(await onHandOf(target)).toBe(12);

    const ledger = (await ledgerOf(warehouseId)).filter(({ variantId }) => variantId === target);
    expect(
      ledger.map(({ movementType, quantityDelta, onHandBefore, onHandAfter, reason }) => ({
        movementType,
        quantityDelta,
        onHandBefore,
        onHandAfter,
        reason,
      })),
    ).toEqual([
      {
        movementType: 'ADJUSTMENT',
        quantityDelta: 5,
        onHandBefore: 7,
        onHandAfter: 12,
        reason: 'Cycle count',
      },
      {
        movementType: 'ADJUSTMENT',
        quantityDelta: -3,
        onHandBefore: 10,
        onHandAfter: 7,
        reason: 'Damaged in transit',
      },
      {
        movementType: 'ADJUSTMENT',
        quantityDelta: 10,
        onHandBefore: 0,
        onHandAfter: 10,
        reason: 'Opening count',
      },
    ]);
    expect(ledger.every(({ actorType }) => actorType === 'STAFF')).toBe(true);
    expect(ledger.every(({ referenceType }) => referenceType === 'inventory_change_request')).toBe(
      true,
    );
  });

  it('answers 409 for a stale set or a removal below what is held, and 422 for no change or the ceiling', async () => {
    const target = variant(2);
    expect(
      (
        await adjust(inventoryManager, newKey(), {
          operation: 'ADD',
          variantId: target,
          warehouseId,
          quantity: 4,
          reason: 'Opening count',
        })
      ).status,
    ).toBe(201);
    const ledgerBefore = await ledgerOf(warehouseId);

    const stale = await adjust(inventoryManager, newKey(), {
      operation: 'SET',
      variantId: target,
      warehouseId,
      expectedOnHandQuantity: 9,
      newOnHandQuantity: 2,
      reason: 'Old screen',
    });
    expect(stale.status).toBe(409);
    expect(errorEnvelope.parse(stale.body).error).toMatchObject({
      code: 'STALE_STOCK',
      details: { expectedOnHandQuantity: 9, currentOnHandQuantity: 4 },
    });

    const tooMuch = await adjust(inventoryManager, newKey(), {
      operation: 'REMOVE',
      variantId: target,
      warehouseId,
      quantity: 5,
      reason: 'More than we have',
    });
    expect(tooMuch.status).toBe(409);
    expect(errorCode(tooMuch.body)).toBe('STOCK_BELOW_RESERVED');

    const noChange = await adjust(inventoryManager, newKey(), {
      operation: 'SET',
      variantId: target,
      warehouseId,
      expectedOnHandQuantity: 4,
      newOnHandQuantity: 4,
      reason: 'Same number',
    });
    expect(noChange.status).toBe(422);
    expect(errorCode(noChange.body)).toBe('NO_STOCK_CHANGE');

    const nearCeiling = await adjust(inventoryManager, newKey(), {
      operation: 'SET',
      variantId: target,
      warehouseId,
      expectedOnHandQuantity: 4,
      newOnHandQuantity: 1_000_000,
      reason: 'Full warehouse',
    });
    expect(nearCeiling.status).toBe(201);
    const overCeiling = await adjust(inventoryManager, newKey(), {
      operation: 'ADD',
      variantId: target,
      warehouseId,
      quantity: 1,
      reason: 'One more',
    });
    expect(overCeiling.status).toBe(422);
    expect(errorCode(overCeiling.body)).toBe('ON_HAND_LIMIT_EXCEEDED');
    const ledgerAfter = await ledgerOf(warehouseId);
    expect(ledgerAfter.length).toBe(ledgerBefore.length + 1);
    expect(
      (
        await adjust(inventoryManager, newKey(), {
          operation: 'SET',
          variantId: target,
          warehouseId,
          expectedOnHandQuantity: 1_000_000,
          newOnHandQuantity: 4,
          reason: 'Back to the real count',
        })
      ).status,
    ).toBe(201);
  });

  it('receives a multi-line supplier receipt as RECEIPT movements, all or nothing', async () => {
    const receiptWarehouse = await createWarehouse(`R${runId}`);
    const response = await receive(inventoryManager, newKey(), {
      warehouseId: receiptWarehouse,
      supplierReference: '  PO-2026-118  ',
      lines: [
        { variantId: variant(2), quantity: 6 },
        { variantId: variant(0), quantity: 4 },
        { variantId: variant(1), quantity: 2 },
      ],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const receipt = stockRequestBody.parse(response.body).stockRequest;
    expect(receipt.operation).toBe('RECEIPT');
    expect(receipt.movements).toHaveLength(3);
    expect(
      receipt.movements.every(
        ({ movementType, reason }) => movementType === 'RECEIPT' && reason === 'PO-2026-118',
      ),
    ).toBe(true);
    expect(await onHandOf(variant(2), receiptWarehouse)).toBe(6);

    const ledgerBefore = await ledgerOf(receiptWarehouse);
    const partlyUnknown = await receive(inventoryManager, newKey(), {
      warehouseId: receiptWarehouse,
      supplierReference: 'PO-2026-119',
      lines: [
        { variantId: variant(0), quantity: 1 },
        { variantId: unknownId, quantity: 1 },
      ],
    });
    expect(partlyUnknown.status).toBe(404);
    expect(await ledgerOf(receiptWarehouse)).toEqual(ledgerBefore);
    expect(await onHandOf(variant(0), receiptWarehouse)).toBe(4);
  });
});

describe('idempotency over HTTP', () => {
  it('replays the same key and body (200), refuses the same key with another body (422), and scopes keys to the staff member', async () => {
    const key = newKey();
    const body = {
      operation: 'ADD',
      variantId: variant(0),
      warehouseId,
      quantity: 2,
      reason: 'Found two',
    };
    const onHandBefore = await onHandOf(variant(0));
    const first = await adjust(inventoryManager, key, body);
    expect(first.status).toBe(201);
    const firstRequest = stockRequestBody.parse(first.body).stockRequest;

    // Same content written differently (key order, padded reason) is the same request.
    const repeat = await adjust(inventoryManager, key, {
      reason: '  Found two ',
      quantity: 2,
      warehouseId,
      variantId: variant(0),
      operation: 'ADD',
    });
    expect(repeat.status).toBe(200);
    const repeated = stockRequestBody.parse(repeat.body).stockRequest;
    expect(repeated).toMatchObject({
      replayed: true,
      changeRequestId: firstRequest.changeRequestId,
    });
    expect(repeated.movements).toEqual(firstRequest.movements);
    expect(await onHandOf(variant(0))).toBe(onHandBefore + 2);

    for (const other of [
      { ...body, quantity: 3 },
      { ...body, operation: 'REMOVE' },
    ]) {
      const reused = await adjust(inventoryManager, key, other);
      expect(reused.status, JSON.stringify(other)).toBe(422);
      expect(errorCode(reused.body)).toBe('IDEMPOTENCY_KEY_REUSED');
    }
    const asReceipt = await receive(inventoryManager, key, {
      warehouseId,
      supplierReference: 'SAME-KEY',
      lines: [{ variantId: variant(0), quantity: 2 }],
    });
    expect(asReceipt.status).toBe(422);
    expect(errorCode(asReceipt.body)).toBe('IDEMPOTENCY_KEY_REUSED');

    const colleague = await adjust(superAdmin, key, body);
    expect(colleague.status).toBe(201);
    expect(stockRequestBody.parse(colleague.body).stockRequest.changeRequestId).not.toBe(
      firstRequest.changeRequestId,
    );
    expect(await onHandOf(variant(0))).toBe(onHandBefore + 4);
  });

  it('replays a receipt whatever the order of its lines', async () => {
    const key = newKey();
    const lines = [
      { variantId: variant(0), quantity: 1 },
      { variantId: variant(1), quantity: 1 },
    ];
    const first = await receive(inventoryManager, key, {
      warehouseId,
      supplierReference: 'PO-ORDER',
      lines,
    });
    expect(first.status).toBe(201);
    const repeat = await receive(inventoryManager, key, {
      warehouseId,
      supplierReference: 'PO-ORDER',
      lines: [...lines].reverse(),
    });
    expect(repeat.status).toBe(200);
    expect(stockRequestBody.parse(repeat.body).stockRequest.changeRequestId).toBe(
      stockRequestBody.parse(first.body).stockRequest.changeRequestId,
    );
  });
});

describe('concurrent requests over HTTP', () => {
  it('applies one of ten simultaneous identical requests and replays the other nine', async () => {
    const concurrentWarehouse = await createWarehouse(`C${runId}`);
    const key = newKey();
    const body = {
      operation: 'ADD',
      variantId: variant(0),
      warehouseId: concurrentWarehouse,
      quantity: 1,
      reason: 'Double click',
    };
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => adjust(inventoryManager, key, body)),
    );
    expect(responses.map(({ status }) => status).sort()).toEqual([
      200, 200, 200, 200, 200, 200, 200, 200, 200, 201,
    ]);
    const changeRequestIds = new Set(
      responses.map(
        ({ body: responseBody }) =>
          stockRequestBody.parse(responseBody).stockRequest.changeRequestId,
      ),
    );
    expect(changeRequestIds.size).toBe(1);
    expect(await onHandOf(variant(0), concurrentWarehouse)).toBe(1);
    expect(await ledgerOf(concurrentWarehouse)).toHaveLength(1);
  });

  it('lets exactly 5 of 8 simultaneous one-unit removals through when 5 are on hand', async () => {
    const concurrentWarehouse = await createWarehouse(`K${runId}`);
    expect(
      (
        await receive(inventoryManager, newKey(), {
          warehouseId: concurrentWarehouse,
          supplierReference: 'PO-RACE',
          lines: [{ variantId: variant(1), quantity: 5 }],
        })
      ).status,
    ).toBe(201);
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        adjust(inventoryManager, newKey(), {
          operation: 'REMOVE',
          variantId: variant(1),
          warehouseId: concurrentWarehouse,
          quantity: 1,
          reason: `Picked ${String(index)}`,
        }),
      ),
    );
    const statuses = responses.map(({ status }) => status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(5);
    expect(statuses.filter((status) => status === 409)).toHaveLength(3);
    expect(await onHandOf(variant(1), concurrentWarehouse)).toBe(0);
  });

  it('runs simultaneous receipts and additions on the same rows and the ledger adds up', async () => {
    const concurrentWarehouse = await createWarehouse(`M${runId}`);
    const responses = await Promise.all([
      ...Array.from({ length: 4 }, (_, index) =>
        receive(inventoryManager, newKey(), {
          warehouseId: concurrentWarehouse,
          supplierReference: `PO-PAR-${String(index)}`,
          lines: [
            { variantId: variant(0), quantity: 2 },
            { variantId: variant(1), quantity: 3 },
          ],
        }),
      ),
      ...Array.from({ length: 4 }, () =>
        adjust(superAdmin, newKey(), {
          operation: 'ADD',
          variantId: variant(1),
          warehouseId: concurrentWarehouse,
          quantity: 1,
          reason: 'Found one',
        }),
      ),
    ]);
    expect(responses.every(({ status }) => status === 201)).toBe(true);
    expect(await onHandOf(variant(0), concurrentWarehouse)).toBe(8);
    expect(await onHandOf(variant(1), concurrentWarehouse)).toBe(16);
    const ledger = await ledgerOf(concurrentWarehouse);
    expect(ledger).toHaveLength(12);
    const totalDelta = ledger.reduce((sum, { quantityDelta }) => sum + quantityDelta, 0);
    expect(totalDelta).toBe(24);
  });
});

describe('queries over HTTP', () => {
  it('sets thresholds and lists low stock with its total, using the inventory rules', async () => {
    const lowWarehouse = await createWarehouse(`L${runId}`);
    expect(
      (
        await receive(inventoryManager, newKey(), {
          warehouseId: lowWarehouse,
          supplierReference: 'PO-LOW',
          lines: [
            { variantId: variant(0), quantity: 2 },
            { variantId: variant(1), quantity: 20 },
          ],
        })
      ).status,
    ).toBe(201);
    for (const [index, lowStockThreshold] of [
      [0, 5],
      [1, 5],
    ] as const) {
      const response = await callApi('put', 'admin', '/api/admin/inventory/thresholds', {
        cookie: inventoryManager,
        body: { variantId: variant(index), warehouseId: lowWarehouse, lowStockThreshold },
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ changed: true, stockLevel: { lowStockThreshold } });
    }
    const unchanged = await callApi('put', 'admin', '/api/admin/inventory/thresholds', {
      cookie: inventoryManager,
      body: { variantId: variant(0), warehouseId: lowWarehouse, lowStockThreshold: 5 },
    });
    expect(unchanged.body).toMatchObject({ changed: false });

    const low = await callApi(
      'get',
      'admin',
      `/api/admin/inventory/low-stock?warehouseId=${lowWarehouse}`,
      { cookie: support },
    );
    expect(low.status).toBe(200);
    const lowStock = lowStockBody.parse(low.body);
    expect(lowStock.items.map(({ variantId }) => variantId)).toEqual([variant(0)]);
    expect(lowStock.totalCount).toBe(1);

    const matrix = await callApi(
      'get',
      'admin',
      `/api/admin/inventory?warehouseId=${lowWarehouse}&lowStockOnly=true`,
      { cookie: support },
    );
    const rows = matrixBody
      .parse(matrix.body)
      .items.flatMap(({ variants }) => variants)
      .flatMap(({ variantId, levels }) => levels.map((level) => ({ variantId, ...level })));
    expect(rows.find(({ variantId }) => variantId === variant(0))).toMatchObject({
      onHandQuantity: 2,
      isLowStock: true,
    });

    // Deactivating the warehouse takes it out of the low-stock list unless asked for.
    await callApi('post', 'admin', `/api/admin/warehouses/${lowWarehouse}/status`, {
      cookie: inventoryManager,
      body: { isActive: false },
    });
    const afterDeactivation = lowStockBody.parse(
      (
        await callApi(
          'get',
          'admin',
          `/api/admin/inventory/low-stock?warehouseId=${lowWarehouse}`,
          { cookie: support },
        )
      ).body,
    );
    expect(afterDeactivation).toMatchObject({ items: [], totalCount: 0 });
    const included = lowStockBody.parse(
      (
        await callApi(
          'get',
          'admin',
          `/api/admin/inventory/low-stock?warehouseId=${lowWarehouse}&includeInactiveWarehouses=true`,
          { cookie: support },
        )
      ).body,
    );
    expect(included.totalCount).toBe(1);
  });

  it('filters and pages the ledger without skipping or repeating rows', async () => {
    const ledgerWarehouse = await createWarehouse(`G${runId}`);
    expect(
      (
        await receive(inventoryManager, newKey(), {
          warehouseId: ledgerWarehouse,
          supplierReference: 'PO-LEDGER',
          lines: [
            { variantId: variant(0), quantity: 3 },
            { variantId: variant(1), quantity: 3 },
            { variantId: variant(2), quantity: 3 },
          ],
        })
      ).status,
    ).toBe(201);
    for (const variantIndex of [0, 1]) {
      expect(
        (
          await adjust(inventoryManager, newKey(), {
            operation: 'REMOVE',
            variantId: variant(variantIndex),
            warehouseId: ledgerWarehouse,
            quantity: 1,
            reason: 'Sample',
          })
        ).status,
      ).toBe(201);
    }
    const all = await ledgerOf(ledgerWarehouse);
    expect(all).toHaveLength(5);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = `/api/admin/inventory/movements?warehouseId=${ledgerWarehouse}&limit=2${cursor === null ? '' : `&cursor=${cursor}`}`;
      const page = ledgerBody.parse(
        (await callApi('get', 'admin', query, { cookie: support })).body,
      );
      seen.push(...page.movements.map(({ movementId }) => movementId));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(all.map(({ movementId }) => movementId));

    const receipts = ledgerBody.parse(
      (
        await callApi(
          'get',
          'admin',
          `/api/admin/inventory/movements?warehouseId=${ledgerWarehouse}&movementType=RECEIPT`,
          { cookie: support },
        )
      ).body,
    );
    expect(receipts.movements).toHaveLength(3);
    const oneVariant = ledgerBody.parse(
      (
        await callApi(
          'get',
          'admin',
          `/api/admin/inventory/movements?warehouseId=${ledgerWarehouse}&variantId=${variant(0)}`,
          { cookie: support },
        )
      ).body,
    );
    expect(oneVariant.movements.map(({ movementType }) => movementType)).toEqual([
      'ADJUSTMENT',
      'RECEIPT',
    ]);
    const future = ledgerBody.parse(
      (
        await callApi(
          'get',
          'admin',
          `/api/admin/inventory/movements?warehouseId=${ledgerWarehouse}&createdFrom=2999-01-01T00:00:00Z`,
          { cookie: support },
        )
      ).body,
    );
    expect(future.movements).toEqual([]);
  });

  it('pages and searches the stock matrix, and never changes anything when read', async () => {
    const matrixWarehouse = await createWarehouse(`Q${runId}`);
    expect(
      (
        await receive(inventoryManager, newKey(), {
          warehouseId: matrixWarehouse,
          supplierReference: 'PO-MATRIX',
          lines: [{ variantId: variant(0), quantity: 1 }],
        })
      ).status,
    ).toBe(201);
    const sku = `INV-${runId}-S`;
    const searched = matrixBody.parse(
      (
        await callApi('get', 'admin', `/api/admin/inventory?search=${sku.toLowerCase()}`, {
          cookie: support,
        })
      ).body,
    );
    expect(searched.items).toHaveLength(1);
    expect(searched.items[0]?.variants.map(({ sku: variantSku }) => variantSku)).toContain(sku);

    const firstPage = matrixBody.parse(
      (await callApi('get', 'admin', '/api/admin/inventory?limit=1', { cookie: support })).body,
    );
    expect(firstPage.items).toHaveLength(1);
    if (firstPage.nextCursor !== null) {
      const secondPage = matrixBody.parse(
        (
          await callApi(
            'get',
            'admin',
            `/api/admin/inventory?limit=1&cursor=${firstPage.nextCursor}`,
            { cookie: support },
          )
        ).body,
      );
      expect(secondPage.items[0]?.productId).not.toBe(firstPage.items[0]?.productId);
    }

    const snapshot = async () => ({
      ledger: await ledgerOf(matrixWarehouse),
      onHand: await onHandOf(variant(0), matrixWarehouse),
      warehouse: (
        await callApi('get', 'admin', `/api/admin/warehouses/${matrixWarehouse}`, {
          cookie: support,
        })
      ).body as unknown,
    });
    const before = await snapshot();
    for (let round = 0; round < 3; round += 1) {
      for (const path of [
        '/api/admin/warehouses',
        `/api/admin/warehouses/${matrixWarehouse}`,
        `/api/admin/inventory?warehouseId=${matrixWarehouse}`,
        `/api/admin/inventory/movements?warehouseId=${matrixWarehouse}`,
        `/api/admin/inventory/low-stock?warehouseId=${matrixWarehouse}`,
      ]) {
        expect((await callApi('get', 'admin', path, { cookie: support })).status).toBe(200);
      }
    }
    expect(await snapshot()).toEqual(before);
  });
});

describe('letter case of ids over HTTP', () => {
  it('receives stock and sets thresholds for ids sent in upper case, and replays them in lower case', async () => {
    const caseWarehouse = await createWarehouse(`U${runId}`);
    const key = newKey();
    const upper = {
      warehouseId: caseWarehouse.toUpperCase(),
      supplierReference: 'PO-UPPER',
      lines: [{ variantId: variant(0).toUpperCase(), quantity: 3 }],
    };
    const received = await receive(inventoryManager, key, upper);
    expect(received.status, JSON.stringify(received.body)).toBe(201);
    const receipt = stockRequestBody.parse(received.body).stockRequest;
    expect(receipt.movements).toEqual([
      expect.objectContaining({
        variantId: variant(0),
        warehouseId: caseWarehouse,
        quantityDelta: 3,
        onHandAfter: 3,
      }),
    ]);
    const lowerRepeat = await receive(inventoryManager, key, {
      warehouseId: caseWarehouse,
      supplierReference: 'PO-UPPER',
      lines: [{ variantId: variant(0), quantity: 3 }],
    });
    expect(lowerRepeat.status).toBe(200);
    expect(stockRequestBody.parse(lowerRepeat.body).stockRequest.changeRequestId).toBe(
      receipt.changeRequestId,
    );
    expect(await onHandOf(variant(0), caseWarehouse)).toBe(3);

    const threshold = await callApi('put', 'admin', '/api/admin/inventory/thresholds', {
      cookie: inventoryManager,
      body: {
        variantId: variant(0).toUpperCase(),
        warehouseId: caseWarehouse.toUpperCase(),
        lowStockThreshold: 5,
      },
    });
    expect(threshold.status, JSON.stringify(threshold.body)).toBe(200);
    expect(threshold.body).toMatchObject({
      changed: true,
      stockLevel: { variantId: variant(0), warehouseId: caseWarehouse, lowStockThreshold: 5 },
    });
    const low = lowStockBody.parse(
      (
        await callApi(
          'get',
          'admin',
          `/api/admin/inventory/low-stock?warehouseId=${caseWarehouse}`,
          {
            cookie: support,
          },
        )
      ).body,
    );
    expect(low.items.map(({ variantId }) => variantId)).toEqual([variant(0)]);
  });

  it('refuses a receipt naming one variant twice in different letter case, leaving nothing behind', async () => {
    const caseWarehouse = await createWarehouse(`V${runId}`);
    const ledgerBefore = await ledgerOf(caseWarehouse);
    const key = newKey();
    const duplicate = await receive(inventoryManager, key, {
      warehouseId: caseWarehouse,
      supplierReference: 'PO-TWICE',
      lines: [
        { variantId: variant(1), quantity: 1 },
        { variantId: variant(1).toUpperCase(), quantity: 2 },
      ],
    });
    expect(duplicate.status).toBe(400);
    expect(errorEnvelope.parse(duplicate.body).error).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(JSON.stringify(duplicate.body)).toContain('Each variant once');
    expect(await ledgerOf(caseWarehouse)).toEqual(ledgerBefore);
    expect(await onHandOf(variant(1), caseWarehouse)).toBe(0);
    // The refused request stored no idempotency row: the same key now runs a different receipt.
    const valid = await receive(inventoryManager, key, {
      warehouseId: caseWarehouse,
      supplierReference: 'PO-ONCE',
      lines: [{ variantId: variant(1), quantity: 2 }],
    });
    expect(valid.status).toBe(201);
    expect(await onHandOf(variant(1), caseWarehouse)).toBe(2);
  });
});

describe('transaction timeout over HTTP', () => {
  it('answers 503 TRANSACTION_TIMEOUT when a stock row stays locked past the timeout, and a retry with the same key applies once', async () => {
    const timeoutWarehouse = await createWarehouse(`T${runId}`);
    expect(
      (
        await receive(inventoryManager, newKey(), {
          warehouseId: timeoutWarehouse,
          supplierReference: 'PO-TIMEOUT',
          lines: [{ variantId: variant(2), quantity: 2 }],
        })
      ).status,
    ).toBe(201);
    const ledgerBefore = await ledgerOf(timeoutWarehouse);
    const key = newKey();
    const body = {
      operation: 'ADD',
      variantId: variant(2),
      warehouseId: timeoutWarehouse,
      quantity: 1,
      reason: 'Blocked by a held lock',
    };

    const hold = await holdRowLocksOnTestDatabase(
      'SELECT 1 FROM inventory_levels WHERE variant_id = $1::uuid AND warehouse_id = $2::uuid FOR UPDATE',
      [variant(2), timeoutWarehouse],
    );
    expect(hold.lockedRows).toBe(1);
    let response: Awaited<ReturnType<typeof adjust>>;
    try {
      const pending = adjust(inventoryManager, key, body).then((result) => result);
      await hold.waitForWaiter();
      // The server's interactive transaction times out after Prisma's default 5 seconds.
      await new Promise((resolve) => setTimeout(resolve, 5_500));
      await hold.release();
      response = await pending;
    } catch (error) {
      await hold.release().catch(() => undefined);
      throw error;
    }

    expect(response.status).toBe(503);
    expect(response.headers['retry-after']).toBe('1');
    expect(errorEnvelope.parse(response.body).error).toEqual({
      code: 'TRANSACTION_TIMEOUT',
      message: 'The server was busy and nothing was changed. Try again.',
      details: { retryable: true },
    });
    expect(await ledgerOf(timeoutWarehouse)).toEqual(ledgerBefore);
    expect(await onHandOf(variant(2), timeoutWarehouse)).toBe(2);

    const retried = await adjust(inventoryManager, key, body);
    expect(retried.status).toBe(201);
    const replayed = await adjust(inventoryManager, key, body);
    expect(replayed.status).toBe(200);
    expect(await onHandOf(variant(2), timeoutWarehouse)).toBe(3);
  }, 30_000);
});

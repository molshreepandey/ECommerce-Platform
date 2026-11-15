import { randomInt, randomUUID } from 'node:crypto';

import { expect } from 'vitest';
import { z } from 'zod';

import { callApi, sessionCookieFrom } from '../app-server';
import { catalogueApi, idSchema } from './catalogue-api';

export interface Shopper {
  cookie: string;
  addressId: string;
  phone: string;
}

export interface SellableVariant {
  productId: string;
  productSlug: string;
  variantId: string;
  warehouseId: string;
  courierCode: string;
}

const summaryBody = z.object({
  summary: z.object({ breakdown: z.object({ totalPaise: z.number() }) }),
});

export const placedBody = z.object({
  order: z.object({ orderId: z.uuid(), orderNumber: z.string(), isReplay: z.boolean() }),
});

export const orderBody = z.object({
  order: z.object({
    status: z.string(),
    payment: z.object({ status: z.string() }),
    shipments: z.array(
      z.object({ id: z.uuid(), status: z.string(), awbNumber: z.string().nullable() }),
    ),
  }),
});

export function newKey(): string {
  return `http-${randomUUID()}`;
}

export async function registeredShopper(runId: string, pincode: string): Promise<Shopper> {
  const phone = `9${String(randomInt(100_000_000, 999_999_999))}`;
  const response = await callApi('post', 'store', '/api/store/auth/register', {
    body: {
      fullName: 'Http Shopper',
      email: `shopper.${runId}.${String(randomInt(1_000_000))}@example.test`,
      phone,
      password: 'Http-Test-Password-2026',
    },
  });
  expect(response.status).toBe(201);
  const cookie = sessionCookieFrom(response.headers['set-cookie'], 'store_session');
  const address = await callApi('post', 'store', '/api/store/account/addresses', {
    cookie,
    body: {
      recipientName: 'Http Shopper',
      phone: '9876543210',
      addressLine1: '12 MG Road',
      city: 'Pune',
      state: 'Maharashtra',
      pincode,
      isDefault: true,
    },
  });
  expect(address.status, JSON.stringify(address.body)).toBe(201);
  return {
    cookie,
    addressId: z.object({ address: idSchema }).parse(address.body).address.id,
    phone,
  };
}

export async function placeOrder(
  shopper: Shopper,
  variantId: string,
  paymentMethod: 'COD' | 'ONLINE',
  key = newKey(),
) {
  const added = await callApi('post', 'store', '/api/store/cart/items', {
    cookie: shopper.cookie,
    body: { variantId, quantity: 1 },
  });
  expect(added.status, JSON.stringify(added.body)).toBe(201);
  const summary = await callApi(
    'get',
    'store',
    `/api/store/checkout/summary?addressId=${shopper.addressId}&paymentMethod=${paymentMethod}`,
    { cookie: shopper.cookie },
  );
  expect(summary.status).toBe(200);
  const expectedTotalPaise = summaryBody.parse(summary.body).summary.breakdown.totalPaise;
  return callApi('post', 'store', '/api/store/checkout', {
    cookie: shopper.cookie,
    body: { addressId: shopper.addressId, paymentMethod, expectedTotalPaise },
  }).set('Idempotency-Key', key);
}

export async function createWarehouse(
  inventoryManager: string,
  code: string,
  priority: number,
): Promise<string> {
  const warehouse = await callApi('post', 'admin', '/api/admin/warehouses', {
    cookie: inventoryManager,
    body: {
      code: code.slice(0, 20),
      name: `Warehouse ${code}`.slice(0, 80),
      addressLine1: '1 Dock Road',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411002',
      contactName: 'Dock Keeper',
      contactPhone: '9876543210',
      priority,
    },
  });
  expect(warehouse.status, JSON.stringify(warehouse.body)).toBe(201);
  return z.object({ warehouse: idSchema }).parse(warehouse.body).warehouse.id;
}

export async function receiveStock(
  inventoryManager: string,
  input: { warehouseId: string; variantId: string; quantity: number; reference: string },
): Promise<void> {
  const receipt = await callApi('post', 'admin', '/api/admin/inventory/receipts', {
    cookie: inventoryManager,
    body: {
      warehouseId: input.warehouseId,
      supplierReference: input.reference,
      lines: [{ variantId: input.variantId, quantity: input.quantity }],
    },
  }).set('Idempotency-Key', newKey());
  expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
}

// An active product with one variant (Rs. 799), 20 units in a new warehouse, and a new COD courier that
// serves the pincode, all created through the real admin API.
export async function createSellableVariant(input: {
  runId: string;
  pincode: string;
  catalogueManager: string;
  inventoryManager: string;
  superAdmin: string;
}): Promise<SellableVariant> {
  const productSlug = `commerce-${input.runId}`;
  const productId = await catalogueApi(() => input.catalogueManager).createProduct(productSlug);
  const variant = await callApi('post', 'admin', `/api/admin/products/${productId}/variants`, {
    cookie: input.catalogueManager,
    body: {
      sku: `COM-${input.runId}-M`,
      optionValues: { size: 'M' },
      mrpPaise: 99_900,
      pricePaise: 79_900,
      weightGrams: 300,
      lengthMm: 300,
      breadthMm: 250,
      heightMm: 30,
    },
  });
  expect(variant.status, JSON.stringify(variant.body)).toBe(201);
  const variantId = z.object({ variant: idSchema }).parse(variant.body).variant.id;
  const detail = await callApi('get', 'admin', `/api/admin/products/${productId}`, {
    cookie: input.catalogueManager,
  });
  const version = z.object({ product: z.object({ version: z.number() }) }).parse(detail.body)
    .product.version;
  const activated = await callApi('post', 'admin', `/api/admin/products/${productId}/status`, {
    cookie: input.catalogueManager,
    body: { expectedVersion: version, status: 'ACTIVE' },
  });
  expect(activated.status, JSON.stringify(activated.body)).toBe(200);
  const warehouseId = await createWarehouse(input.inventoryManager, `C${input.runId}`, 1);
  await receiveStock(input.inventoryManager, {
    warehouseId,
    variantId,
    quantity: 20,
    reference: `PO-${input.runId}`,
  });
  const courierCode = `http-${input.runId}`.slice(0, 40);
  const courier = await callApi('post', 'admin', '/api/admin/courier-partners', {
    cookie: input.superAdmin,
    body: {
      code: courierCode,
      name: 'Http Express',
      priority: 1,
      supportsCod: true,
      isActive: true,
    },
  });
  expect(courier.status, JSON.stringify(courier.body)).toBe(201);
  const courierId = z.object({ courierPartner: idSchema }).parse(courier.body).courierPartner.id;
  const pincodeSaved = await callApi(
    'put',
    'admin',
    `/api/admin/courier-partners/${courierId}/pincodes`,
    {
      cookie: input.superAdmin,
      body: { pincode: input.pincode, codAvailable: true, maxCodValuePaise: 5_000_000, etaDays: 3 },
    },
  );
  expect(pincodeSaved.status, JSON.stringify(pincodeSaved.body)).toBe(204);
  return { productId, productSlug, variantId, warehouseId, courierCode };
}

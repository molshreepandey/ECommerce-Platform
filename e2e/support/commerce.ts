import { expect, type Page } from '@playwright/test';

import { demoPassword, signInThroughForm } from './auth';
import { adminOrigin } from './page-checks';

export interface ApiResult {
  status: number;
  body: unknown;
}

// A JSON call from inside the page, so it carries that page's session cookie and origin.
export async function api(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult> {
  return page.evaluate(
    async ({ method: httpMethod, path: url, body: payload, headers: extraHeaders }) => {
      const response = await fetch(url, {
        method: httpMethod,
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      const text = await response.text();
      return { status: response.status, body: (text === '' ? null : JSON.parse(text)) as unknown };
    },
    { method, path, body, headers },
  );
}

export function idOf(result: { body: unknown }, key: string): string {
  const value = (result.body as Record<string, { id?: string } | undefined>)[key]?.id;
  if (typeof value !== 'string') throw new Error(`no ${key} id in ${JSON.stringify(result.body)}`);
  return value;
}

export async function signInAdmin(page: Page, email: string) {
  await page.goto(`${adminOrigin}/login`);
  await signInThroughForm(page, email, demoPassword);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

export interface SellableProduct {
  productId: string;
  variantId: string;
  warehouseId: string;
}

// As the signed-in super admin: an active product with one Rs. 799 variant, stock in a new warehouse and
// a new COD courier serving pincode 411001 in 3 days.
export async function prepareSellableProduct(
  page: Page,
  input: { suffix: string; productName: string; productSlug: string; quantity: number },
): Promise<SellableProduct> {
  const { suffix } = input;
  const type = await api(page, 'POST', '/api/admin/product-types', {
    code: `journey_${suffix.toLowerCase()}`,
    name: `Journey ${suffix}`,
  });
  expect(type.status).toBe(201);
  const productTypeId = idOf(type, 'productType');
  const size = await api(
    page,
    'POST',
    `/api/admin/product-types/${productTypeId}/attribute-definitions`,
    {
      code: 'size',
      label: 'Size',
      dataType: 'ENUM',
      scope: 'VARIANT_OPTION',
      isRequired: true,
      allowedValues: ['S', 'M'],
    },
  );
  expect(size.status).toBe(201);
  const brand = await api(page, 'POST', '/api/admin/brands', {
    name: `Journey ${suffix}`,
    slug: `journey-${suffix.toLowerCase()}`,
  });
  const product = await api(page, 'POST', '/api/admin/products', {
    productTypeId,
    brandId: idOf(brand, 'brand'),
    name: input.productName,
    slug: input.productSlug,
    attributes: {},
    taxRateBasisPoints: 500,
  });
  expect(product.status).toBe(201);
  const productId = idOf(product, 'product');
  const variant = await api(page, 'POST', `/api/admin/products/${productId}/variants`, {
    sku: `JRN-${suffix}-M`,
    optionValues: { size: 'M' },
    mrpPaise: 99_900,
    pricePaise: 79_900,
    weightGrams: 300,
    lengthMm: 300,
    breadthMm: 250,
    heightMm: 30,
  });
  expect(variant.status).toBe(201);
  const variantId = idOf(variant, 'variant');
  const detail = await api(page, 'GET', `/api/admin/products/${productId}`);
  const version = (detail.body as { product: { version: number } }).product.version;
  expect(
    (
      await api(page, 'POST', `/api/admin/products/${productId}/status`, {
        expectedVersion: version,
        status: 'ACTIVE',
      })
    ).status,
  ).toBe(200);
  const warehouse = await api(page, 'POST', '/api/admin/warehouses', {
    code: `J-${suffix}`,
    name: `Journey hub ${suffix}`,
    addressLine1: '1 Dock Road',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411002',
    contactName: 'Dock Keeper',
    contactPhone: '9876543210',
    priority: 1,
  });
  expect(warehouse.status).toBe(201);
  const warehouseId = idOf(warehouse, 'warehouse');
  const receipt = await api(
    page,
    'POST',
    '/api/admin/inventory/receipts',
    {
      warehouseId,
      supplierReference: `PO-${suffix}`,
      lines: [{ variantId, quantity: input.quantity }],
    },
    { 'Idempotency-Key': `e2e-receipt-${suffix}-${Date.now().toString(36)}` },
  );
  expect(receipt.status).toBe(201);
  const courier = await api(page, 'POST', '/api/admin/courier-partners', {
    code: `e2e-${suffix.toLowerCase()}`,
    name: `Journey Express ${suffix}`,
    priority: 1,
    supportsCod: true,
    isActive: true,
  });
  expect(courier.status).toBe(201);
  const pincode = await api(
    page,
    'PUT',
    `/api/admin/courier-partners/${idOf(courier, 'courierPartner')}/pincodes`,
    { pincode: '411001', codAvailable: true, maxCodValuePaise: 5_000_000, etaDays: 3 },
  );
  expect(pincode.status).toBe(204);
  return { productId, variantId, warehouseId };
}

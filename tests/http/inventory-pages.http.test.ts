import { randomInt, randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { adminHost, callApi, getPage, visibleMarkup } from './app-server';
import { catalogueApi, idSchema, staffCookie } from './support/catalogue-api';
import { runOnTestDatabase } from './support/test-database-writer';

// Admin inventory pages (Wave 5 step 4), rendered by the server: who sees them, which write controls
// each role gets, and how bad filters are handled. Data is created for this run only.

const runId = `${Date.now().toString(36)}${randomInt(1_000_000).toString(36)}`.toUpperCase();

let inventoryManager = '';
let support = '';
let noInventory = '';
let warehouseId = '';
let variantId = '';
const sku = `PAGE-${runId}-M`;

async function page(path: string, cookie: string): Promise<string> {
  const response = await getPage(adminHost, path, cookie);
  expect(response.status, path).toBe(200);
  // React separates adjacent text pieces with <!-- --> in server-rendered HTML.
  return visibleMarkup(response.text).replaceAll('<!-- -->', '');
}

beforeAll(async () => {
  [inventoryManager, support] = await Promise.all([
    staffCookie('inventory.manager@demo-store.test'),
    staffCookie('support@demo-store.test'),
  ]);
  const email = `pages.no.inventory.${runId.toLowerCase()}@demo-store.test`;
  await runOnTestDatabase(
    `WITH new_role AS (
       INSERT INTO roles (code, name, description) VALUES ($1, 'Catalogue only', 'HTTP test role')
       RETURNING id),
     granted AS (
       INSERT INTO role_permissions (role_id, permission_id)
       SELECT new_role.id, permissions.id FROM new_role, permissions WHERE permissions.code = 'catalogue.read'),
     new_staff AS (
       INSERT INTO staff_users (full_name, email, password_hash)
       SELECT 'Catalogue Only', $2, password_hash FROM staff_users WHERE email = 'support@demo-store.test'
       RETURNING id)
     INSERT INTO staff_user_roles (staff_user_id, role_id)
     SELECT new_staff.id, new_role.id FROM new_staff, new_role`,
    [`PAGES_NO_INVENTORY_${runId}`, email],
  );
  noInventory = await staffCookie(email);

  const catalogueManager = await staffCookie('catalogue.manager@demo-store.test');
  const productId = await catalogueApi(() => catalogueManager).createProduct(
    `page-${runId.toLowerCase()}`,
  );
  const variant = await callApi('post', 'admin', `/api/admin/products/${productId}/variants`, {
    cookie: catalogueManager,
    body: {
      sku,
      optionValues: { size: 'M' },
      mrpPaise: 99_900,
      pricePaise: 79_900,
      weightGrams: 300,
      lengthMm: 300,
      breadthMm: 250,
      heightMm: 30,
    },
  });
  expect(variant.status).toBe(201);
  variantId = z.object({ variant: idSchema }).parse(variant.body).variant.id;
  const warehouse = await callApi('post', 'admin', '/api/admin/warehouses', {
    cookie: inventoryManager,
    body: {
      code: `PG${runId}`,
      name: `Page warehouse ${runId}`,
      addressLine1: '14, Industrial Area Phase 2',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560058',
      contactName: 'Store Keeper',
      contactPhone: '9876543210',
      priority: 80,
    },
  });
  expect(warehouse.status).toBe(201);
  warehouseId = z.object({ warehouse: idSchema }).parse(warehouse.body).warehouse.id;
  const receipt = await callApi('post', 'admin', '/api/admin/inventory/receipts', {
    cookie: inventoryManager,
    body: { warehouseId, supplierReference: `PO-${runId}`, lines: [{ variantId, quantity: 3 }] },
  }).set('Idempotency-Key', randomUUID());
  expect(receipt.status).toBe(201);
  const threshold = await callApi('put', 'admin', '/api/admin/inventory/thresholds', {
    cookie: inventoryManager,
    body: { variantId, warehouseId, lowStockThreshold: 5 },
  });
  expect(threshold.status).toBe(200);
});

describe('inventory pages for an inventory manager', () => {
  it('renders stock, movements, low stock and warehouses with write controls', async () => {
    const stock = await page(`/inventory?search=${sku}`, inventoryManager);
    expect(stock).toContain(sku);
    expect(stock).toContain('Receive stock');
    expect(stock).toContain(`Adjust stock of ${sku}`);
    expect(stock).toContain(`Low-stock threshold of ${sku}`);
    // The badge itself (the filter checkbox says "Only low stock").
    expect(stock).toMatch(/>low stock</);
    expect(stock).not.toContain('but not change it');

    const movements = await page(`/inventory/movements?variantId=${variantId}`, inventoryManager);
    expect(movements).toContain(`PO-${runId}`);
    expect(movements).toContain(`Showing one variant (${sku})`);

    const low = await page(`/inventory/low-stock?warehouseId=${warehouseId}`, inventoryManager);
    expect(low).toContain(sku);
    expect(low).toContain('1 item is at or below the alert level');

    const warehouses = await page('/warehouses', inventoryManager);
    expect(warehouses).toContain(`Page warehouse ${runId}`);
    expect(warehouses).toContain('New warehouse');
    expect(warehouses).toContain(`Deactivate Page warehouse ${runId}`);
  });

  it('shows the low-stock tile on the dashboard and the inventory entries in the menu', async () => {
    const dashboard = await page('/', inventoryManager);
    expect(dashboard).toContain('Low stock');
    expect(dashboard).toContain('View low stock');
    for (const href of [
      '/inventory',
      '/inventory/low-stock',
      '/inventory/movements',
      '/warehouses',
    ]) {
      expect(dashboard).toContain(`href="${href}"`);
    }
  });

  it('falls back to the first page with a notice for bad filters or an unknown page link', async () => {
    expect(await page('/inventory?limit=999', inventoryManager)).toContain(
      'Some filters in the address were not valid',
    );
    expect(await page(`/inventory?cursor=${randomUUID()}`, inventoryManager)).toContain(
      'That page link is no longer valid',
    );
    expect(await page('/inventory/movements?from=2026-02-30', inventoryManager)).toContain(
      'Some filters in the address were not valid',
    );
    expect(await page(`/inventory/movements?cursor=${randomUUID()}`, inventoryManager)).toContain(
      'That page link is no longer valid',
    );
    expect(await page('/inventory/low-stock?cursor=nope', inventoryManager)).toContain(
      'Some filters in the address were not valid',
    );
  });
});

describe('inventory pages for read-only and unauthorised staff', () => {
  it('lets support read every inventory page without any write control', async () => {
    const stock = await page(`/inventory?search=${sku}`, support);
    expect(stock).toContain(sku);
    expect(stock).toContain('You can view stock but not change it.');
    for (const control of ['Receive stock', `Adjust stock of ${sku}`, 'Threshold']) {
      expect(stock).not.toContain(control);
    }
    const warehouses = await page('/warehouses', support);
    expect(warehouses).toContain('You can view warehouses but not change it.');
    for (const control of ['New warehouse', 'Deactivate', 'Edit Page warehouse']) {
      expect(warehouses).not.toContain(control);
    }
    expect(await page('/inventory/movements', support)).toContain('Stock movements');
    expect(await page('/inventory/low-stock', support)).toContain('Low stock');
  });

  it('shows the access-denied state, no menu entries and no dashboard tile without inventory.read', async () => {
    for (const path of [
      '/inventory',
      '/inventory/movements',
      '/inventory/low-stock',
      '/warehouses',
    ]) {
      const markup = await page(path, noInventory);
      expect(markup, path).toContain('You do not have access to this page');
      expect(markup, path).not.toContain(sku);
    }
    const dashboard = await page('/', noInventory);
    expect(dashboard).not.toContain('View low stock');
    for (const href of [
      '/inventory',
      '/inventory/low-stock',
      '/inventory/movements',
      '/warehouses',
    ]) {
      expect(dashboard).not.toContain(`href="${href}"`);
    }
  });

  it('sends anonymous visitors to sign-in', async () => {
    for (const path of ['/inventory', '/warehouses']) {
      const response = await getPage(adminHost, path);
      expect([302, 303, 307, 308], path).toContain(response.status);
      expect(String(response.headers['location']), path).toContain('/login');
    }
  });
});

import { expect, test } from '@playwright/test';

import { expectNoHorizontalOverflow, visibleField, watchPageProblems } from './support/auth';
import { api, idOf, prepareSellableProduct, signInAdmin } from './support/commerce';
import { adminOrigin, projectLetter } from './support/page-checks';

// Wave 13 in the browser: staff management (D3), stock transfer (D27), re-categorise (D21), search
// index tools (D48), CSV export links (D8) and the product CSV section (D16), at desktop and 360 px.
test.describe.configure({ mode: 'serial' });

const runId = Date.now().toString(36).toUpperCase();
let suffix = '';
let productName = '';
let productTypeId = '';

test.beforeAll(async ({ browser }, testInfo) => {
  suffix = `${runId}${projectLetter(testInfo.project.name)}T`;
  productName = `Power Kurta ${suffix}`;
  const page = await browser.newPage();
  await signInAdmin(page, 'super.admin@demo-store.test');
  const sellable = await prepareSellableProduct(page, {
    suffix,
    productName,
    productSlug: `power-kurta-${suffix.toLowerCase()}`,
    quantity: 10,
  });
  const product = await api(page, 'GET', `/api/admin/products/${sellable.productId}`);
  productTypeId = (product.body as { product: { productTypeId: string } }).product.productTypeId;
  const second = await api(page, 'POST', '/api/admin/warehouses', {
    code: `T-${suffix}`,
    name: `Transfer hub ${suffix}`,
    addressLine1: '2 Dock Road',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411002',
    contactName: 'Dock Keeper',
    contactPhone: '9876543210',
    priority: 5,
  });
  expect(second.status).toBe(201);
  idOf(second, 'warehouse');
  await page.close();
});

test('super admin adds a staff member, changes their roles and deactivates them (D3)', async ({
  page,
}) => {
  const problems = watchPageProblems(page);
  await signInAdmin(page, 'super.admin@demo-store.test');
  await page.goto(`${adminOrigin}/staff`);
  await expect(page.getByRole('heading', { level: 1, name: 'Staff' })).toBeVisible();
  await page.getByRole('button', { name: 'Add staff member' }).first().click();
  const create = page.getByRole('dialog', { name: 'Add a staff member' });
  await create.getByLabel('Full name').fill(`Packer ${suffix}`);
  await create.getByLabel('Email').fill(`packer.${suffix.toLowerCase()}@example.test`);
  await create.getByLabel('Password').fill('Packer-Password-2026');
  await create.getByRole('checkbox', { name: 'Order operations' }).click();
  await create.getByRole('button', { name: 'Add staff member' }).click();
  const member = page
    .getByRole('list', { name: 'Staff members' })
    .filter({ visible: true })
    .getByRole('listitem')
    .filter({ hasText: `Packer ${suffix}`, visible: true });
  await expect(member.getByText('Order operations')).toBeVisible();
  await member.getByRole('button', { name: 'Change roles' }).click();
  const roles = page.getByRole('dialog', { name: `Roles of Packer ${suffix}` });
  await roles.getByRole('checkbox', { name: 'Order operations' }).click();
  await roles.getByRole('checkbox', { name: 'Support (read-only)' }).click();
  await roles.getByRole('button', { name: 'Save roles' }).click();
  await expect(member.getByText('Support (read-only)')).toBeVisible();
  await member.getByRole('button', { name: 'Deactivate' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click();
  await expect(member.getByText('deactivated', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(problems.uncaughtPageErrors).toEqual([]);
});

test('inventory manager transfers stock between warehouses (D27)', async ({ page }) => {
  const problems = watchPageProblems(page);
  await signInAdmin(page, 'inventory.manager@demo-store.test');
  await page.goto(`${adminOrigin}/inventory?search=${encodeURIComponent(productName)}`);
  await page
    .getByRole('button', { name: `Transfer stock for ${productName}` })
    .filter({ visible: true })
    .click();
  const dialog = page.getByRole('dialog', { name: `Transfer stock: ${productName}` });
  await dialog.getByLabel('Reason').fill('Move to the second hub');
  await dialog.getByLabel(`JRN-${suffix}-M`).fill('3');
  await dialog.getByRole('button', { name: 'Transfer stock' }).click();
  await expect(page.getByText('Stock transferred').first()).toBeVisible();
  await page.goto(`${adminOrigin}/inventory/movements`);
  await expect(page.getByText('Move to the second hub').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(problems.uncaughtPageErrors).toEqual([]);
});

test('catalogue manager sees re-categorise, product CSV tools; reports offer CSV exports (D21, D16, D8)', async ({
  page,
}) => {
  const problems = watchPageProblems(page);
  await signInAdmin(page, 'catalogue.manager@demo-store.test');
  await page.goto(`${adminOrigin}/tagging`);
  await expect(
    page.getByRole('heading', { name: 'Move all products between categories' }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.goto(`${adminOrigin}/product-types/${productTypeId}`);
  await expect(page.getByRole('heading', { name: 'Products by CSV' })).toBeVisible();
  await expect(visibleField(page, 'Products CSV')).toBeVisible();
  const exportLink = page.getByRole('link', { name: /Export products/ }).filter({ visible: true });
  await expect(exportLink).toHaveAttribute('download', '');
  await expectNoHorizontalOverflow(page);
  await page.goto(`${adminOrigin}/reports`);
  for (const name of ['Orders', 'Daily sales', 'GST summary', 'Stock by warehouse']) {
    await expect(
      page.getByRole('link', { name, exact: true }).filter({ visible: true }),
    ).toHaveAttribute('href', /\/api\/admin\/reports\/export\//);
  }
  await expectNoHorizontalOverflow(page);
  expect(problems.uncaughtPageErrors).toEqual([]);
});

test('super admin checks the search index and syncs it (D48)', async ({ page }) => {
  const problems = watchPageProblems(page);
  await signInAdmin(page, 'super.admin@demo-store.test');
  await page.goto(`${adminOrigin}/search-index`);
  await expect(page.getByRole('heading', { level: 1, name: 'Search index' })).toBeVisible();
  await expect(page.getByText('Elasticsearch: reachable').filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Queued changes synced').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(problems.uncaughtPageErrors).toEqual([]);
});

test('staff open the Swagger UI with every operation and no CSP violation (D49)', async ({
  page,
}) => {
  const problems = watchPageProblems(page);
  await signInAdmin(page, 'support@demo-store.test');
  await page.goto(`${adminOrigin}/docs`);
  await expect(page.getByRole('heading', { level: 1, name: 'API documentation' })).toBeVisible();
  await expect(page.getByText('E-Commerce Platform API').first()).toBeVisible({ timeout: 15_000 });
  // Swagger UI renders operations as they scroll into view: check the first ones are there, and that the
  // document it loaded (with this session) holds every operation.
  await expect(page.getByText('admin/attribute-definitions').first()).toBeVisible();
  await expect(page.locator('.opblock').first()).toBeVisible();
  const loaded = await page.request.get(`${adminOrigin}/api/admin/docs/openapi.json`);
  const document = (await loaded.json()) as { paths: Record<string, Record<string, unknown>> };
  const operationCount = Object.values(document.paths).reduce(
    (total, operations) => total + Object.keys(operations).length,
    0,
  );
  expect(operationCount).toBeGreaterThan(140);
  expect(problems.uncaughtPageErrors).toEqual([]);
  expect(problems.contentSecurityPolicyViolations).toEqual([]);
});

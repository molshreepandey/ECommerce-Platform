import { expect, type Locator, type Page, test } from '@playwright/test';

import {
  demoPassword,
  expectNoHorizontalOverflow,
  signInThroughForm,
  visibleField,
  watchPageProblems,
} from './support/auth';
import { adminOrigin } from './support/page-checks';

// Admin inventory UI (Wave 5 step 4). One chain per browser project (desktop and 360 px): a super admin
// prepares a product with two variants through the API, then an inventory manager works through the UI.
test.describe.configure({ mode: 'serial' });

const runId = Date.now().toString(36).toUpperCase();
let suffix = '';
let skuSmall = '';
let skuMedium = '';
let productName = '';
let warehouseCode = '';
let warehouseName = '';

async function signInAs(page: Page, email: string) {
  await page.goto(`${adminOrigin}/login`);
  await signInThroughForm(page, email, demoPassword);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

function toast(page: Page, text: string) {
  return page
    .getByRole('region', { name: /Notifications/ })
    .getByText(text, { exact: true })
    .last();
}

async function choose(scope: Page | Locator, page: Page, label: string, option: string | RegExp) {
  await scope.getByRole('combobox', { name: label }).filter({ visible: true }).click();
  await page.getByRole('option', { name: option }).click();
}

// Same-origin API call from the signed-in browser (cookie and Origin come with it).
async function api(page: Page, method: string, path: string, body: unknown) {
  return page.evaluate(
    async ({ method: httpMethod, path: url, body: payload }) => {
      const response = await fetch(url, {
        method: httpMethod,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return { status: response.status, body: (await response.json()) as unknown };
    },
    { method, path, body },
  );
}

function idOf(result: { body: unknown }, key: string): string {
  const value = (result.body as Record<string, { id?: string } | undefined>)[key]?.id;
  if (typeof value !== 'string') throw new Error(`no ${key} id in ${JSON.stringify(result.body)}`);
  return value;
}

function variantRow(page: Page, sku: string) {
  return page.getByRole('listitem', { name: sku, exact: true }).filter({ visible: true });
}

async function openStock(page: Page) {
  await page.goto(`${adminOrigin}/inventory?search=INV-${suffix}`);
  await expect(
    page.getByRole('listitem', { name: productName }).filter({ visible: true }),
  ).toBeVisible();
}

test.beforeAll(async ({ browser }, testInfo) => {
  suffix = `${runId}${testInfo.project.name.includes('360') ? 'M' : 'D'}`;
  skuSmall = `INV-${suffix}-S`;
  skuMedium = `INV-${suffix}-M`;
  productName = `Inventory Kurta ${suffix}`;
  warehouseCode = `E2E-${suffix}`;
  warehouseName = `Pune hub ${suffix}`;

  const page = await browser.newPage();
  await signInAs(page, 'super.admin@demo-store.test');
  const lower = suffix.toLowerCase();
  const type = await api(page, 'POST', '/api/admin/product-types', {
    code: `inv_${lower}`,
    name: `Inventory type ${suffix}`,
  });
  expect(type.status).toBe(201);
  const productTypeId = idOf(type, 'productType');
  const sizes = await api(
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
  expect(sizes.status).toBe(201);
  const brand = await api(page, 'POST', '/api/admin/brands', {
    name: `Inventory brand ${suffix}`,
    slug: `inv-brand-${lower}`,
  });
  expect(brand.status).toBe(201);
  const product = await api(page, 'POST', '/api/admin/products', {
    productTypeId,
    brandId: idOf(brand, 'brand'),
    name: productName,
    slug: `inventory-kurta-${lower}`,
    attributes: {},
    taxRateBasisPoints: 500,
  });
  expect(product.status).toBe(201);
  const productId = idOf(product, 'product');
  for (const [size, sku] of [
    ['S', skuSmall],
    ['M', skuMedium],
  ] as const) {
    const variant = await api(page, 'POST', `/api/admin/products/${productId}/variants`, {
      sku,
      optionValues: { size },
      mrpPaise: 99_900,
      pricePaise: 79_900,
      weightGrams: 300,
      lengthMm: 300,
      breadthMm: 250,
      heightMm: 30,
    });
    expect(variant.status).toBe(201);
  }
  await page.close();
});

test('an inventory manager creates, edits, deactivates and reactivates a warehouse', async ({
  page,
}) => {
  const problems = watchPageProblems(page);
  await signInAs(page, 'inventory.manager@demo-store.test');

  await test.step('create a warehouse, with validation first', async () => {
    await page.getByRole('link', { name: 'Warehouses' }).filter({ visible: true }).click();
    await page.getByRole('button', { name: 'New warehouse' }).click();
    const dialog = page.getByRole('dialog', { name: 'New warehouse' });
    await dialog.getByRole('button', { name: 'Save warehouse' }).click();
    await expect(dialog.getByText('Enter a name')).toBeVisible();
    await dialog.getByLabel('Code', { exact: true }).fill(warehouseCode);
    await dialog.getByLabel('Name', { exact: true }).fill(`${warehouseName} draft`);
    await dialog.getByLabel('Address line 1', { exact: true }).fill('Plot 7, Chakan MIDC');
    await dialog.getByLabel('City', { exact: true }).fill('Pune');
    await dialog.getByLabel('State', { exact: true }).fill('Maharashtra');
    await dialog.getByLabel('Pincode', { exact: true }).fill('410501');
    await dialog.getByLabel('Contact name', { exact: true }).fill('Rahul Patil');
    await dialog.getByLabel('Contact mobile', { exact: true }).fill('9876512345');
    await dialog.getByLabel('Priority', { exact: true }).fill('900');
    await dialog.getByRole('button', { name: 'Save warehouse' }).click();
    await expect(toast(page, 'Warehouse created')).toBeVisible();
    await expect(dialog).toBeHidden();
  });

  await test.step('edit it, then deactivate and reactivate it with confirmation', async () => {
    await page.getByRole('button', { name: `Edit ${warehouseName} draft` }).click();
    const dialog = page.getByRole('dialog', { name: `Edit ${warehouseName} draft` });
    await dialog.getByLabel('Name', { exact: true }).fill(warehouseName);
    await dialog.getByRole('button', { name: 'Save warehouse' }).click();
    await expect(toast(page, 'Warehouse updated')).toBeVisible();
    // Wait for the list to show the new name: the old card's buttons share the new name as a prefix.
    const card = page.getByRole('listitem', { name: `${warehouseName} (${warehouseCode})` });
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: `Deactivate ${warehouseName}`, exact: true }).click();
    const confirm = page.getByRole('dialog', { name: `Deactivate ${warehouseName}?` });
    await expect(confirm).toContainText('existing reservations are kept');
    await confirm.getByRole('button', { name: 'Deactivate' }).click();
    await expect(toast(page, 'Warehouse deactivated')).toBeVisible();
    await expect(card.getByText('inactive', { exact: true })).toBeVisible();

    await card.getByRole('button', { name: `Activate ${warehouseName}`, exact: true }).click();
    await page
      .getByRole('dialog', { name: `Activate ${warehouseName}?` })
      .getByRole('button', { name: 'Activate' })
      .click();
    await expect(toast(page, 'Warehouse activated')).toBeVisible();
    await expect(card.getByText('active', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  expect(problems.uncaughtPageErrors).toEqual([]);
  expect(problems.contentSecurityPolicyViolations).toEqual([]);
});

test('an inventory manager receives stock, adjusts it with conflicts and sets an alert level', async ({
  page,
}) => {
  const problems = watchPageProblems(page);
  await signInAs(page, 'inventory.manager@demo-store.test');

  await test.step('receive a supplier delivery for both variants', async () => {
    await openStock(page);
    await expect(variantRow(page, skuSmall).getByText('No stock recorded yet.')).toBeVisible();
    await page.getByRole('button', { name: `Receive stock for ${productName}` }).click();
    const dialog = page.getByRole('dialog', { name: `Receive stock: ${productName}` });
    await choose(dialog, page, 'Warehouse', new RegExp(warehouseCode));
    await dialog.getByRole('button', { name: 'Receive stock' }).click();
    await expect(dialog.getByText('Enter a quantity for at least one variant.')).toBeVisible();
    await dialog.getByLabel('Supplier reference', { exact: true }).fill(`PO-${suffix}`);
    await dialog.getByLabel(skuSmall, { exact: true }).fill('10');
    await dialog.getByLabel(skuMedium, { exact: true }).fill('4');
    await dialog.getByRole('button', { name: 'Receive stock' }).click();
    await expect(toast(page, 'Stock received')).toBeVisible();
    await expect(dialog).toBeHidden();
    const small = variantRow(page, skuSmall);
    await expect(small.getByText(warehouseCode, { exact: true })).toBeVisible();
    await expect(small.locator('dd').first()).toHaveText('10');
  });

  await test.step('a removal below zero is refused with the numbers, a smaller one works', async () => {
    await page.getByRole('button', { name: `Adjust stock of ${skuSmall}` }).click();
    const dialog = page.getByRole('dialog', { name: `Adjust stock: ${skuSmall}` });
    await expect(dialog.getByText('On hand here now:')).toContainText('10');
    await choose(dialog, page, 'Change', 'Remove stock');
    await dialog.getByLabel('Quantity', { exact: true }).fill('50');
    await dialog.getByLabel('Reason', { exact: true }).fill('Damaged in monsoon');
    await dialog.getByRole('button', { name: 'Remove stock' }).click();
    await expect(dialog.getByText('You cannot remove more than is on hand (10).')).toBeVisible();
    await dialog.getByLabel('Quantity', { exact: true }).fill('3');
    await dialog.getByRole('button', { name: 'Remove stock' }).click();
    await expect(toast(page, 'Stock removed')).toBeVisible();
    await expect(variantRow(page, skuSmall).locator('dd').first()).toHaveText('7');
  });

  await test.step('set a counted quantity and an alert level that makes a variant low', async () => {
    await page.getByRole('button', { name: `Adjust stock of ${skuSmall}` }).click();
    const dialog = page.getByRole('dialog', { name: `Adjust stock: ${skuSmall}` });
    await choose(dialog, page, 'Change', 'Set counted quantity');
    await dialog.getByLabel('Counted quantity on hand', { exact: true }).fill('20');
    await dialog.getByLabel('Reason', { exact: true }).fill('Cycle count');
    await dialog.getByRole('button', { name: 'Set counted quantity' }).click();
    await expect(toast(page, 'Stock quantity set')).toBeVisible();
    await expect(variantRow(page, skuSmall).locator('dd').first()).toHaveText('20');

    await page.getByRole('button', { name: `Low-stock threshold of ${skuMedium}` }).click();
    const threshold = page.getByRole('dialog', { name: `Low-stock threshold: ${skuMedium}` });
    await threshold.getByLabel('Alert when available is at or below', { exact: true }).fill('5');
    await threshold.getByRole('button', { name: 'Save threshold' }).click();
    await expect(toast(page, 'Low-stock threshold saved')).toBeVisible();
    await expect(variantRow(page, skuMedium).getByText('low stock', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  expect(problems.uncaughtPageErrors).toEqual([]);
  expect(problems.contentSecurityPolicyViolations).toEqual([]);
});

test('the history and the low-stock view show the changes, reached from the dashboard tile', async ({
  page,
}) => {
  const problems = watchPageProblems(page);
  await signInAs(page, 'inventory.manager@demo-store.test');

  await test.step('see every change in the movement history of the variant', async () => {
    await openStock(page);
    await page.getByRole('link', { name: `History of ${skuSmall}` }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Stock movements' })).toBeVisible();
    const movements = page.getByRole('list', { name: 'Stock movements' }).filter({ visible: true });
    await expect(movements.getByRole('listitem')).toHaveCount(3);
    await expect(movements.getByText('Cycle count')).toBeVisible();
    await expect(movements.getByText('Damaged in monsoon')).toBeVisible();
    await expect(movements.getByText(`PO-${suffix}`)).toBeVisible();
    await choose(page, page, 'Movement type', 'Receipt');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(movements.getByRole('listitem')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
  });

  await test.step('find the low variant from the dashboard tile', async () => {
    await page.getByRole('link', { name: 'Dashboard' }).filter({ visible: true }).click();
    await page.getByRole('link', { name: 'View low stock' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Low stock' })).toBeVisible();
    await choose(page, page, 'Warehouse', new RegExp(warehouseCode));
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByText('1 item is at or below the alert level')).toBeVisible();
    await expect(page.getByRole('link', { name: skuMedium })).toBeVisible();
    await expect(page.getByRole('link', { name: skuSmall })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  expect(problems.uncaughtPageErrors).toEqual([]);
  expect(problems.contentSecurityPolicyViolations).toEqual([]);
});

test('a counted quantity based on an old screen is refused, and the dialog shows the new number', async ({
  browser,
}) => {
  const first = await browser.newPage();
  const second = await browser.newPage();
  for (const page of [first, second]) {
    await signInAs(page, 'inventory.manager@demo-store.test');
    await openStock(page);
    await page.getByRole('button', { name: `Adjust stock of ${skuSmall}` }).click();
    await choose(
      page.getByRole('dialog', { name: `Adjust stock: ${skuSmall}` }),
      page,
      'Change',
      'Set counted quantity',
    );
  }
  const firstDialog = first.getByRole('dialog', { name: `Adjust stock: ${skuSmall}` });
  await firstDialog.getByLabel('Counted quantity on hand', { exact: true }).fill('25');
  await firstDialog.getByLabel('Reason', { exact: true }).fill('Recount by first clerk');
  await firstDialog.getByRole('button', { name: 'Set counted quantity' }).click();
  await expect(toast(first, 'Stock quantity set')).toBeVisible();

  const secondDialog = second.getByRole('dialog', { name: `Adjust stock: ${skuSmall}` });
  await secondDialog.getByLabel('Counted quantity on hand', { exact: true }).fill('18');
  await secondDialog.getByLabel('Reason', { exact: true }).fill('Recount by second clerk');
  await secondDialog.getByRole('button', { name: 'Set counted quantity' }).click();
  await expect(
    secondDialog.getByText(
      'The stock changed while you were editing: on hand is now 25, not 20. Check the new number and try again.',
    ),
  ).toBeVisible();
  await expect(secondDialog.getByText('On hand here now:')).toContainText('25');
  await secondDialog.getByRole('button', { name: 'Set counted quantity' }).click();
  await expect(toast(second, 'Stock quantity set')).toBeVisible();
  await expect(variantRow(second, skuSmall).locator('dd').first()).toHaveText('18');
  await first.close();
  await second.close();
});

test('read-only support staff see inventory and warehouses without any write control', async ({
  page,
}) => {
  await signInAs(page, 'support@demo-store.test');
  await openStock(page);
  await expect(
    page.getByText('You can view stock but not change it.').filter({ visible: true }),
  ).toBeVisible();
  for (const name of [
    `Receive stock for ${productName}`,
    `Adjust stock of ${skuSmall}`,
    `Low-stock threshold of ${skuMedium}`,
  ]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await expect(page.getByRole('link', { name: `History of ${skuSmall}` })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto(`${adminOrigin}/warehouses`);
  await expect(
    page.getByRole('listitem', { name: `${warehouseName} (${warehouseCode})` }),
  ).toBeVisible();
  for (const name of ['New warehouse', `Edit ${warehouseName}`, `Deactivate ${warehouseName}`]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await expect(visibleField(page, 'Code')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('a change whose answer was lost is not applied twice when it is sent again from a reopened dialog', async ({
  page,
}) => {
  await signInAs(page, 'inventory.manager@demo-store.test');
  await openStock(page);
  const medium = variantRow(page, skuMedium);
  await expect(medium.locator('dd').first()).toHaveText('4');

  // The server applies the first adjustment, but the browser is told 502 (a lost answer).
  await page.route(
    '**/api/admin/inventory/adjustments',
    async (route) => {
      await route.fetch();
      await route.fulfill({
        status: 502,
        contentType: 'text/html',
        body: '<html>Bad gateway</html>',
      });
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: `Adjust stock of ${skuMedium}` }).click();
  let dialog = page.getByRole('dialog', { name: `Adjust stock: ${skuMedium}` });
  await dialog.getByLabel('Quantity', { exact: true }).fill('2');
  await dialog.getByLabel('Reason', { exact: true }).fill('Delivery recounted');
  await dialog.getByRole('button', { name: 'Add stock' }).click();
  await expect(dialog.getByText(/did not confirm this change/)).toBeVisible();
  // The page refreshes after an unknown outcome, so the dialog (and the page behind it, hidden from
  // assistive technology while the dialog is open) shows what was really saved.
  await expect(dialog.getByText('On hand here now:')).toContainText('6');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(medium.locator('dd').first()).toHaveText('6');

  await page.getByRole('button', { name: `Adjust stock of ${skuMedium}` }).click();
  dialog = page.getByRole('dialog', { name: `Adjust stock: ${skuMedium}` });
  await dialog.getByLabel('Quantity', { exact: true }).fill('2');
  await dialog.getByLabel('Reason', { exact: true }).fill('Delivery recounted');
  const resent = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/inventory/adjustments') &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Add stock' }).click();
  // The same change sent again carries the same key, so the server replays it (200) instead of applying
  // it a second time (201).
  const response = await resent;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ stockRequest: { replayed: true } });
  await expect(toast(page, 'Stock added')).toBeVisible();
  await openStock(page);
  await expect(variantRow(page, skuMedium).locator('dd').first()).toHaveText('6');

  await test.step('with a warehouse filter, the dialogs offer only that warehouse', async () => {
    await choose(page, page, 'Warehouse', new RegExp(warehouseCode));
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page).toHaveURL(/warehouseId=/);
    await page.getByRole('button', { name: `Adjust stock of ${skuMedium}` }).click();
    const filtered = page.getByRole('dialog', { name: `Adjust stock: ${skuMedium}` });
    await filtered.getByRole('combobox', { name: 'Warehouse' }).click();
    await expect(page.getByRole('option')).toHaveCount(1);
    await expect(page.getByRole('option', { name: new RegExp(warehouseCode) })).toBeVisible();
  });
});

test("a warehouse edit keeps a colleague's change to another field", async ({ page }) => {
  await signInAs(page, 'inventory.manager@demo-store.test');
  await page.goto(`${adminOrigin}/warehouses`);
  const card = page.getByRole('listitem', { name: `${warehouseName} (${warehouseCode})` });
  await card.getByRole('button', { name: `Edit ${warehouseName}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Edit ${warehouseName}` });
  await expect(dialog.getByLabel('Contact mobile', { exact: true })).toHaveValue('9876512345');

  // A colleague changes the contact mobile while this dialog is open.
  const colleague = await page.evaluate(async (code) => {
    const list = (await (await fetch('/api/admin/warehouses')).json()) as {
      warehouses: { id: string; code: string }[];
    };
    const id = list.warehouses.find((warehouse) => warehouse.code === code)?.id;
    const response = await fetch(`/api/admin/warehouses/${String(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactPhone: '9123456789' }),
    });
    return response.status;
  }, warehouseCode);
  expect(colleague).toBe(200);

  await dialog.getByLabel('Priority', { exact: true }).fill('901');
  await dialog.getByRole('button', { name: 'Save warehouse' }).click();
  await expect(toast(page, 'Warehouse updated')).toBeVisible();
  await expect(card.getByText(`${warehouseCode} · priority 901`)).toBeVisible();
  await expect(card.getByText('Contact: Rahul Patil, 9123456789')).toBeVisible();
});

import { expect, type Page, test } from '@playwright/test';

import { accessibilityProblems } from './support/accessibility';
import { demoPassword, visibleField } from './support/auth';
import { api, prepareSellableProduct, signInAdmin } from './support/commerce';
import { adminOrigin, projectLetter, storeOrigin } from './support/page-checks';

// Wave 14: every main page passes the in-page accessibility audit at each width (desktop, 360 px,
// tablet), and the key flows work with the keyboard alone. Wave 16: search suggestions by keyboard.
test.describe.configure({ mode: 'serial' });

const runId = Date.now().toString(36).toUpperCase();
let suffix = '';
let productName = '';
let productSlug = '';

async function auditPage(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 }).filter({ visible: true })).toBeVisible();
  expect(await accessibilityProblems(page), url).toEqual([]);
}

test.beforeAll(async ({ browser }, testInfo) => {
  suffix = `${runId}${projectLetter(testInfo.project.name)}A`;
  productName = `Keyboard Kurta ${suffix}`;
  productSlug = `keyboard-kurta-${suffix.toLowerCase()}`;
  const page = await browser.newPage();
  await signInAdmin(page, 'super.admin@demo-store.test');
  await prepareSellableProduct(page, { suffix, productName, productSlug, quantity: 5 });
  expect((await api(page, 'POST', '/api/admin/search-index/sync')).status).toBe(200);
  await page.close();
});

test('store pages pass the accessibility audit', async ({ page }) => {
  for (const path of ['/login', '/register']) await auditPage(page, `${storeOrigin}${path}`);
  await page.goto(`${storeOrigin}/`);
  const registered = await api(page, 'POST', '/api/store/auth/register', {
    fullName: 'Audit Customer',
    email: `audit.${suffix.toLowerCase()}@example.test`,
    phone: `9${String(Math.floor(100_000_000 + Math.random() * 899_999_999))}`,
    password: 'Audit-Password-2026',
  });
  expect(registered.status).toBe(201);
  for (const path of [
    '/',
    '/search?q=kurta',
    '/categories',
    `/products/${productSlug}`,
    '/cart',
    '/account',
    '/orders',
  ]) {
    await auditPage(page, `${storeOrigin}${path}`);
  }
});

test('admin pages pass the accessibility audit', async ({ page }) => {
  await auditPage(page, `${adminOrigin}/login`);
  await signInAdmin(page, 'super.admin@demo-store.test');
  for (const path of [
    '/',
    '/orders',
    '/returns',
    '/customers',
    '/products',
    '/categories',
    '/tagging',
    '/inventory',
    '/warehouses',
    '/couriers',
    '/coupons',
    '/reports',
    '/audit',
    '/settings',
    '/staff',
    '/search-index',
  ]) {
    await auditPage(page, `${adminOrigin}${path}`);
  }
});

test('the skip link is the first stop and moves focus to the page content', async ({ page }) => {
  for (const url of [`${storeOrigin}/`, `${adminOrigin}/login`]) {
    await page.goto(url);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    if (url.endsWith('/login')) {
      // The sign-in page has no navigation to skip: its first stop is the first field.
      await expect(skip).toHaveCount(0);
      continue;
    }
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  }
});

test('staff sign in and open a dialog with the keyboard alone; Escape closes it', async ({
  page,
}) => {
  await page.goto(`${adminOrigin}/login`);
  await visibleField(page, 'Email').focus();
  await page.keyboard.type('super.admin@demo-store.test');
  await page.keyboard.press('Tab');
  await page.keyboard.type(demoPassword);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await page.goto(`${adminOrigin}/staff`);
  const trigger = page.getByRole('button', { name: 'Add staff member' }).first();
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add a staff member' });
  await expect(dialog).toBeVisible();
  // Focus moves into the dialog (and is trapped there until it closes).
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press('Tab');
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('search suggestions work with the keyboard (C14)', async ({ page }) => {
  await page.goto(`${storeOrigin}/`);
  const search = page.getByRole('combobox', { name: 'Search products' }).filter({ visible: true });
  await search.fill(productName);
  const suggestions = page.getByRole('listbox', { name: 'Search suggestions' });
  await expect(suggestions.getByRole('option', { name: new RegExp(productName) })).toBeVisible();
  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', /option-0$/);
  await expect(search).toHaveAttribute('aria-expanded', 'true');
  await search.press('Escape');
  await expect(search).toHaveAttribute('aria-expanded', 'false');
  await search.fill(productName);
  await expect(suggestions.getByRole('option', { name: new RegExp(productName) })).toBeVisible();
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/products/${productSlug}$`));
  expect(await accessibilityProblems(page)).toEqual([]);
});

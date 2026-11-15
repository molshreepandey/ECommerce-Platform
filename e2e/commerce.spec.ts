import { expect, test } from '@playwright/test';

import { expectNoHorizontalOverflow, visibleField, watchPageProblems } from './support/auth';
import { api, prepareSellableProduct, signInAdmin } from './support/commerce';
import { adminOrigin, projectLetter, storeOrigin } from './support/page-checks';

// Customer and admin journeys (Waves 6–10): a super admin prepares a product, stock and a courier through
// the API; a new customer registers, finds the product, adds it to the cart and checks out with Cash on
// Delivery; order operations then fulfil the order to delivery with the demo courier scans.
test.describe.configure({ mode: 'serial' });

const runId = Date.now().toString(36).toUpperCase();
let suffix = '';
let productName = '';
let productSlug = '';
let customerEmail = '';
let orderNumber = '';

test.beforeAll(async ({ browser }, testInfo) => {
  suffix = `${runId}${projectLetter(testInfo.project.name)}`;
  productName = `Journey Kurta ${suffix}`;
  productSlug = `journey-kurta-${suffix.toLowerCase()}`;
  customerEmail = `journey.${suffix.toLowerCase()}@example.test`;
  const page = await browser.newPage();
  await signInAdmin(page, 'super.admin@demo-store.test');
  await prepareSellableProduct(page, { suffix, productName, productSlug, quantity: 10 });
  await page.close();
});

test('customer journey: register → product → cart → checkout (COD) → confirmation → orders', async ({
  page,
}) => {
  const problems = watchPageProblems(page);
  await page.goto(`${storeOrigin}/register`);
  await visibleField(page, 'Full name').fill('Journey Customer');
  await visibleField(page, 'Email').fill(customerEmail);
  await visibleField(page, 'Mobile number').fill(`9${String(Date.now()).slice(-9)}`);
  await visibleField(page, 'Password').fill('Journey-Password-2026');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/account/);
  const address = await api(page, 'POST', '/api/store/account/addresses', {
    recipientName: 'Journey Customer',
    phone: '9876543210',
    addressLine1: '12 MG Road',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411001',
    isDefault: true,
  });
  expect(address.status).toBe(201);

  await page.goto(`${storeOrigin}/categories`);
  await expect(page.getByRole('heading', { level: 1, name: 'All categories' })).toBeVisible();
  await page.goto(`${storeOrigin}/products/${productSlug}`);
  await expect(page.getByRole('heading', { level: 1, name: productName })).toBeVisible();
  await expect(page.getByText('In stock').filter({ visible: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Add to cart' }).filter({ visible: true }).click();
  await expect(
    page.getByRole('link', { name: /Cart, 1 item/ }).filter({ visible: true }),
  ).toBeVisible();

  await page.goto(`${storeOrigin}/cart`);
  await expect(page.getByRole('heading', { level: 1, name: 'Your cart' })).toBeVisible();
  await page
    .getByRole('button', { name: 'Increase quantity of ' + productName })
    .filter({ visible: true })
    .click();
  await expect(page.getByRole('heading', { name: '2 items' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('link', { name: 'Checkout' }).filter({ visible: true }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Checkout' })).toBeVisible();
  await page.getByRole('radio', { name: /Cash on Delivery/ }).click();
  const placeButton = page.getByRole('button', { name: /Place order/ }).filter({ visible: true });
  await expect(placeButton).toBeEnabled();
  await placeButton.click();
  await expect(page.getByText(/Your order ORD-\d+ is placed/)).toBeVisible();
  orderNumber =
    (await page.getByRole('heading', { level: 1 }).filter({ visible: true }).textContent())
      ?.replace('Order ', '')
      .trim() ?? '';
  expect(orderNumber).toMatch(/^ORD-\d+$/);

  await page.goto(`${storeOrigin}/orders`);
  await expect(page.getByRole('link', { name: orderNumber })).toBeVisible();
  expect(problems.uncaughtPageErrors).toEqual([]);
  expect(problems.contentSecurityPolicyViolations).toEqual([]);
});

test('admin journey: find the order → confirm → pack → AWB → simulated scans → delivered; dashboard and audit', async ({
  page,
}) => {
  const problems = watchPageProblems(page);
  await signInAdmin(page, 'order.ops@demo-store.test');
  await page.goto(`${adminOrigin}/orders?q=${orderNumber}`);
  await page.getByRole('link', { name: orderNumber }).click();
  await expect(page.getByRole('heading', { name: orderNumber })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm order' }).click();
  await page.getByRole('button', { name: 'Mark packed' }).click();
  await page.getByRole('button', { name: 'Create AWB with courier' }).click();
  await expect(page.getByRole('link', { name: 'Download label (PDF)' })).toBeVisible();
  await page.getByRole('button', { name: 'Simulate pickup scan' }).click();
  await page.getByRole('button', { name: 'Simulate next scan' }).click();
  await page.getByRole('button', { name: 'Simulate delivered scan' }).click();
  await expect(page.getByText('Delivered to the customer').first()).toBeVisible();
  await expect(page.getByText('COD · collected').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto(`${adminOrigin}/`);
  await expect(page.getByRole('list', { name: 'Key figures' })).toBeVisible();
  await page.goto(`${adminOrigin}/reports`);
  await expect(page.getByText('balanced', { exact: true }).filter({ visible: true })).toBeVisible();
  expect(problems.uncaughtPageErrors).toEqual([]);
});

test('super admin reviews the audit trail and the customer record', async ({ page }) => {
  await signInAdmin(page, 'super.admin@demo-store.test');
  await page.goto(`${adminOrigin}/audit?action=order.`);
  await expect(page.getByText('order.placed').first()).toBeVisible();
  await page.goto(`${adminOrigin}/customers?q=${customerEmail}`);
  await page.getByRole('link', { name: 'Journey Customer' }).click();
  await expect(page.getByRole('button', { name: 'Block customer' })).toBeVisible();
});

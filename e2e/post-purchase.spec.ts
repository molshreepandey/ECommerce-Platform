import { type Browser, expect, type Page, test } from '@playwright/test';

import { expectNoHorizontalOverflow, visibleField, watchPageProblems } from './support/auth';
import { api, idOf, prepareSellableProduct, signInAdmin } from './support/commerce';
import { adminOrigin, projectLetter, storeOrigin } from './support/page-checks';

// Waves 11–12 in the browser: home banner, collection page and pincode check; OTP sign-in with the demo
// popup; a delivered order reviewed and returned by the customer; the returns queue run to a refund by
// order operations; bulk confirm with per-row results; the new admin pages at desktop and 360 px.
test.describe.configure({ mode: 'serial' });

const runId = Date.now().toString(36).toUpperCase();
let suffix = '';
let productName = '';
let productSlug = '';
let variantId = '';
let bannerTitle = '';
let bannerId = '';
let collectionName = '';
let customerEmail = '';
let orderId = '';
let returnNumber = '';

function randomPhone(): string {
  return `9${String(Math.floor(100_000_000 + Math.random() * 899_999_999))}`;
}

async function withAdmin(browser: Browser, email: string, work: (page: Page) => Promise<void>) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAdmin(page, email);
  await work(page);
  await context.close();
}

async function addAddress(page: Page) {
  const address = await api(page, 'POST', '/api/store/account/addresses', {
    recipientName: 'Returns Customer',
    phone: '9876543210',
    addressLine1: '12 MG Road',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411001',
    isDefault: true,
  });
  expect(address.status).toBe(201);
  return idOf(address, 'address');
}

async function placeCodOrder(page: Page, addressId: string): Promise<string> {
  expect(
    (await api(page, 'POST', '/api/store/cart/items', { variantId, quantity: 1 })).status,
  ).toBe(201);
  const summary = await api(
    page,
    'GET',
    `/api/store/checkout/summary?addressId=${addressId}&paymentMethod=COD`,
  );
  const expectedTotalPaise = (summary.body as { summary: { breakdown: { totalPaise: number } } })
    .summary.breakdown.totalPaise;
  const placed = await api(
    page,
    'POST',
    '/api/store/checkout',
    { addressId, paymentMethod: 'COD', expectedTotalPaise },
    {
      'Idempotency-Key': `e2e-${suffix}-${Date.now().toString(36)}${String(Math.random()).slice(2, 8)}`,
    },
  );
  expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  return (placed.body as { order: { orderId: string } }).order.orderId;
}

async function deliverOrder(page: Page, id: string) {
  expect((await api(page, 'POST', `/api/admin/orders/${id}/confirm`)).status).toBe(204);
  const detail = await api(page, 'GET', `/api/admin/orders/${id}`);
  const shipmentId = (detail.body as { order: { shipments: { id: string }[] } }).order.shipments[0]
    ?.id;
  for (const action of ['pack', 'create-awb']) {
    expect(
      (await api(page, 'POST', `/api/admin/shipments/${shipmentId ?? ''}/${action}`, {})).status,
    ).toBe(204);
  }
  for (let scan = 0; scan < 3; scan += 1) {
    const response = await api(
      page,
      'POST',
      `/api/admin/shipments/${shipmentId ?? ''}/simulate-scan`,
      {
        outcome: 'DELIVERED',
      },
    );
    expect(response.status).toBe(200);
  }
}

test.beforeAll(async ({ browser }, testInfo) => {
  suffix = `${runId}${projectLetter(testInfo.project.name)}P`;
  productName = `Returnable Kurta ${suffix}`;
  productSlug = `returnable-kurta-${suffix.toLowerCase()}`;
  bannerTitle = `Festive banner ${suffix}`;
  collectionName = `Festive edit ${suffix}`;
  customerEmail = `returns.${suffix.toLowerCase()}@example.test`;
  await withAdmin(browser, 'super.admin@demo-store.test', async (page) => {
    const sellable = await prepareSellableProduct(page, {
      suffix,
      productName,
      productSlug,
      quantity: 10,
    });
    variantId = sellable.variantId;
    const banner = await api(page, 'POST', '/api/admin/banners', {
      title: bannerTitle,
      imageUrl: 'https://picsum.photos/seed/e2e-banner/1200/400',
      linkUrl: `/products/${productSlug}`,
      position: 0,
      isActive: true,
      startsAt: null,
      endsAt: null,
    });
    expect(banner.status, JSON.stringify(banner.body)).toBe(201);
    bannerId = idOf(banner, 'banner');
    const collection = await api(page, 'POST', '/api/admin/collections', {
      name: collectionName,
      slug: `festive-edit-${suffix.toLowerCase()}`,
      description: 'Hand-picked for the festival',
      isActive: true,
      startsAt: null,
      endsAt: null,
    });
    expect(collection.status, JSON.stringify(collection.body)).toBe(201);
    const picked = await api(
      page,
      'PUT',
      `/api/admin/collections/${idOf(collection, 'collection')}/products`,
      { productIds: [sellable.productId] },
    );
    expect(picked.status).toBe(204);
  });
});

// Banners are shared home-page state; remove this file's banner so other specs never see it.
test.afterAll(async ({ browser }) => {
  if (bannerId === '') return;
  await withAdmin(browser, 'super.admin@demo-store.test', async (page) => {
    expect((await api(page, 'DELETE', `/api/admin/banners/${bannerId}`)).status).toBe(204);
  });
});

test('storefront: home banner and collection, collection page, pincode check (C6, C13, C19)', async ({
  page,
}) => {
  const problems = watchPageProblems(page);
  await page.goto(`${storeOrigin}/`);
  await expect(page.getByText(bannerTitle).filter({ visible: true }).first()).toBeVisible();
  await page.getByRole('link', { name: collectionName }).filter({ visible: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: collectionName })).toBeVisible();
  await expect(
    page.getByRole('link', { name: productName }).filter({ visible: true }).first(),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto(`${storeOrigin}/products/${productSlug}`);
  await visibleField(page, 'Delivery pincode').fill('411001');
  await page.getByRole('button', { name: 'Check', exact: true }).filter({ visible: true }).click();
  await expect(
    page.getByText(/Delivers to 411001 in about \d+ days · Cash on Delivery available/),
  ).toBeVisible();
  await visibleField(page, 'Delivery pincode').fill('190001');
  await page.getByRole('button', { name: 'Check', exact: true }).filter({ visible: true }).click();
  await expect(page.getByText('We do not deliver to 190001 yet.')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(problems.uncaughtPageErrors).toEqual([]);
  expect(problems.contentSecurityPolicyViolations).toEqual([]);
});

test('customer: OTP sign-in with the demo popup, then review and return a delivered order (C3, C21, C37, C36)', async ({
  page,
  browser,
}) => {
  const problems = watchPageProblems(page);
  const phone = randomPhone();
  await page.goto(`${storeOrigin}/`);
  const registered = await api(page, 'POST', '/api/store/auth/register', {
    fullName: 'Returns Customer',
    email: customerEmail,
    phone,
    password: 'Returns-Password-2026',
  });
  expect(registered.status).toBe(201);
  await page.context().clearCookies();

  await page.goto(`${storeOrigin}/login`);
  await visibleField(page, 'Mobile number').fill(phone);
  await page.getByRole('button', { name: 'Send a one-time code' }).click();
  const popup = page.getByRole('dialog', { name: 'Your one-time code' });
  await expect(popup).toContainText(
    'Staging/demo: OTP is shown here because SMS is not integrated',
  );
  const code = (await popup.locator('[aria-label="One-time code"]').textContent())?.trim() ?? '';
  expect(code).toMatch(/^\d{6}$/);
  await popup.getByRole('button', { name: 'Got it' }).click();
  await visibleField(page, 'One-time code').fill(code);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/account/);

  orderId = await placeCodOrder(page, await addAddress(page));
  await withAdmin(browser, 'order.ops@demo-store.test', (adminPage) =>
    deliverOrder(adminPage, orderId),
  );

  await page.goto(`${storeOrigin}/orders/${orderId}`);
  await page.getByRole('button', { name: 'Write a review' }).filter({ visible: true }).click();
  const reviewDialog = page.getByRole('dialog', { name: `Review ${productName}` });
  await reviewDialog.getByRole('radio', { name: /★★★★☆/ }).click();
  await reviewDialog.getByLabel('Title (optional)').fill('Lovely fabric');
  await reviewDialog.getByRole('button', { name: 'Submit review' }).click();
  await expect(page.getByText('Thank you for your review').first()).toBeVisible();

  await page
    .getByRole('button', { name: 'Return or exchange items' })
    .filter({ visible: true })
    .click();
  const returnDialog = page.getByRole('dialog', { name: 'Return or exchange items' });
  await returnDialog.getByRole('button', { name: `Increase quantity of ${productName}` }).click();
  await returnDialog.getByLabel('Reason').fill('The size does not fit');
  await returnDialog.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText('Return requested').first()).toBeVisible();
  const overview = await api(page, 'GET', `/api/store/orders/${orderId}/returns`);
  returnNumber =
    (overview.body as { requests: { returnNumber: string }[] }).requests[0]?.returnNumber ?? '';
  expect(returnNumber).toMatch(/^RET-/);
  await expect(page.getByText(returnNumber, { exact: false }).first()).toBeVisible();

  const messages = page.getByRole('region', { name: 'Messages' }).filter({ visible: true });
  await expect(messages.getByRole('listitem')).toHaveCount(3);
  await expect(messages).toContainText('We have received your order');
  await expect(messages).toContainText('has been delivered');
  const invoiceHref = await page
    .getByRole('link', { name: 'Invoice (PDF)' })
    .filter({ visible: true })
    .getAttribute('href');
  const invoice = await page.request.get(`${storeOrigin}${invoiceHref ?? ''}`);
  expect(invoice.status()).toBe(200);
  expect(invoice.headers()['content-type']).toBe('application/pdf');
  await expectNoHorizontalOverflow(page);
  expect(problems.uncaughtPageErrors).toEqual([]);
});

test('order operations run the return to a refund in the returns queue (D43)', async ({ page }) => {
  const problems = watchPageProblems(page);
  await signInAdmin(page, 'order.ops@demo-store.test');
  await page.goto(`${adminOrigin}/returns`);
  await expect(page.getByRole('heading', { level: 1, name: 'Returns' })).toBeVisible();
  const item = page
    .getByRole('list', { name: 'Return requests' })
    .filter({ visible: true })
    .getByRole('listitem')
    .filter({ hasText: returnNumber, visible: true });
  await item.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(item.getByText('approved', { exact: true })).toBeVisible();
  for (const step of ['Mark picked up', 'Mark received', 'Restock items']) {
    await item.getByRole('button', { name: step }).click();
    await page.getByRole('dialog').getByRole('button', { name: step }).click();
    await expect(item.getByRole('button', { name: step })).toBeHidden();
  }
  await item.getByRole('button', { name: 'Record refund' }).click();
  const refund = page.getByRole('dialog');
  await refund.getByLabel('Payment reference').fill(`UTR${suffix}`);
  await refund.getByLabel('Amount (₹)').fill('799');
  await refund.getByRole('button', { name: 'Save' }).click();
  await expect(item.getByText('refunded', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(problems.uncaughtPageErrors).toEqual([]);
});

test('bulk confirm reports one result per order (D38); new admin pages render', async ({
  page,
  browser,
}) => {
  const problems = watchPageProblems(page);
  const customerContext = await browser.newContext();
  const customerPage = await customerContext.newPage();
  await customerPage.goto(`${storeOrigin}/`);
  const bulkEmail = `bulk.${suffix.toLowerCase()}@example.test`;
  expect(
    (
      await api(customerPage, 'POST', '/api/store/auth/register', {
        fullName: 'Bulk Customer',
        email: bulkEmail,
        phone: randomPhone(),
        password: 'Bulk-Password-2026',
      })
    ).status,
  ).toBe(201);
  const addressId = await addAddress(customerPage);
  await placeCodOrder(customerPage, addressId);
  await placeCodOrder(customerPage, addressId);
  await customerContext.close();

  await signInAdmin(page, 'order.ops@demo-store.test');
  await page.goto(`${adminOrigin}/orders?q=${encodeURIComponent(bulkEmail)}`);
  await expect(
    page
      .getByRole('list', { name: 'Orders' })
      .filter({ visible: true })
      .getByRole('listitem')
      .filter({ visible: true }),
  ).toHaveCount(2);
  await visibleField(page, 'Select all on this page').click();
  await page.getByRole('button', { name: 'Apply to 2 orders' }).click();
  const report = page.getByRole('region', { name: 'Bulk action results' });
  await expect(report).toContainText('2 succeeded · 0 failed');
  await expectNoHorizontalOverflow(page);

  for (const [path, heading] of [
    ['/manifests', 'Manifests'],
    ['/banners', 'Home banners'],
    ['/collections', 'Collections'],
  ] as const) {
    await page.goto(`${adminOrigin}${path}`);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  expect(problems.uncaughtPageErrors).toEqual([]);
});

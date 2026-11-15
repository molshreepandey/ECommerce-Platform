import { expect, type Locator, type Page, test } from '@playwright/test';

import { createSeedClient } from '../prisma/seed/seed-client';
import { seedDemoCatalogue } from '../prisma/seed/demo-catalogue.seed';
import { productPhotoUrl } from '../src/modules/catalogue/catalogue-art';
import { assertTestDatabaseUrl } from '../tests/support/test-target-guard';

import { expectNoHorizontalOverflow, visibleField } from './support/auth';
import { api, idOf, signInAdmin } from './support/commerce';
import { storeOrigin } from './support/page-checks';

// Shopping the 40-product demo catalogue: category navigation, every filter, sorting, search and the
// product page. Runs as its own Playwright project after the others (it adds products and warehouses
// the other specs do not expect), one test at a time.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const testDatabaseUrl = assertTestDatabaseUrl(
    process.env['TEST_DATABASE_URL'],
    process.env['DATABASE_URL'],
  );
  process.env['DATABASE_URL'] = testDatabaseUrl;
  process.env['APP_ENV'] = 'test';
  const client = createSeedClient();
  try {
    await seedDemoCatalogue(client);
  } finally {
    await client.$disconnect();
  }
  // Rebuild the search index from the database (an index left by an earlier run would still hold
  // products of a reset database), then expire the storefront's cached category tree and merchandising.
  const page = await browser.newPage();
  await signInAdmin(page, 'super.admin@demo-store.test');
  const reindex = await api(page, 'POST', '/api/admin/search-index/reindex');
  expect(reindex.status).toBe(200);
  // Delivery coverage for this spec's own checks, set up through the admin API like an admin would (other
  // specs create couriers too, so the demo coverage step, which never touches existing couriers, may not).
  const courier = await api(page, 'POST', '/api/admin/courier-partners', {
    code: `e2e-storefront-${Date.now().toString(36)}`,
    name: 'Demo Surface',
    priority: 2,
    supportsCod: true,
    isActive: true,
  });
  expect(courier.status).toBe(201);
  for (const pincode of ['560001', '144011']) {
    const coverage = await api(
      page,
      'PUT',
      `/api/admin/courier-partners/${idOf(courier, 'courierPartner')}/pincodes`,
      { pincode, codAvailable: true, maxCodValuePaise: 2_000_000, etaDays: 6 },
    );
    expect(coverage.status).toBe(204);
  }
  await page.close();
  const { cacheTags, expireCacheTags } = await import('../src/lib/cache-tags');
  await expireCacheTags([cacheTags.categories, cacheTags.merchandising]);
});

const products = (page: Page) => page.getByRole('list', { name: 'Products' }).getByRole('listitem');

// Results stream in after the page shell; wait for them before counting or reading cards.
async function settledProducts(page: Page): Promise<Locator> {
  await expect(products(page).first()).toBeVisible();
  return products(page);
}

function rupees(text: string): number {
  const match = /₹([\d,]+(?:\.\d+)?)/.exec(text);
  if (match === null) throw new Error(`no price in "${text}"`);
  return Number((match[1] ?? '').replaceAll(',', ''));
}

async function cardPrices(cards: Locator): Promise<number[]> {
  return (await cards.allInnerTexts()).map((text) => rupees(text));
}

async function checkboxCount(checkbox: Locator): Promise<number> {
  const label =
    (await checkbox.getAttribute('aria-label')) ??
    (await checkbox.locator('xpath=ancestor::label').innerText());
  const match = /\((\d+)\)/.exec(label);
  if (match === null) throw new Error(`no count in "${label}"`);
  return Number(match[1]);
}

test('categories page: departments, groups and subcategories all lead to their products', async ({
  page,
}) => {
  await page.goto(`${storeOrigin}/categories`);
  await expect(page.getByRole('heading', { level: 1, name: 'All categories' })).toBeVisible();
  for (const department of ['Apparel', 'Footwear', 'Electronics', 'Beauty']) {
    await expect(page.getByRole('heading', { level: 2, name: department })).toBeVisible();
  }
  const sectionHrefs = await page
    .locator('main a[href^="/categories/"]')
    .evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute('href') ?? ''))]);
  expect(sectionHrefs.length).toBeGreaterThanOrEqual(30);
  for (const href of sectionHrefs) {
    const response = await page.request.get(`${storeOrigin}${href}`);
    expect(response.status(), href).toBe(200);
  }
  // Banner links saved by early demo data use /c/<slug>; they lead to the category page.
  const shortLink = await page.request.get(`${storeOrigin}/c/smartphones`, { maxRedirects: 0 });
  expect(shortLink.status()).toBe(308);
  expect(shortLink.headers()['location']).toMatch(/\/categories\/smartphones$/);
  await page.getByRole('link', { name: 'Lipsticks' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Lipsticks' })).toBeVisible();
  await expect(products(page)).toHaveCount(3);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Beauty');
  await expectNoHorizontalOverflow(page);
});

test('filters apply on their own, combine, count correctly, and clear', async ({ page }) => {
  await page.goto(`${storeOrigin}/categories/electronics`);
  await expect(page.getByRole('heading', { level: 1, name: 'Electronics' })).toBeVisible();
  const total = await (await settledProducts(page)).count();
  expect(total).toBeGreaterThan(5);

  // Brand: ticking applies it at once, and the count shown is what appears.
  const voltix = page.getByRole('checkbox', { name: /^Voltix \(\d+\)$/ });
  const voltixCount = await checkboxCount(voltix);
  await voltix.check();
  await expect(page).toHaveURL(/brand=voltix/);
  await expect(products(page)).toHaveCount(voltixCount);
  for (const text of await products(page).allInnerTexts()) expect(text).toMatch(/voltix/i);

  // Colour on top of the brand: its count already respects the brand filter.
  const black = page.getByRole('checkbox', { name: /^Black \(\d+\)$/ });
  const blackCount = await checkboxCount(black);
  await black.check();
  await expect(page).toHaveURL(/attr\.colour=Black/);
  await expect(products(page)).toHaveCount(blackCount);
  expect(blackCount).toBeLessThanOrEqual(voltixCount);

  // Price, applied with the button (or Enter).
  await page.getByRole('spinbutton', { name: 'Max' }).fill('5000');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/maxPrice=5000/);
  for (const price of await cardPrices(products(page))) expect(price).toBeLessThanOrEqual(5000);
  await expect(page).toHaveURL(/brand=voltix/);

  // Each active filter can be removed on its own; Clear all removes every one.
  await page.getByRole('link', { name: 'Remove filter Voltix' }).click();
  await expect(page).not.toHaveURL(/brand=/);
  await expect(page).toHaveURL(/attr\.colour=Black/);
  await page.getByRole('link', { name: 'Clear all filters' }).click();
  await expect(page).toHaveURL(`${storeOrigin}/categories/electronics`);
  await expect(products(page)).toHaveCount(total);
});

test('in stock only and an impossible price show the right results and an empty state', async ({
  page,
}) => {
  await page.goto(`${storeOrigin}/search?maxPrice=1`);
  await expect(page.getByText('No products match').filter({ visible: true })).toBeVisible();
  await page.goto(`${storeOrigin}/search?inStock=true`);
  for (const text of await (await settledProducts(page)).allInnerTexts())
    expect(text).not.toContain('Out of stock');
});

test('sorting by price both ways and by discount, keeping the filters', async ({ page }) => {
  await page.goto(`${storeOrigin}/categories/footwear?inStock=true`);
  await page.getByRole('combobox', { name: 'Sort by' }).click();
  await page.getByRole('option', { name: 'Price: low to high', exact: true }).click();
  await expect(page).toHaveURL(/sort=price_asc/);
  await expect(page).toHaveURL(/inStock=true/);
  const ascending = await cardPrices(products(page));
  expect(ascending).toEqual([...ascending].sort((left, right) => left - right));

  await page.getByRole('combobox', { name: 'Sort by' }).click();
  await page.getByRole('option', { name: 'Price: high to low', exact: true }).click();
  await expect(page).toHaveURL(/sort=price_desc/);
  const descending = await cardPrices(products(page));
  expect(descending).toEqual([...descending].sort((left, right) => right - left));

  await page.getByRole('combobox', { name: 'Sort by' }).click();
  await page.getByRole('option', { name: 'Biggest discount', exact: true }).click();
  await expect(page).toHaveURL(/sort=discount/);
  const discounts = (await products(page).allInnerTexts()).map((text) => {
    const match = /(\d+)% off/.exec(text);
    return match === null ? 0 : Number(match[1]);
  });
  expect(discounts).toEqual([...discounts].sort((left, right) => right - left));
});

test('search by product name, brand and category; nonsense finds nothing', async ({ page }) => {
  await page.goto(`${storeOrigin}/`);
  const searchBox = page.getByRole('combobox', { name: /search/i }).filter({ visible: true });
  await searchBox.fill('saree');
  await searchBox.press('Enter');
  await expect(page).toHaveURL(/\/search\?q=saree/);
  await expect(products(page).filter({ hasText: 'Banarasi Silk Saree' })).toHaveCount(1);

  await page.goto(`${storeOrigin}/search?q=nimbus`);
  expect(await (await settledProducts(page)).count()).toBeGreaterThan(0);
  for (const text of await products(page).allInnerTexts()) expect(text).toMatch(/nimbus/i);

  await page.goto(`${storeOrigin}/search?q=lipsticks`);
  await expect(products(page).filter({ hasText: 'Velvet Matte Lipstick' })).toHaveCount(1);

  await page.goto(`${storeOrigin}/search?q=zzqqxx`);
  await expect(page.getByText('No products match').filter({ visible: true })).toBeVisible();
});

test('product page: images, variant choice, real delivery check, no invented reviews, add to cart', async ({
  page,
}) => {
  await page.goto(`${storeOrigin}/categories/smartphones`);
  await products(page).filter({ hasText: 'Voltix Nova 5G Smartphone' }).getByRole('link').click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Voltix Nova 5G Smartphone' }),
  ).toBeVisible();

  const gallery = page.locator('main img[src*="/catalogue-"]');
  await expect(gallery.first()).toBeVisible();
  for (const image of await gallery.all()) {
    expect(
      await image.evaluate((element: HTMLImageElement) => element.naturalWidth),
    ).toBeGreaterThan(0);
  }
  // A photographed product has one picture; a drawn one has three views to switch between.
  if (productPhotoUrl('voltix-nova-5g-smartphone') === null) {
    await page.getByRole('button', { name: 'Image 2' }).click();
    await expect(page.getByRole('button', { name: 'Image 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  } else {
    await expect(page.getByRole('list', { name: 'Product images' })).toHaveCount(0);
  }

  // No reviews exist in the demo catalogue: nothing pretends otherwise.
  await expect(page.getByText(/★|stars?\b/).filter({ visible: true })).toHaveCount(0);

  const pincode = page.getByRole('textbox', { name: 'Delivery pincode' });
  await pincode.fill('560001');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText(/Delivers to 560001 in about \d+ days/)).toBeVisible();
  await pincode.fill('999999');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText('We do not deliver to 999999 yet.')).toBeVisible();

  await page.getByRole('button', { name: 'Add to cart' }).filter({ visible: true }).click();
  await expect(
    page.getByRole('link', { name: /Cart, 1 item/ }).filter({ visible: true }),
  ).toBeVisible();
});

test('tablet and mobile: pages fit the screen; filters open in a dialog on a phone', async ({
  page,
}) => {
  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    for (const path of ['/', '/categories', '/categories/apparel', '/search?q=shoe']) {
      await page.goto(`${storeOrigin}${path}`);
      await expectNoHorizontalOverflow(page);
    }
  }
  await page.goto(`${storeOrigin}/categories/apparel`);
  // Products come first on a phone; the filters open in a dialog.
  await expect(products(page).first()).toBeVisible();
  await page.getByRole('button', { name: 'Filters' }).click();
  const dialog = page.getByRole('dialog', { name: 'Filters' });
  await dialog.getByRole('checkbox', { name: /^Desi Threads \(\d+\)$/ }).check();
  await expect(page).toHaveURL(/brand=desi-threads/);
  for (const text of await products(page).allInnerTexts()) expect(text).toMatch(/desi threads/i);
  await expect(page.getByRole('button', { name: 'Filters (1 applied)' })).toBeVisible();
});

test('checkout to Phagwara (144011) with Cash on Delivery; an unserved pincode is refused', async ({
  page,
}) => {
  const suffix = String(Date.now());
  await page.goto(`${storeOrigin}/register`);
  await visibleField(page, 'Full name').fill('Phagwara Customer');
  await visibleField(page, 'Email').fill(`phagwara.${suffix}@example.test`);
  await visibleField(page, 'Mobile number').fill(`9${suffix.slice(-9)}`);
  await visibleField(page, 'Password').fill('Phagwara-Password-2026');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/account/);
  const phagwara = await api(page, 'POST', '/api/store/account/addresses', {
    recipientName: 'Phagwara Customer',
    phone: '9876543210',
    addressLine1: '14 GT Road',
    city: 'Phagwara',
    state: 'Punjab',
    pincode: '144011',
    isDefault: true,
  });
  expect(phagwara.status).toBe(201);

  // Delivery check on the product page answers from the configured courier coverage.
  await page.goto(`${storeOrigin}/products/classic-crew-tshirt`);
  const pincode = page.getByRole('textbox', { name: 'Delivery pincode' });
  await pincode.fill('144011');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(
    page.getByText('Delivers to 144011 in about 6 days · Cash on Delivery available'),
  ).toBeVisible();
  await pincode.fill('14401');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText('Enter a 6-digit pincode.')).toBeVisible();

  await page.getByRole('button', { name: 'Add to cart' }).filter({ visible: true }).click();
  await expect(
    page.getByRole('link', { name: /Cart, 1 item/ }).filter({ visible: true }),
  ).toBeVisible();
  await page.goto(`${storeOrigin}/checkout`);
  await expect(page.getByRole('heading', { level: 1, name: 'Checkout' })).toBeVisible();
  await expect(
    page.getByText(/Delivers in about 6 days with Demo Surface/).filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole('radio', { name: /Cash on Delivery/ }).click();
  const placeButton = page.getByRole('button', { name: /Place order/ }).filter({ visible: true });
  await expect(placeButton).toBeEnabled();
  await placeButton.click();
  await expect(
    page.getByText(/Your order ORD-\d+ is placed/).filter({ visible: true }),
  ).toBeVisible();

  // A pincode no courier serves: checkout says so and the order cannot be placed.
  const unserved = await api(page, 'POST', '/api/store/account/addresses', {
    recipientName: 'Phagwara Customer',
    phone: '9876543210',
    addressLine1: '1 Unserved Lane',
    city: 'Nowhere',
    state: 'Punjab',
    pincode: '999999',
    isDefault: true,
  });
  expect(unserved.status).toBe(201);
  await page.goto(`${storeOrigin}/products/classic-crew-tshirt`);
  await page.getByRole('button', { name: 'Add to cart' }).filter({ visible: true }).click();
  await expect(
    page.getByRole('link', { name: /Cart, 1 item/ }).filter({ visible: true }),
  ).toBeVisible();
  await page.goto(`${storeOrigin}/checkout`);
  await expect(
    page
      .getByText('We do not deliver to this pincode yet. Choose another address.')
      .filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole('radio', { name: /Cash on Delivery/ }).click();
  await expect(
    page.getByRole('button', { name: /Place order/ }).filter({ visible: true }),
  ).toBeDisabled();
});

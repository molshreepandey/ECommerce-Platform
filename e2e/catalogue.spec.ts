import { expect, type Page, test } from '@playwright/test';

import {
  demoPassword,
  expectNoHorizontalOverflow,
  signInThroughForm,
  visibleField,
  watchPageProblems,
} from './support/auth';
import { adminOrigin, projectLetter } from './support/page-checks';

// One chain per browser project: the steps build on each other (type → brand → product → variants).
test.describe.configure({ mode: 'serial' });

const runId = Date.now().toString(36);
let suffix = '';
let productName = '';
let productUrl = '';
const unsavedDescription = 'Typed before the variant and image changes';

async function signInAs(page: Page, email: string) {
  await page.goto(`${adminOrigin}/login`);
  await signInThroughForm(page, email, demoPassword);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).filter({ visible: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

function toast(page: Page, text: string) {
  // The same message can be on screen twice for a moment (two quick saves); check the newest one.
  return page
    .getByRole('region', { name: /Notifications/ })
    .getByText(text, { exact: true })
    .last();
}

// Next 16 can keep a hidden copy of streamed or previous content; assert on what the user can see.
function visibleText(page: Page, text: string | RegExp) {
  return page.getByText(text, { exact: true }).filter({ visible: true });
}

async function addAttribute(
  page: Page,
  attribute: { label: string; code: string; scope?: string; values: string },
) {
  await page.getByRole('button', { name: 'Add attribute' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add attribute' });
  await dialog.getByLabel('Label', { exact: true }).fill(attribute.label);
  await dialog.getByLabel('Code', { exact: true }).fill(attribute.code);
  if (attribute.scope !== undefined) await choose(page, 'Scope', attribute.scope);
  await dialog.getByLabel(/Allowed values/).fill(attribute.values);
  await dialog.getByRole('checkbox', { name: 'Required' }).click();
  await dialog.getByRole('button', { name: 'Save attribute' }).click();
  await expect(toast(page, 'Attribute added')).toBeVisible();
  await expect(dialog).toBeHidden();
}

test.beforeAll(({}, testInfo) => {
  suffix = `${runId}${projectLetter(testInfo.project.name).toLowerCase()}`;
  productName = `Trail Runner ${suffix}`;
});

test('a catalogue manager builds a new product type and lists a product of it without code changes', async ({
  page,
}) => {
  const problems = watchPageProblems(page);
  await signInAs(page, 'catalogue.manager@demo-store.test');

  await test.step('create a product type with its own attributes', async () => {
    await page.getByRole('link', { name: 'Product types' }).filter({ visible: true }).click();
    await page.getByRole('button', { name: 'New product type' }).click();
    const dialog = page.getByRole('dialog', { name: 'New product type' });
    await dialog.getByLabel('Name', { exact: true }).fill(`Footwear ${suffix}`);
    await dialog.getByLabel('Code', { exact: true }).fill(`footwear_${suffix}`);
    await dialog.getByRole('button', { name: 'Create product type' }).click();
    await expect(toast(page, 'Product type created')).toBeVisible();
    await page.getByRole('link', { name: `Footwear ${suffix}` }).click();
    await addAttribute(page, { label: 'Material', code: 'material', values: 'Leather\nCanvas' });
    await addAttribute(page, {
      label: 'Shoe size',
      code: 'shoe_size',
      scope: 'Variant option (size, colour…)',
      values: '7\n8\n9',
    });
    await expect(page.getByRole('list', { name: 'Attributes' }).getByRole('listitem')).toHaveCount(
      2,
    );
    await expectNoHorizontalOverflow(page);
  });

  await test.step('create a brand', async () => {
    await page.getByRole('link', { name: 'Brands' }).filter({ visible: true }).click();
    await page.getByRole('button', { name: 'New brand' }).click();
    const dialog = page.getByRole('dialog', { name: 'New brand' });
    await dialog.getByLabel('Name', { exact: true }).fill(`Stride ${suffix}`);
    await dialog.getByRole('button', { name: 'Save brand' }).click();
    await expect(toast(page, 'Brand created')).toBeVisible();
  });

  await test.step('a missing required attribute is shown next to its field', async () => {
    await page.goto(`${adminOrigin}/products/new`);
    await choose(page, 'Product type', `Footwear ${suffix}`);
    await choose(page, 'Brand', `Stride ${suffix}`);
    await visibleField(page, 'Name').fill(productName);
    await page.getByRole('button', { name: 'Create product' }).click();
    // The error must be attached to the Material field itself. The empty select also shows "Choose a
    // value" as its placeholder, so a page-wide text match passed before the error rendered, and failed
    // (two matches) once it had.
    await expect(
      page.getByRole('combobox', { name: 'Material (required)' }).filter({ visible: true }),
    ).toHaveAccessibleDescription('Choose a value');
    await expect(page).toHaveURL(`${adminOrigin}/products/new`);
  });

  await test.step('create the product of the new type', async () => {
    await choose(page, 'Material (required)', 'Leather');
    await page.getByRole('button', { name: 'Create product' }).click();
    await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
    productUrl = page.url();
    await expect(page.getByRole('heading', { level: 2, name: productName })).toBeVisible();
  });

  await test.step('activating without a variant is refused with the reason', async () => {
    await page.getByRole('button', { name: 'Activate product' }).click();
    await expect(visibleText(page, 'Add at least one active variant')).toBeVisible();
  });

  await test.step('generate size variants and add an image', async () => {
    // Unsaved edits must survive variant and image changes, which move the product version.
    await visibleField(page, 'Description').fill(unsavedDescription);
    await page.getByRole('button', { name: 'Generate variants' }).click();
    const dialog = page.getByRole('dialog', { name: 'Generate variants' });
    await dialog.getByLabel('SKU prefix', { exact: true }).fill(`TR-${suffix}`);
    await dialog.getByRole('checkbox', { name: '7', exact: true }).click();
    await dialog.getByRole('checkbox', { name: '8', exact: true }).click();
    for (const [label, value] of [
      ['MRP (paise)', '499900'],
      ['Price (paise)', '399900'],
      ['Weight (grams)', '800'],
      ['Length (mm)', '320'],
      ['Breadth (mm)', '210'],
      ['Height (mm)', '120'],
    ] as const) {
      await dialog.getByLabel(label, { exact: true }).fill(value);
    }
    await dialog.getByRole('button', { name: 'Generate' }).click();
    await expect(toast(page, 'Variants generated')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Variants' }).getByRole('listitem')).toHaveCount(2);
    await expect(
      page
        .getByText(/MRP ₹4,999\.00 · price ₹3,999\.00/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Add image' }).click();
    const imageDialog = page.getByRole('dialog', { name: 'Add image' });
    await imageDialog
      .getByLabel('Image URL', { exact: true })
      .fill(`https://picsum.photos/seed/${suffix}/600/800`);
    await imageDialog.getByLabel('Alt text', { exact: true }).fill('Side view of the trail runner');
    await imageDialog.getByRole('button', { name: 'Save image' }).click();
    await expect(toast(page, 'Image added')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Side view of the trail runner' })).toBeVisible();
    await expect(visibleField(page, 'Description')).toHaveValue(unsavedDescription);
    const versionBeforeSave = await visibleText(page, /^Version \d+$/).textContent();
    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(toast(page, 'Product saved')).toBeVisible();
    // Activation sends the version shown on the page, so wait for the refreshed one after the save.
    await expect(visibleText(page, /^Version \d+$/)).not.toHaveText(versionBeforeSave ?? '');
  });

  await test.step('activate, then find the product with the list filters', async () => {
    await page.getByRole('button', { name: 'Activate product' }).click();
    await expect(toast(page, 'Product activated')).toBeVisible();
    await page.goto(`${adminOrigin}/products`);
    await visibleField(page, 'Search by name').fill(productName);
    await choose(page, 'Status', 'Active');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    const results = page.getByRole('list', { name: 'Products' }).getByRole('listitem');
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText(productName);
    await expect(results.first()).toContainText('active');
    await expectNoHorizontalOverflow(page);
  });

  expect(problems.uncaughtPageErrors).toEqual([]);
  expect(problems.contentSecurityPolicyViolations).toEqual([]);
});

test('read-only support staff can view the product but see no write controls', async ({ page }) => {
  await signInAs(page, 'support@demo-store.test');
  await page.goto(productUrl);
  await expect(page.getByRole('heading', { level: 2, name: productName })).toBeVisible();
  await expect(visibleText(page, 'You can view the catalogue but not change it.')).toBeVisible();
  for (const button of [
    'Archive product',
    'Add variant',
    'Generate variants',
    'Add image',
    'Save product',
  ]) {
    await expect(page.getByRole('button', { name: button })).toHaveCount(0);
  }
  await page.goto(`${adminOrigin}/products/new`);
  await expect(
    page
      .getByRole('heading', { name: 'You do not have access to this page' })
      .filter({ visible: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('a save based on an old version is refused and offers to reload', async ({ browser }) => {
  const first = await browser.newPage();
  const second = await browser.newPage();
  for (const page of [first, second]) {
    await signInAs(page, 'catalogue.manager@demo-store.test');
    await page.goto(productUrl);
  }
  await visibleField(second, 'Description').fill('Changed in another tab');
  await second.getByRole('button', { name: 'Save product' }).click();
  await expect(toast(second, 'Product saved')).toBeVisible();

  await visibleField(first, 'Description').fill('Changed in the first tab');
  await first.getByRole('button', { name: 'Save product' }).click();
  await expect(
    visibleText(first, 'Someone else changed this product. Reload it and try again.'),
  ).toBeVisible();
  await first.close();
  await second.close();
});

test('archiving the last active variant of an active product is refused, then the product is archived', async ({
  page,
}) => {
  await signInAs(page, 'catalogue.manager@demo-store.test');
  await page.goto(productUrl);
  const [firstSku, secondSku] = [`TR-${suffix}-7`.toUpperCase(), `TR-${suffix}-8`.toUpperCase()];
  const versionBeforeVariantArchive = await visibleText(page, /^Version \d+$/).textContent();
  await page.getByRole('button', { name: `Archive ${firstSku}` }).click();
  await expect(toast(page, 'Variant archived')).toBeVisible();
  // Archiving the variant moves the product to a new version; "Archive product" sends the version shown
  // on the page, so wait for the refreshed one (otherwise the server rightly refuses a stale version).
  await expect(visibleText(page, /^Version \d+$/)).not.toHaveText(
    versionBeforeVariantArchive ?? '',
  );
  await page.getByRole('button', { name: `Archive ${secondSku}` }).click();
  await expect(
    visibleText(
      page,
      'An active product needs at least one active variant. Move the product to draft first.',
    ),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Archive product' }).click();
  await page
    .getByRole('dialog', { name: `Archive ${productName}?` })
    .getByRole('button', { name: 'Archive product' })
    .click();
  await expect(toast(page, 'Product archived')).toBeVisible();
  await expect(
    visibleText(page, 'Archived products are read-only. Restore it to make changes.'),
  ).toBeVisible();
  await page.goto(`${adminOrigin}/products?search=${encodeURIComponent(productName)}`);
  await expect(visibleText(page, 'No products found')).toBeVisible();
});

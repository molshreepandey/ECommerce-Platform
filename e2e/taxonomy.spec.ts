import { expect, type Page, test } from '@playwright/test';
import { z } from 'zod';

import {
  demoPassword,
  expectNoHorizontalOverflow,
  signInThroughForm,
  visibleField,
  watchPageProblems,
} from './support/auth';
import { adminOrigin, projectLetter } from './support/page-checks';

test.describe.configure({ mode: 'serial' });

const runId = Date.now().toString(36);
let suffix = '';
let groupUrl = '';

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

function visibleText(page: Page, text: string) {
  return page.getByText(text, { exact: true }).filter({ visible: true });
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).filter({ visible: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

// Setup data through the real admin API, from inside the signed-in page (same origin, real session).
async function api(page: Page, method: string, path: string, body: unknown): Promise<unknown> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`${method} ${path} → ${String(response.status)}`);
      return (await response.json()) as unknown;
    },
    { method, path, body },
  );
}

async function createProducts(page: Page, names: readonly string[]) {
  // Responses are parsed, not cast, so a changed API shape fails here with a clear message.
  const type = z.object({ productType: z.object({ id: z.uuid() }) }).parse(
    await api(page, 'POST', '/api/admin/product-types', {
      code: `wave4_${suffix}`,
      name: `Wave 4 type ${suffix}`,
    }),
  );
  await api(page, 'POST', `/api/admin/product-types/${type.productType.id}/attribute-definitions`, {
    code: 'fabric',
    label: 'Fabric',
    dataType: 'ENUM',
    scope: 'PRODUCT',
    isRequired: true,
    allowedValues: ['Cotton'],
  });
  const brand = z
    .object({ brand: z.object({ id: z.uuid() }) })
    .parse(await api(page, 'POST', '/api/admin/brands', { name: `Wave 4 brand ${suffix}` }));
  for (const name of names) {
    await api(page, 'POST', '/api/admin/products', {
      productTypeId: type.productType.id,
      brandId: brand.brand.id,
      name,
      attributes: { fabric: 'Cotton' },
      taxRateBasisPoints: 500,
    });
  }
}

test.beforeAll(({}, testInfo) => {
  suffix = `${runId}${projectLetter(testInfo.project.name).toLowerCase()}`;
});

test('a catalogue manager builds the category tree, tags products and groups them', async ({
  page,
}) => {
  const problems = watchPageProblems(page);
  // Each name is built directly, so every value is a definite string (no possibly-undefined array slots).
  const named = (base: string) => `${base} ${suffix}`;
  const ethnic = named('Ethnic');
  const western = named('Western');
  const kurtas = named('Kurtas');
  const sarees = named('Sarees');
  const indigo = named('Indigo kurta');
  const rust = named('Rust kurta');
  await signInAs(page, 'catalogue.manager@demo-store.test');

  await test.step('build a small tree and move a subcategory', async () => {
    await page.getByRole('link', { name: 'Categories' }).filter({ visible: true }).click();
    for (const [name, parent] of [
      [ethnic, null],
      [western, null],
      [kurtas, ethnic],
      [sarees, ethnic],
    ] as const) {
      await page
        .getByRole('button', {
          name: parent === null ? 'New top-level category' : `Add under ${parent}`,
        })
        .click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Name', { exact: true }).fill(name);
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(toast(page, 'Category created')).toBeVisible();
      await expect(dialog).toBeHidden();
    }
    await page.getByRole('button', { name: `Move ${sarees}` }).click();
    await choose(page, 'New parent', western);
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(toast(page, 'Category moved')).toBeVisible();
    const westernBranch = page
      .getByRole('listitem')
      .filter({ has: page.getByText(western, { exact: true }) })
      .first();
    await expect(westernBranch.getByText(sarees, { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  await test.step('tag two products to a leaf from the tagging queue', async () => {
    await createProducts(page, [indigo, rust]);
    await page.goto(`${adminOrigin}/tagging?search=${encodeURIComponent(suffix)}`);
    const queue = page.getByRole('list', { name: 'Products to tag' });
    await expect(queue.getByRole('listitem')).toHaveCount(2);
    await page.getByRole('checkbox', { name: 'Select all on this page' }).click();
    await page.getByRole('combobox', { name: 'Category for the selected products' }).click();
    await expect(page.getByRole('option', { name: ethnic, exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: `${ethnic} › ${kurtas}`, exact: true }).click();
    await page.getByRole('button', { name: /Tag selected/ }).click();
    await expect(toast(page, 'Products tagged')).toBeVisible();
    await expect(visibleText(page, 'Every product is tagged')).toBeVisible();

    await page.goto(`${adminOrigin}/tagging?status=TAGGED&search=${encodeURIComponent(suffix)}`);
    await expect(
      page.getByRole('list', { name: 'Products to tag' }).getByRole('listitem'),
    ).toHaveCount(2);
    await expect(visibleText(page, `${ethnic} › ${kurtas}`).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  await test.step('a category with products offers no delete', async () => {
    await page.goto(`${adminOrigin}/categories`);
    await expect(page.getByRole('button', { name: `Rename ${kurtas}` })).toBeVisible();
    await expect(page.getByRole('button', { name: `Delete ${kurtas}` })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Add under ${kurtas}` })).toHaveCount(0);
  });

  await test.step('group the two products with ordered swatches, then remove one', async () => {
    await page.getByRole('link', { name: 'Product groups' }).filter({ visible: true }).click();
    await page.getByRole('button', { name: 'New group' }).click();
    await page
      .getByRole('dialog')
      .getByLabel('Name', { exact: true })
      .fill(`Kurta prints ${suffix}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Create group' }).click();
    await expect(page).toHaveURL(/\/product-groups\/[0-9a-f-]{36}$/);
    groupUrl = page.url();

    await visibleField(page, 'Find products to add').fill(suffix);
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await page.getByRole('checkbox', { name: indigo, exact: true }).click();
    await page.getByRole('checkbox', { name: rust, exact: true }).click();
    await page.getByRole('button', { name: /Add selected/ }).click();
    await expect(toast(page, 'Products added to the group')).toBeVisible();
    const members = page.getByRole('list', { name: 'Group members' }).getByRole('listitem');
    await expect(members).toHaveCount(2);

    await visibleField(page, `Swatch label for ${indigo}`).fill('Indigo');
    await visibleField(page, `Swatch label for ${rust}`).fill('Rust');
    await page.getByRole('button', { name: `Move ${rust} up` }).click();
    await page.getByRole('button', { name: 'Save order and swatch labels' }).click();
    await expect(toast(page, 'Order and swatch labels saved')).toBeVisible();
    await page.reload();
    await expect(members.first()).toContainText(`1. ${rust}`);
    await expect(visibleField(page, `Swatch label for ${rust}`)).toHaveValue('Rust');

    await page.getByRole('button', { name: `Remove ${indigo}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove from group' }).click();
    await expect(toast(page, 'Product removed from the group')).toBeVisible();
    await expect(members).toHaveCount(1);
    await expect(visibleText(page, '1 of 50 products')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  expect(problems.uncaughtPageErrors).toEqual([]);
  expect(problems.contentSecurityPolicyViolations).toEqual([]);
});

test('read-only support staff see the tree, queue and groups without any write controls', async ({
  page,
}) => {
  await signInAs(page, 'support@demo-store.test');
  await page.goto(`${adminOrigin}/categories`);
  await expect(visibleText(page, 'You can view the catalogue but not change it.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New top-level category' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Move / })).toHaveCount(0);

  await page.goto(`${adminOrigin}/tagging?status=TAGGED&search=${encodeURIComponent(suffix)}`);
  await expect(
    page.getByRole('list', { name: 'Products to tag' }).getByRole('listitem'),
  ).toHaveCount(2);
  await expect(page.getByRole('button', { name: /Tag selected/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);

  await page.goto(groupUrl);
  await expect(page.getByRole('list', { name: 'Group members' }).getByRole('listitem')).toHaveCount(
    1,
  );
  for (const button of ['Rename group', 'Delete group', 'Save order and swatch labels']) {
    await expect(page.getByRole('button', { name: button })).toHaveCount(0);
  }
  await expectNoHorizontalOverflow(page);
});

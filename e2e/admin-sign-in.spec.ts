import { expect, test } from '@playwright/test';

import {
  demoPassword,
  expectNoHorizontalOverflow,
  expectSignInRejected,
  signInThroughForm,
  staffUsers,
  visibleField,
  watchPageProblems,
} from './support/auth';
import { adminOrigin } from './support/page-checks';

const roleNames: Record<(typeof staffUsers)[number]['roleCode'], string> = {
  SUPER_ADMIN: 'Super admin',
  CATALOGUE_MANAGER: 'Catalogue manager',
  INVENTORY_MANAGER: 'Inventory manager',
  ORDER_OPS: 'Order operations',
  SUPPORT: 'Support (read-only)',
};

for (const staff of staffUsers) {
  test(`${staff.roleCode} signs in to the dashboard and signs out`, async ({ page }) => {
    const problems = watchPageProblems(page);
    await page.goto(`${adminOrigin}/`);
    await expect(page).toHaveURL(`${adminOrigin}/login`);
    await expectNoHorizontalOverflow(page);
    await signInThroughForm(page, staff.email, demoPassword);

    await expect(page).toHaveURL(`${adminOrigin}/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText(staff.fullName)).toBeVisible();
    await expect(page.getByText(`with the role ${roleNames[staff.roleCode]}.`)).toBeVisible();
    const permissions = page.getByRole('list', { name: 'Your permissions' }).getByRole('listitem');
    if (staff.roleCode === 'SUPER_ADMIN') await expect(permissions).toHaveCount(19);
    else await expect(permissions).not.toHaveCount(19);
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(`${adminOrigin}/login`);
    await page.goto(`${adminOrigin}/`);
    await expect(page).toHaveURL(`${adminOrigin}/login`);

    expect(problems.uncaughtPageErrors).toEqual([]);
    expect(problems.contentSecurityPolicyViolations).toEqual([]);
  });
}

test('a wrong password shows the generic error and keeps the visitor on sign-in', async ({
  page,
}) => {
  await page.goto(`${adminOrigin}/login`);
  await signInThroughForm(page, 'support@demo-store.test', 'Not-The-Password-1');
  await expectSignInRejected(page);
  await expect(page).toHaveURL(`${adminOrigin}/login`);
});

test('a customer account cannot sign in to the admin site', async ({ page }) => {
  await page.goto(`${adminOrigin}/login`);
  await signInThroughForm(page, 'asha.verma@demo-store.test', demoPassword);
  await expectSignInRejected(page);
});

test('sign-in works with the keyboard alone', async ({ page }) => {
  await page.goto(`${adminOrigin}/login`);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('Tab');
  await expect(visibleField(page, 'Email')).toBeFocused();
  await page.keyboard.type('inventory.manager@demo-store.test');
  await page.keyboard.press('Tab');
  await expect(visibleField(page, 'Password')).toBeFocused();
  await page.keyboard.type(demoPassword);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Show password' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Priya Rao')).toBeVisible();
});

import { expect, test } from '@playwright/test';

import { adminOrigin, openSettledPage, storeOrigin } from './support/page-checks';

test.describe('store not-found page', () => {
  for (const pathname of ['/no-such-page', '/deep/nested/missing/path', '/admin']) {
    test(`renders the store 404 for ${pathname}`, async ({ page }) => {
      const { status, uncaughtPageErrors, contentSecurityPolicyViolations } = await openSettledPage(
        page,
        `${storeOrigin}${pathname}`,
      );

      expect(status).toBe(404);
      await expect(page).toHaveTitle('Page not found · Demo Store');
      await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
      await expect(page.getByRole('banner').getByText('Demo Store')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Back to the store' })).toBeVisible();
      await expect(page.getByText('This admin page does not exist')).toHaveCount(0);
      await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
      expect(uncaughtPageErrors).toEqual([]);
      expect(contentSecurityPolicyViolations).toEqual([]);
    });
  }

  test('links back to the store home page', async ({ page }) => {
    await openSettledPage(page, `${storeOrigin}/no-such-page`);
    await page.getByRole('link', { name: 'Back to the store' }).click();

    await expect(page).toHaveURL(`${storeOrigin}/`);
    await expect(page).toHaveTitle('Demo Store');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Everyday essentials, delivered',
    );
  });
});

test.describe('admin not-found page', () => {
  for (const pathname of ['/no-such-page', '/orders/missing-order', '/store']) {
    test(`renders the admin 404 for ${pathname}`, async ({ page }) => {
      const { status, uncaughtPageErrors, contentSecurityPolicyViolations } = await openSettledPage(
        page,
        `${adminOrigin}${pathname}`,
      );

      expect(status).toBe(404);
      await expect(page).toHaveTitle('Page not found · Admin');
      await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
      await expect(page.getByText('This admin page does not exist')).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Admin' })).toBeAttached();
      await expect(page.getByText('Back to the store')).toHaveCount(0);
      await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
      expect(uncaughtPageErrors).toEqual([]);
      expect(contentSecurityPolicyViolations).toEqual([]);
    });
  }

  test('links back to the dashboard', async ({ page }) => {
    await openSettledPage(page, `${adminOrigin}/no-such-page`);
    await page.getByRole('link', { name: 'Back to the dashboard' }).click();

    await expect(page).toHaveURL(`${adminOrigin}/`);
    await expect(page).toHaveTitle('Admin');
  });
});

test('home pages still return 200 with no CSP violations or page errors', async ({ page }) => {
  for (const origin of [storeOrigin, adminOrigin]) {
    const { status, uncaughtPageErrors, contentSecurityPolicyViolations } = await openSettledPage(
      page,
      `${origin}/`,
    );
    expect(status).toBe(200);
    expect(uncaughtPageErrors).toEqual([]);
    expect(contentSecurityPolicyViolations).toEqual([]);
  }
});

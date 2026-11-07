import type { Page } from '@playwright/test';

export { adminOrigin, storeOrigin } from '../../tests/support/test-app';

export async function openSettledPage(page: Page, url: string) {
  const uncaughtPageErrors: string[] = [];
  const contentSecurityPolicyViolations: string[] = [];
  page.on('pageerror', (error) => uncaughtPageErrors.push(error.message));
  page.on('console', (message) => {
    if (
      /Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(message.text())
    ) {
      contentSecurityPolicyViolations.push(message.text());
    }
  });
  const response = await page.goto(url);
  await page.waitForLoadState('networkidle');
  return { status: response?.status(), uncaughtPageErrors, contentSecurityPolicyViolations };
}

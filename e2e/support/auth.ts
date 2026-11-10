import { expect, type Page } from '@playwright/test';

export { demoPassword } from '../../prisma/seed/demo-credentials';
export { staffUsers } from '../../prisma/seed/identity.seed';

export function watchPageProblems(page: Page) {
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
  return { uncaughtPageErrors, contentSecurityPolicyViolations };
}

// Next 16 keeps the previous route mounted but hidden (React <Activity>), so a label can match twice.
export function visibleField(page: Page, label: string) {
  return page.getByLabel(label, { exact: true }).filter({ visible: true });
}

export async function signInThroughForm(page: Page, email: string, password: string) {
  await visibleField(page, 'Email').fill(email);
  await visibleField(page, 'Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

// Next's route announcer is also role="alert", so match the message text.
export async function expectSignInRejected(page: Page) {
  await expect(
    page.getByRole('alert').filter({ hasText: 'The email or password is incorrect.' }),
  ).toBeVisible();
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

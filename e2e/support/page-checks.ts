import type { Page } from '@playwright/test';

export { adminOrigin, storeOrigin } from '../../tests/support/test-app';

// Demo images come from picsum.photos (an allowed CSP image host). Answering them locally keeps
// "network idle" independent of internet access; CSP is still enforced before the request is routed.
const demoImageHost = /^https:\/\/(fastly\.)?picsum\.photos\//;
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

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
  await page.route(demoImageHost, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: onePixelPng }),
  );
  const response = await page.goto(url);
  await page.waitForLoadState('networkidle');
  return { status: response?.status(), uncaughtPageErrors, contentSecurityPolicyViolations };
}

// One letter per browser project, so parallel projects never create test data with the same name.
export function projectLetter(projectName: string): 'D' | 'M' | 'T' {
  if (projectName.includes('360')) return 'M';
  if (projectName.includes('tablet')) return 'T';
  return 'D';
}

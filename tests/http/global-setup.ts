import { appBaseUrl, storeHost } from '../support/test-app';

export default async function assertAppServerIsRunning(): Promise<void> {
  try {
    await fetch(`${appBaseUrl}/api/health`, { headers: { Host: storeHost } });
  } catch {
    throw new Error(
      `No app server at ${appBaseUrl}. Run "npm run build && npm run start:test" first, or set APP_BASE_URL.`,
    );
  }
}

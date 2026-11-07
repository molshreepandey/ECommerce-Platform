import path from 'node:path';

import { loadConfigFile } from '../../src/lib/config/load-config';

const testConfig = loadConfigFile(path.resolve(process.cwd(), 'config', 'config.test.json'));

function hostOf(origin: string): string {
  return new URL(origin).host;
}

export const storeOrigin = testConfig.surfaces.store.publicOrigin;
export const adminOrigin = testConfig.surfaces.admin.publicOrigin;
export const storeHost = hostOf(storeOrigin);
export const adminHost = hostOf(adminOrigin);
export const testServerPort = Number(new URL(storeOrigin).port);
export const appBaseUrl = process.env['APP_BASE_URL'] ?? `http://127.0.0.1:${testServerPort}`;

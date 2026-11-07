import { getEnvironment } from '@/lib/env';

import type { AppConfig } from './config.schema';
import { loadConfigFile, resolveConfigFilePath } from './load-config';

export type { AppConfig, AppEnvironment, RateLimitAction, RateLimitPolicy } from './config.schema';
export { InvalidConfigError } from './load-config';

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cachedConfig !== undefined) return cachedConfig;
  const environment = getEnvironment();
  cachedConfig = loadConfigFile(
    resolveConfigFilePath({
      appEnvironment: environment.APP_ENV,
      explicitConfigFilePath: environment.APP_CONFIG_PATH,
      projectRoot: process.cwd(),
    }),
  );
  return cachedConfig;
}

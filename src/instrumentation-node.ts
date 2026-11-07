import { getConfig } from '@/lib/config';
import { getEnvironment } from '@/lib/env';

export function validateStartupConfiguration(): void {
  try {
    getEnvironment();
    getConfig();
  } catch (error) {
    // Exit instead of serving 500s so deployments and process managers see a failed start.
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

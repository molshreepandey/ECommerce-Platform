import { getConfig } from '@/lib/config';
import { getEnvironment } from '@/lib/env';
import { getLogger } from '@/lib/logger';

export function validateStartupConfiguration(): void {
  try {
    getEnvironment();
    getConfig();
  } catch (error) {
    // Exit instead of serving 500s so deployments and process managers see a failed start.
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  const warning = deploymentWarning(getEnvironment().APP_ENV, getConfig());
  if (warning !== null) getLogger().warn({ event: 'deployment_warning' }, warning);
}

// With no trusted proxy hop the client IP is unknown: registration then shares one site-wide limit and
// the per-IP guest cart and search limits are off. Kept at 0 until the proxy chain is verified (owner
// decision), so production says so at every start instead of failing.
export function deploymentWarning(
  appEnvironment: string,
  config: { authentication: { trustedProxyHopCount: number } },
): string | null {
  if (appEnvironment !== 'production' || config.authentication.trustedProxyHopCount > 0)
    return null;
  return 'authentication.trustedProxyHopCount is 0: client IPs are unknown, so IP-based rate limits are shared or off. Set it to the number of trusted proxies in front of the app.';
}

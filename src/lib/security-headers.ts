import type { AppConfig } from '@/lib/config';
import type { Surface } from '@/lib/host-routing';

type ContentSecurityPolicyConfig = AppConfig['security']['contentSecurityPolicy'];

function directive(name: string, sources: readonly string[]): string {
  return `${name} ${sources.join(' ')}`;
}

export function buildContentSecurityPolicy(input: {
  policy: ContentSecurityPolicyConfig;
  isDevelopmentServer: boolean;
  upgradeInsecureRequests: boolean;
}): string {
  const { policy } = input;
  const scriptSources = ["'self'", "'unsafe-inline'", ...policy.scriptSources];
  // Next's dev server (React Refresh) evaluates code at runtime; production never gets 'unsafe-eval'.
  if (input.isDevelopmentServer) scriptSources.push("'unsafe-eval'");
  const directives = [
    directive('default-src', ["'self'"]),
    directive('script-src', scriptSources),
    directive('style-src', ["'self'", "'unsafe-inline'"]),
    directive('img-src', ["'self'", ...policy.imageSources]),
    directive('font-src', ["'self'"]),
    directive('connect-src', ["'self'", ...policy.connectSources]),
    directive('frame-src', policy.frameSources.length > 0 ? policy.frameSources : ["'none'"]),
    directive('frame-ancestors', ["'none'"]),
    directive('object-src', ["'none'"]),
    directive('base-uri', ["'self'"]),
    directive('form-action', ["'self'"]),
  ];
  if (input.upgradeInsecureRequests) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export function buildRuntimeSecurityHeaders(input: {
  config: AppConfig;
  surface: Surface;
  isDevelopmentServer: boolean;
}): Record<string, string> {
  const { security, surfaces } = input.config;
  const servedOverHttps = surfaces[input.surface].publicOrigin.startsWith('https://');
  const headers: Record<string, string> = {
    'Content-Security-Policy': buildContentSecurityPolicy({
      policy: security.contentSecurityPolicy,
      isDevelopmentServer: input.isDevelopmentServer,
      upgradeInsecureRequests: servedOverHttps,
    }),
  };
  if (servedOverHttps && security.strictTransportSecurityMaxAgeSeconds > 0) {
    headers['Strict-Transport-Security'] =
      `max-age=${security.strictTransportSecurityMaxAgeSeconds}; includeSubDomains`;
  }
  return headers;
}

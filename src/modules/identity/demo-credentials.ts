import { getConfig } from '@/lib/config';
import { DomainError } from '@/lib/errors';
import { getEnvironment } from '@/lib/env';

// Publicly documented (README) for local development and tests. Never valid in staging or production.
export const demoPassword = 'DemoPass!2026';
export const demoEmailDomain = 'demo-store.test';

const environmentsAllowingDemoCredentials: ReadonlySet<string> = new Set(['development', 'test']);

export function demoCredentialsAllowedIn(appEnvironment: string | undefined): boolean {
  return appEnvironment !== undefined && environmentsAllowingDemoCredentials.has(appEnvironment);
}

// Both must agree: the config flag and APP_ENV. Flipping the flag in production still refuses.
export function demoCredentialsPermitted(input: {
  configAllows: boolean;
  appEnvironment: string | undefined;
}): boolean {
  return input.configAllows && demoCredentialsAllowedIn(input.appEnvironment);
}

export function assertDemoCredentialsAllowed(appEnvironment: string | undefined): void {
  if (!demoCredentialsAllowedIn(appEnvironment)) {
    throw new Error(
      `Refusing to seed demo accounts or demo passwords: APP_ENV is "${appEnvironment ?? '(not set)'}", ` +
        'and demo credentials are allowed only when APP_ENV is "development" or "test".',
    );
  }
}

export function demoCredentialField(input: {
  email: string;
  password: string;
}): 'email' | 'password' | null {
  if (input.email.toLowerCase().endsWith(`@${demoEmailDomain}`)) return 'email';
  if (input.password === demoPassword) return 'password';
  return null;
}

const reservedCredentialMessages = {
  email: 'This email domain is reserved for demo accounts. Use a different email.',
  password: 'This password is publicly known. Choose a different password.',
} as const;

export class ReservedDemoCredentialError extends DomainError {
  constructor(field: 'email' | 'password') {
    super({
      kind: 'VALIDATION',
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      details: { fieldErrors: { [field]: [reservedCredentialMessages[field]] } },
    });
  }
}

// True when these credentials must be refused here: demo email domain or demo password, outside dev/test.
export function refusedDemoCredentialField(input: {
  email: string;
  password: string;
}): 'email' | 'password' | null {
  const permitted = demoCredentialsPermitted({
    configAllows: getConfig().authentication.demoAccountsAllowed,
    appEnvironment: getEnvironment().APP_ENV,
  });
  return permitted ? null : demoCredentialField(input);
}

import { describe, expect, it } from 'vitest';

import {
  assertDemoCredentialsAllowed,
  demoCredentialField,
  demoCredentialsPermitted,
  demoPassword,
} from './demo-credentials';

describe('assertDemoCredentialsAllowed (seed guard)', () => {
  it.each(['development', 'test'])('allows APP_ENV=%s', (appEnvironment) => {
    expect(() => {
      assertDemoCredentialsAllowed(appEnvironment);
    }).not.toThrow();
  });

  it.each([
    ['production', 'production'],
    ['staging', 'staging'],
    ['a typo', 'prod'],
    ['different letter case', 'Production'],
    ['an empty value', ''],
    ['no value', undefined],
  ])('refuses %s', (_label, appEnvironment) => {
    expect(() => {
      assertDemoCredentialsAllowed(appEnvironment);
    }).toThrow(/Refusing to seed demo/);
  });
});

describe('demoCredentialsPermitted (sign-in and registration)', () => {
  it('needs both the config flag and a development or test APP_ENV', () => {
    expect(demoCredentialsPermitted({ configAllows: true, appEnvironment: 'development' })).toBe(
      true,
    );
    expect(demoCredentialsPermitted({ configAllows: true, appEnvironment: 'test' })).toBe(true);
    expect(demoCredentialsPermitted({ configAllows: false, appEnvironment: 'development' })).toBe(
      false,
    );
    expect(demoCredentialsPermitted({ configAllows: true, appEnvironment: 'production' })).toBe(
      false,
    );
    expect(demoCredentialsPermitted({ configAllows: true, appEnvironment: 'staging' })).toBe(false);
  });
});

describe('demoCredentialField', () => {
  it('flags the demo email domain in any letter case', () => {
    expect(demoCredentialField({ email: 'Super.Admin@Demo-Store.test', password: 'x' })).toBe(
      'email',
    );
  });

  it('flags the demo password on any email', () => {
    expect(demoCredentialField({ email: 'someone@example.com', password: demoPassword })).toBe(
      'password',
    );
  });

  it('ignores ordinary credentials and look-alike domains', () => {
    expect(demoCredentialField({ email: 'someone@example.com', password: 'DemoPass!2027' })).toBe(
      null,
    );
    expect(demoCredentialField({ email: 'a@not-demo-store.test', password: 'x' })).toBe(null);
  });
});

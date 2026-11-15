import { describe, expect, it } from 'vitest';

import { demoPassword } from '../../../prisma/seed/demo-credentials';

import { FirstAdminRefusedError, parseFirstAdminEnvironment } from './first-admin.service';
import { permissionCodes } from './permissions';
import { permissionCatalogue, roleCatalogue } from './rbac-catalogue';

const strongPassword = 'Railway-First-Admin-2026!';
const valid = {
  FIRST_ADMIN_NAME: '  Owner Admin ',
  FIRST_ADMIN_EMAIL: ' Owner@Example.COM ',
  FIRST_ADMIN_PASSWORD: strongPassword,
};

function refusal(environment: Record<string, string | undefined>): string {
  try {
    parseFirstAdminEnvironment(environment);
  } catch (error) {
    if (error instanceof FirstAdminRefusedError) return error.message;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('parseFirstAdminEnvironment', () => {
  it('accepts valid settings and normalises the name and email', () => {
    expect(parseFirstAdminEnvironment(valid)).toEqual({
      fullName: 'Owner Admin',
      email: 'owner@example.com',
      password: strongPassword,
    });
  });

  it('names every missing variable', () => {
    const message = refusal({});
    for (const name of ['FIRST_ADMIN_NAME', 'FIRST_ADMIN_EMAIL', 'FIRST_ADMIN_PASSWORD']) {
      expect(message).toContain(name);
    }
  });

  it('refuses a password shorter than the staff policy (12) and never echoes it', () => {
    const message = refusal({ ...valid, FIRST_ADMIN_PASSWORD: 'Short-1x' });
    expect(message).toContain('FIRST_ADMIN_PASSWORD: Use at least 12 characters');
    expect(message).not.toContain('Short-1x');
  });

  it('refuses an invalid email', () => {
    expect(refusal({ ...valid, FIRST_ADMIN_EMAIL: 'not-an-email' })).toContain('FIRST_ADMIN_EMAIL');
  });

  it('refuses the demo email domain and the public demo password in every environment', () => {
    expect(refusal({ ...valid, FIRST_ADMIN_EMAIL: 'boss@demo-store.test' })).toContain(
      'demo email domain is reserved',
    );
    const message = refusal({ ...valid, FIRST_ADMIN_PASSWORD: demoPassword });
    expect(message).toContain('publicly known');
    expect(message).not.toContain(demoPassword);
  });
});

describe('RBAC catalogue', () => {
  it('gives SUPER_ADMIN every permission and every role only known permissions', () => {
    const known = new Set<string>(permissionCodes);
    expect(new Set(permissionCatalogue.map(({ code }) => code))).toEqual(known);
    const superAdmin = roleCatalogue.find(({ code }) => code === 'SUPER_ADMIN');
    expect(new Set(superAdmin?.permissionCodes)).toEqual(known);
    for (const role of roleCatalogue) {
      for (const code of role.permissionCodes)
        expect(known.has(code), `${role.code}: ${code}`).toBe(true);
    }
    expect(new Set(roleCatalogue.map(({ code }) => code)).size).toBe(roleCatalogue.length);
  });
});

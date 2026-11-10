import { describe, expect, it } from 'vitest';

import { permissionSeeds } from '../../../prisma/seed/identity.seed';

import { isPermissionCode, permissionCodes } from './permissions';

describe('permission codes', () => {
  it('match exactly the permissions the seed creates', () => {
    expect([...permissionCodes].sort()).toEqual(permissionSeeds.map(({ code }) => code).sort());
  });

  it('recognise only known codes', () => {
    expect(isPermissionCode('orders.write')).toBe(true);
    expect(isPermissionCode('orders.delete')).toBe(false);
  });
});

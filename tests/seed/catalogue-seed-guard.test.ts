import { describe, expect, it } from 'vitest';

import {
  catalogueSeedConfirmationVariable,
  catalogueSeedRefusal,
} from '../../prisma/seed/catalogue-seed-guard';

describe('catalogueSeedRefusal', () => {
  it('allows development and test without an opt-in', () => {
    expect(catalogueSeedRefusal({ APP_ENV: 'development' })).toBeNull();
    expect(catalogueSeedRefusal({ APP_ENV: 'test' })).toBeNull();
  });

  it('refuses staging unless the opt-in names staging', () => {
    expect(catalogueSeedRefusal({ APP_ENV: 'staging' })).toContain(
      catalogueSeedConfirmationVariable,
    );
    expect(
      catalogueSeedRefusal({ APP_ENV: 'staging', [catalogueSeedConfirmationVariable]: 'yes' }),
    ).not.toBeNull();
    expect(
      catalogueSeedRefusal({ APP_ENV: 'staging', [catalogueSeedConfirmationVariable]: 'staging' }),
    ).toBeNull();
  });

  it('always refuses production, even with an opt-in', () => {
    for (const confirmation of [undefined, 'staging', 'production']) {
      expect(
        catalogueSeedRefusal({
          APP_ENV: 'production',
          [catalogueSeedConfirmationVariable]: confirmation,
        }),
      ).toMatch(/never loaded into production/);
    }
  });

  it('refuses a missing or unknown APP_ENV', () => {
    expect(catalogueSeedRefusal({})).toMatch(/not set/);
    expect(catalogueSeedRefusal({ APP_ENV: 'prod' })).not.toBeNull();
  });
});

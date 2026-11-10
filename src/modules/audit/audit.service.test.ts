import { describe, expect, it } from 'vitest';

import { removeSensitiveFields } from './audit.service';

describe('removeSensitiveFields', () => {
  it('drops anything that looks like a secret, whatever the casing', () => {
    expect(
      removeSensitiveFields({
        email: 'asha@example.test',
        fullName: 'Asha',
        password: 'x',
        passwordHash: 'x',
        sessionToken: 'x',
        apiSecret: 'x',
        otpCode: 'x',
        Cookie: 'x',
        credentials: 'x',
        reason: 'WRONG_PASSWORD_ATTEMPT',
      }),
    ).toEqual({ email: 'asha@example.test', fullName: 'Asha', reason: 'WRONG_PASSWORD_ATTEMPT' });
  });

  it('keeps an absent payload absent', () => {
    expect(removeSensitiveFields(undefined)).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import { hashPassword, verifyAgainstDummyHash, verifyPassword } from './password-hasher';

describe('password hasher (Argon2id)', () => {
  it('produces an Argon2id hash with the configured parameters', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    expect(passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('verifies the right password and rejects others', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword(passwordHash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, 'Correct horse battery staple')).resolves.toBe(false);
    await expect(verifyPassword(passwordHash, '')).resolves.toBe(false);
  });

  it('salts every hash differently', async () => {
    expect(await hashPassword('same password')).not.toBe(await hashPassword('same password'));
  });

  it('treats a malformed stored hash as a failed verification instead of throwing', async () => {
    await expect(
      verifyPassword('SEED_PLACEHOLDER_PASSWORD_HASH_REPLACED_IN_WAVE_2', 'anything'),
    ).resolves.toBe(false);
  });

  it('the dummy verification always fails and takes about as long as a real one', async () => {
    const realHash = await hashPassword('timing check');
    await verifyAgainstDummyHash('warm up');
    const realStartedAt = performance.now();
    await verifyPassword(realHash, 'wrong password');
    const realMilliseconds = performance.now() - realStartedAt;
    const dummyStartedAt = performance.now();
    await expect(verifyAgainstDummyHash('wrong password')).resolves.toBe(false);
    const dummyMilliseconds = performance.now() - dummyStartedAt;
    expect(dummyMilliseconds).toBeGreaterThan(realMilliseconds * 0.4);
    expect(dummyMilliseconds).toBeLessThan(realMilliseconds * 2.5 + 5);
  });
});

import { describe, expect, it } from 'vitest';

import { generateSessionToken, hashSessionToken } from './session-token';

describe('session tokens', () => {
  it('are 32 random bytes encoded as URL-safe base64 and never repeat', () => {
    const tokens = new Set(Array.from({ length: 1_000 }, generateSessionToken));
    expect(tokens.size).toBe(1_000);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('are stored as a 64-character SHA-256 hex digest, not as the token itself', () => {
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toContain(token);
    expect(hashSessionToken(token)).toBe(tokenHash);
  });
});

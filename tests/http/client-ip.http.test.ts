import { describe, expect, it } from 'vitest';

import { waitForFreshRateLimitWindow } from '../integration/support/rate-limit-window';
import { callApi } from './app-server';

// The test server runs with trustedProxyHopCount 0, like local development.
const customerSignInLimit = 20;
const windowSeconds = 60;

describe('X-Forwarded-For when no proxy is trusted', () => {
  it('does not let a forged header open a new rate-limit bucket', async () => {
    const email = `forged.http.${Date.now()}@example.test`;
    await waitForFreshRateLimitWindow(windowSeconds, 20_000);
    for (let attempt = 1; attempt <= customerSignInLimit; attempt += 1) {
      const response = await callApi('post', 'store', '/api/store/auth/login', {
        body: { email, password: 'Wrong-Password-1' },
      }).set('X-Forwarded-For', `198.51.100.${attempt}`);
      expect(response.status).toBe(401);
    }
    const overLimit = await callApi('post', 'store', '/api/store/auth/login', {
      body: { email, password: 'Wrong-Password-1' },
    }).set('X-Forwarded-For', '198.51.100.250');
    expect(overLimit.status).toBe(429);
    expect(overLimit.headers['retry-after']).toMatch(/^\d+$/);
  });
});

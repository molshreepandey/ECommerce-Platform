import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { getConfig } from '@/lib/config';
import { DomainError } from '@/lib/errors';
import { customerIdSchema } from '@/lib/ids';
import { limitCartWrites } from '@/modules/cart/cart-rate-limit';

import { testMetadata } from './support/identity-fixtures';

// The `cart-write` policy existed in every config but no route applied it; cart and coupon writes now do.
describe('cart write rate limit', () => {
  it('allows the configured budget per customer, then answers 429; guests are counted by IP', async () => {
    const { maxRequests } = getConfig().rateLimits['cart-write'];
    const customer = { customerId: customerIdSchema.parse(randomUUID()), sessionId: randomUUID() };
    for (let index = 0; index < maxRequests; index += 1) {
      await limitCartWrites(customer, testMetadata());
    }
    const refused = await limitCartWrites(customer, testMetadata()).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused instanceof DomainError ? refused.code : refused).toBe('RATE_LIMITED');
    const guestIp = `198.18.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250))}`;
    for (let index = 0; index < maxRequests; index += 1) {
      await limitCartWrites(null, testMetadata(guestIp));
    }
    const guestRefused = await limitCartWrites(null, testMetadata(guestIp)).then(
      () => null,
      (error: unknown) => error,
    );
    expect(guestRefused instanceof DomainError ? guestRefused.code : guestRefused).toBe(
      'RATE_LIMITED',
    );
  });

  it('never puts guests with an unknown IP into one shared bucket (M3)', async () => {
    const { maxRequests } = getConfig().rateLimits['cart-write'];
    const unknownIp = { ...testMetadata(), clientIp: null };
    for (let index = 0; index < maxRequests + 5; index += 1) {
      await limitCartWrites(null, unknownIp);
    }
  });
});

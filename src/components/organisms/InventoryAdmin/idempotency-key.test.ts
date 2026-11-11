import { describe, expect, it } from 'vitest';

import { createIdempotencyKeeper } from './idempotency-key';

function counterKeys() {
  let next = 0;
  return () => `key-${String((next += 1)).padStart(16, '0')}`;
}

describe('createIdempotencyKeeper', () => {
  it('reuses the key while the same change is retried', () => {
    const keeper = createIdempotencyKeeper(counterKeys());
    const change = { operation: 'ADD', quantity: 2, reason: 'Found' };
    const first = keeper.keyFor(change);
    expect(keeper.keyFor({ ...change })).toBe(first);
  });

  it('gives a different change its own key, and an earlier change its earlier key', () => {
    const keeper = createIdempotencyKeeper(counterKeys());
    const first = keeper.keyFor({ quantity: 2 });
    const second = keeper.keyFor({ quantity: 3 });
    expect(second).not.toBe(first);
    expect(keeper.keyFor({ quantity: 2 })).toBe(first);
  });

  it('forgets a change once it is confirmed, so doing it again later is a new change', () => {
    const keeper = createIdempotencyKeeper(counterKeys());
    const change = { quantity: 2 };
    const first = keeper.keyFor(change);
    keeper.forget(change);
    expect(keeper.keyFor(change)).not.toBe(first);
  });

  it('uses random UUIDs by default', () => {
    expect(createIdempotencyKeeper().keyFor({})).toMatch(/^[0-9a-f-]{36}$/);
  });
});

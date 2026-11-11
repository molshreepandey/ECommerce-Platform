import { describe, expect, it } from 'vitest';

import { LockOrderTracker, LockOrderViolation } from './lock-order';

describe('LockOrderTracker', () => {
  it('returns keys sorted, lower-cased and without duplicates', () => {
    const tracker = new LockOrderTracker();
    expect(tracker.enter('WAREHOUSES', ['C', 'a', 'B', 'a'])).toEqual(['a', 'b', 'c']);
  });

  it('allows going down the hierarchy, including skipped levels', () => {
    const tracker = new LockOrderTracker();
    expect(() => {
      tracker.enter('SHIPMENTS', ['s1']);
      tracker.enter('PRODUCTS', ['p1']);
      tracker.enter('WAREHOUSES', ['w1']);
      tracker.enter('STOCK_LEVELS', ['v1/w1']);
    }).not.toThrow();
  });

  it('refuses to go back up the hierarchy', () => {
    const tracker = new LockOrderTracker();
    tracker.enter('STOCK_LEVELS', ['v1/w1']);
    expect(() => tracker.enter('WAREHOUSES', ['w1'])).toThrow(LockOrderViolation);
    const second = new LockOrderTracker();
    second.enter('WAREHOUSES', ['w1']);
    expect(() => second.enter('SHIPMENTS', ['s1'])).toThrow(
      /Cannot lock SHIPMENTS after WAREHOUSES/,
    );
  });

  it('allows more keys at the same level only if they sort after every key already held', () => {
    const tracker = new LockOrderTracker();
    tracker.enter('STOCK_LEVELS', ['b']);
    expect(tracker.enter('STOCK_LEVELS', ['c', 'd'])).toEqual(['c', 'd']);
    expect(() => tracker.enter('STOCK_LEVELS', ['a'])).toThrow(/ascending order/);
  });

  it('allows re-locking keys it already holds, which never waits', () => {
    const tracker = new LockOrderTracker();
    tracker.enter('SHIPMENTS', ['s1', 's2']);
    expect(tracker.enter('SHIPMENTS', ['s2', 's1'])).toEqual(['s1', 's2']);
    expect(tracker.enter('SHIPMENTS', ['s1', 's3'])).toEqual(['s1', 's3']);
  });

  it('treats an empty set of keys as no lock at all', () => {
    const tracker = new LockOrderTracker();
    tracker.enter('STOCK_LEVELS', ['v1/w1']);
    expect(tracker.enter('PRODUCTS', [])).toEqual([]);
  });

  it('knows which keys it holds, whatever their case', () => {
    const tracker = new LockOrderTracker();
    tracker.enter('STOCK_LEVELS', ['V1/W1']);
    expect(tracker.holds('STOCK_LEVELS', 'v1/w1')).toBe(true);
    expect(tracker.holds('STOCK_LEVELS', 'v2/w1')).toBe(false);
    expect(tracker.holds('WAREHOUSES', 'v1/w1')).toBe(false);
  });
});

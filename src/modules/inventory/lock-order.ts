import { type DatabaseClient, getDatabase } from '@/lib/db';

// The global lock hierarchy (TD-019). A transaction takes row locks from the top down only; it may skip
// levels but never goes back up, and within one level it locks keys in ascending order.
// ORDERS and SHIPMENTS are taken by order code (Waves 8–9) before inventory runs; inventory itself locks
// SHIPMENTS first for every reservation change. Inserts (movements, audit, outbox) come after all levels.
export const lockLevels = {
  ORDERS: 0,
  SHIPMENTS: 1,
  CHANGE_REQUESTS: 2,
  PRODUCTS: 3,
  VARIANTS: 4,
  WAREHOUSES: 5,
  STOCK_LEVELS: 6,
} as const;
export type LockLevel = keyof typeof lockLevels;

export class LockOrderViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockOrderViolation';
  }
}

// Pure bookkeeping for one transaction. It decides; the caller then runs the locking query.
export class LockOrderTracker {
  private highestRank = -1;
  private highestLevel: LockLevel | null = null;
  private readonly heldKeys = new Map<LockLevel, Set<string>>();
  private readonly greatestKey = new Map<LockLevel, string>();

  // Returns the sorted, de-duplicated keys to lock. Keys already held are allowed again (re-locking a row the
  // transaction already holds never waits); a new key must sort after every key already held at its level.
  enter(level: LockLevel, keys: readonly string[]): string[] {
    const sortedKeys = [...new Set(keys.map((key) => key.toLowerCase()))].sort();
    if (sortedKeys.length === 0) return [];
    const rank = lockLevels[level];
    if (rank < this.highestRank) {
      throw new LockOrderViolation(
        `Cannot lock ${level} after ${this.highestLevel ?? 'nothing'}: locks must go down the hierarchy`,
      );
    }
    const held = this.heldKeys.get(level) ?? new Set<string>();
    const newKeys = sortedKeys.filter((key) => !held.has(key));
    const greatest = this.greatestKey.get(level);
    const [firstNewKey] = newKeys;
    if (firstNewKey !== undefined && greatest !== undefined && firstNewKey <= greatest) {
      throw new LockOrderViolation(
        `Cannot lock ${level} key ${firstNewKey} after ${greatest}: keys must be locked in ascending order`,
      );
    }
    for (const key of newKeys) held.add(key);
    this.heldKeys.set(level, held);
    const lastNewKey = newKeys.at(-1);
    if (lastNewKey !== undefined) this.greatestKey.set(level, lastNewKey);
    this.highestRank = rank;
    this.highestLevel = level;
    return sortedKeys;
  }

  holds(level: LockLevel, key: string): boolean {
    return this.heldKeys.get(level)?.has(key.toLowerCase()) ?? false;
  }
}

// One tracker per interactive transaction (the transaction client object is stable for its callback).
const trackers = new WeakMap<object, LockOrderTracker>();

function trackerFor(transaction: DatabaseClient): LockOrderTracker {
  // A row lock outside a transaction is released at once, so it would protect nothing.
  if (transaction === getDatabase()) {
    throw new LockOrderViolation('Row locks must be taken inside a transaction');
  }
  const existing = trackers.get(transaction);
  if (existing !== undefined) return existing;
  const tracker = new LockOrderTracker();
  trackers.set(transaction, tracker);
  return tracker;
}

export function enterLockLevel(
  transaction: DatabaseClient,
  level: LockLevel,
  keys: readonly string[],
): string[] {
  return trackerFor(transaction).enter(level, keys);
}

// Guarded stock updates run only on rows the transaction has already locked in order.
export function assertLocked(transaction: DatabaseClient, level: LockLevel, key: string): void {
  if (!trackerFor(transaction).holds(level, key)) {
    throw new LockOrderViolation(`${level} ${key} must be locked before it is changed`);
  }
}

import { createHash } from 'node:crypto';
import { seedDayStart } from './seed-clock';

// Ids keep the row's offset from the seed day but on a fixed base, so re-running the seed on another day reuses them.
const fixedIdBaseMilliseconds = Date.UTC(2026, 0, 1);

export function deterministicUuidV7(name: string, timestamp: Date): string {
  const idTimestampMilliseconds =
    fixedIdBaseMilliseconds + (timestamp.getTime() - seedDayStart.getTime());
  const hashHex = createHash('sha256').update(name).digest('hex');
  const timestampHex = idTimestampMilliseconds.toString(16).padStart(12, '0').slice(-12);
  const variantNibble = ((Number.parseInt(hashHex.slice(3, 4), 16) & 0x3) | 0x8).toString(16);
  return [
    timestampHex.slice(0, 8),
    timestampHex.slice(8, 12),
    `7${hashHex.slice(0, 3)}`,
    `${variantNibble}${hashHex.slice(4, 7)}`,
    hashHex.slice(7, 19),
  ].join('-');
}

export function requireValue<Value>(value: Value | undefined, description: string): Value {
  if (value === undefined) {
    throw new Error(`Seed data is missing ${description}`);
  }
  return value;
}

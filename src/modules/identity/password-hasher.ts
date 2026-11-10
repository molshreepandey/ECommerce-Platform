import { randomBytes } from 'node:crypto';

import { hash, verify } from '@node-rs/argon2';

import { getConfig } from '@/lib/config';

const argon2idAlgorithm = 2;

function hashingOptions() {
  const { memoryCostKib, timeCost, parallelism } = getConfig().authentication.passwordHashing;
  return { algorithm: argon2idAlgorithm, memoryCost: memoryCostKib, timeCost, parallelism };
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, hashingOptions());
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyPasswordHash: Promise<string> | undefined;

// Spends the same time as a real verification so response time does not reveal whether an account exists.
export async function verifyAgainstDummyHash(password: string): Promise<false> {
  dummyPasswordHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(await dummyPasswordHash, password);
  return false;
}

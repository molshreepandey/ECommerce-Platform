import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';

import { Prisma, PrismaClient } from '@/generated/prisma/client';
import { getConfig } from '@/lib/config';
import { getEnvironment } from '@/lib/env';

declare global {
  // Reused across hot reloads in development so each edit doesn't open a new pool.
  var prismaClientSingleton: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const { database } = getConfig();
  const adapter = new PrismaPg({
    connectionString: getEnvironment().DATABASE_URL,
    max: database.poolMaxConnections,
    connectionTimeoutMillis: database.connectionTimeoutMilliseconds,
    idleTimeoutMillis: database.idleTimeoutMilliseconds,
  });
  return new PrismaClient({ adapter });
}

export function getDatabase(): PrismaClient {
  globalThis.prismaClientSingleton ??= createPrismaClient();
  return globalThis.prismaClientSingleton;
}

export type DatabaseClient = PrismaClient | Prisma.TransactionClient;

export function isUniqueViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// Measured shape with @prisma/adapter-pg 7.10: meta.driverAdapterError.cause.constraint.index = "<constraint name>".
const uniqueViolationMetaSchema = z.object({
  driverAdapterError: z.object({
    cause: z.object({ constraint: z.object({ index: z.string() }) }),
  }),
});

export function uniqueViolationConstraintName(
  error: Prisma.PrismaClientKnownRequestError,
): string | null {
  const parsed = uniqueViolationMetaSchema.safeParse(error.meta);
  return parsed.success ? parsed.data.driverAdapterError.cause.constraint.index : null;
}

// Prisma gives every transaction-manager error the code P2028, so the code alone is not enough: it also
// covers "cannot be executed on a committed transaction" (the work did commit), a rolled-back transaction,
// nested transactions and internal consistency errors. Only two P2028 messages are genuine timeouts after
// which nothing was committed and the request may be sent again (measured in Prisma 7.10.1,
// runtime/client.js; an upgrade must re-check them, the integration test does with a real timeout):
// - the transaction outlived its timeout (default 5 s) and was rolled back: "… cannot be executed on an
//   expired transaction …", with meta { timeout, timeTaken };
// - no connection became free within maxWait (default 2 s), so it never started: "Unable to start a
//   transaction in the given time."
const expiredTransactionMessage = /cannot be executed on an expired transaction\./;
const transactionStartTimeoutMessage = /Unable to start a transaction in the given time\./;

export function isTransactionTimeout(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2028')
    return false;
  return (
    expiredTransactionMessage.test(error.message) ||
    transactionStartTimeoutMessage.test(error.message)
  );
}

export function isForeignKeyViolation(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}

// Measured with @prisma/adapter-pg 7.10: foreign-key errors carry the constraint name in the same place.
export const foreignKeyViolationConstraintName = uniqueViolationConstraintName;

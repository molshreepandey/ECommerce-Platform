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

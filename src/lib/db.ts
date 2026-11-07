import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@/generated/prisma/client';
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

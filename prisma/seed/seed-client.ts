import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';

function readDatabaseUrl(): string {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run the seed');
  }
  return databaseUrl;
}

export function createSeedClient(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: readDatabaseUrl() }) });
}

export type SeedClient = PrismaClient;

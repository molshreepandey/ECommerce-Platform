import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { type Prisma, PrismaClient } from '../../src/generated/prisma/client';

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

// Seeders take a transaction client too, so the catalogue-only seed can write everything in one transaction.
export type SeedClient = Prisma.TransactionClient;

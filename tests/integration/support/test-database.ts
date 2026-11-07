import { z } from 'zod';

import { getDatabase } from '@/lib/db';

import {
  assertConnectedDatabaseName,
  assertTestDatabaseUrl,
} from '../../support/test-target-guard';

const currentDatabaseRowsSchema = z.tuple([z.object({ name: z.string() })]);
const tableRowsSchema = z.array(z.object({ table_name: z.string() }));

export async function currentDatabaseName(): Promise<string> {
  const [row] = currentDatabaseRowsSchema.parse(
    await getDatabase().$queryRaw`SELECT current_database() AS name`,
  );
  return row.name;
}

async function assertTalkingToTestDatabase(): Promise<void> {
  assertTestDatabaseUrl(
    process.env['DATABASE_URL'],
    process.env['INTEGRATION_DEVELOPMENT_DATABASE_URL'],
  );
  assertConnectedDatabaseName(await currentDatabaseName());
}

export async function truncateAllTestTables(): Promise<void> {
  await assertTalkingToTestDatabase();
  const tables = tableRowsSchema.parse(
    await getDatabase().$queryRaw`
      SELECT tablename AS table_name FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (tables.length === 0) return;
  const quotedTableNames = tables.map(
    ({ table_name }) => `"public"."${table_name.replaceAll('"', '""')}"`,
  );
  await getDatabase().$executeRawUnsafe(
    `TRUNCATE TABLE ${quotedTableNames.join(', ')} RESTART IDENTITY CASCADE`,
  );
}

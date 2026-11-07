import { spawnSync } from 'node:child_process';

import { Client } from 'pg';

import {
  assertConnectedDatabaseName,
  assertTestDatabaseUrl,
  databaseNameFromUrl,
} from './test-target-guard';

async function withClient<Result>(
  connectionString: string,
  work: (client: Client) => Promise<Result>,
): Promise<Result> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function createTestDatabaseIfMissing(testDatabaseUrl: string): Promise<void> {
  const databaseName = databaseNameFromUrl(testDatabaseUrl);
  const maintenanceUrl = new URL(testDatabaseUrl);
  maintenanceUrl.pathname = '/postgres';
  await withClient(maintenanceUrl.toString(), async (client) => {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);
    if (existing.rowCount === 0) await client.query(`CREATE DATABASE "${databaseName}"`);
  });
}

function applyMigrations(testDatabaseUrl: string): void {
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed for the test database:\n${result.stderr}`);
  }
}

export async function prepareTestDatabase(input: {
  testDatabaseUrl: string | undefined;
  developmentDatabaseUrl: string | undefined;
}): Promise<string> {
  const testDatabaseUrl = assertTestDatabaseUrl(
    input.testDatabaseUrl,
    input.developmentDatabaseUrl,
  );
  await createTestDatabaseIfMissing(testDatabaseUrl);
  assertTestDatabaseUrl(testDatabaseUrl, input.developmentDatabaseUrl);
  applyMigrations(testDatabaseUrl);
  await withClient(testDatabaseUrl, async (client) => {
    const { rows } = await client.query<{ name: string }>('SELECT current_database() AS name');
    assertConnectedDatabaseName(rows[0]?.name ?? '');
  });
  return testDatabaseUrl;
}

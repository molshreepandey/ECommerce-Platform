import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';

import {
  assertConnectedDatabaseName,
  assertTestDatabaseUrl,
} from '../../support/test-target-guard';

// HTTP tests normally only talk to the server. A few need to put an account into a state that has no API
// yet (blocked, deactivated); they do it here, on the guarded *_test database only.
export async function runOnTestDatabase(sql: string, parameters: unknown[]): Promise<number> {
  loadDotenv({ quiet: true });
  const testDatabaseUrl = assertTestDatabaseUrl(
    process.env['TEST_DATABASE_URL'],
    process.env['DATABASE_URL'],
  );
  const client = new Client({ connectionString: testDatabaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string }>('SELECT current_database() AS name');
    assertConnectedDatabaseName(rows[0]?.name ?? '');
    return (await client.query(sql, parameters)).rowCount ?? 0;
  } finally {
    await client.end();
  }
}

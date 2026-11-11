import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';

import {
  assertConnectedDatabaseName,
  assertTestDatabaseUrl,
} from '../../support/test-target-guard';

// HTTP tests normally only talk to the server. A few need to put an account into a state that has no API
// yet (blocked, deactivated); they do it here, on the guarded *_test database only.
async function connectToTestDatabase(): Promise<Client> {
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
    return client;
  } catch (error) {
    await client.end();
    throw error;
  }
}

export async function runOnTestDatabase(sql: string, parameters: unknown[]): Promise<number> {
  const client = await connectToTestDatabase();
  try {
    return (await client.query(sql, parameters)).rowCount ?? 0;
  } finally {
    await client.end();
  }
}

// Takes row locks (`lockSql` must be a SELECT … FOR UPDATE) in an open transaction on the guarded test
// database and keeps them until `release`, so a test can make the server wait on a row. `waitForWaiter`
// returns once PostgreSQL itself reports another backend blocked by this one (no sleep decides it).
export async function holdRowLocksOnTestDatabase(lockSql: string, parameters: unknown[]) {
  const holder = await connectToTestDatabase();
  let lockedRows: number;
  let holderPid: number;
  try {
    await holder.query('BEGIN');
    lockedRows = (await holder.query(lockSql, parameters)).rowCount ?? 0;
    const { rows } = await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    holderPid = rows[0]?.pid ?? 0;
  } catch (error) {
    // Never leave an open transaction or connection behind; the original error is the one rethrown.
    await holder.query('ROLLBACK').catch(() => undefined);
    await holder.end().catch(() => undefined);
    throw error;
  }
  return {
    lockedRows,
    async waitForWaiter(): Promise<void> {
      const observer = await connectToTestDatabase();
      try {
        for (let attempt = 0; attempt < 400; attempt += 1) {
          const result = await observer.query<{ waiting: number }>(
            'SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))',
            [holderPid],
          );
          if ((result.rows[0]?.waiting ?? 0) > 0) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error('nothing waited on the held row lock');
      } finally {
        await observer.end();
      }
    },
    async release(): Promise<void> {
      try {
        await holder.query('ROLLBACK');
      } finally {
        await holder.end();
      }
    },
  };
}

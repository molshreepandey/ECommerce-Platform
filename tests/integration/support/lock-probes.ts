import { z } from 'zod';

import type { Prisma } from '@/generated/prisma/client';
import { type DatabaseClient, getDatabase } from '@/lib/db';

const database = getDatabase();

// Runs `lock` inside a transaction, then `check` on other connections while those locks are still held.
export async function whileLocked<T>(
  lock: (transaction: DatabaseClient) => Promise<unknown>,
  check: () => Promise<T>,
): Promise<T> {
  const outcome: { value?: T } = {};
  await database.$transaction(
    async (transaction) => {
      await lock(transaction);
      outcome.value = await check();
    },
    { timeout: 20_000 },
  );
  if (!('value' in outcome)) throw new Error('the check did not run');
  return outcome.value;
}

// True when another connection can take this row lock right now (NOWAIT fails instead of waiting).
export async function canLock(query: Prisma.Sql): Promise<boolean> {
  try {
    await database.$transaction(async (transaction) => {
      await transaction.$queryRaw(query);
    });
    return true;
  } catch (error) {
    if (error instanceof Error && /could not obtain lock|55P03/.test(error.message)) return false;
    throw error;
  }
}

export async function backendProcessId(transaction: DatabaseClient): Promise<number> {
  const [row] = z
    .tuple([z.object({ pid: z.number() })])
    .parse(await transaction.$queryRaw`SELECT pg_backend_pid() AS pid`);
  return row.pid;
}

// Waits until PostgreSQL reports some backend blocked by `holder` (polled from another connection).
export async function waitUntilSomeoneWaitsOn(holder: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const [row] = z
      .tuple([z.object({ waiting: z.number() })])
      .parse(
        await database.$queryRaw`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE ${holder}::int = ANY(pg_blocking_pids(pid))`,
      );
    if (row.waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`nothing ever waited on backend ${String(holder)}`);
}

const pidRowsSchema = z.array(z.object({ pid: z.number() }));

// The backends PostgreSQL currently reports as blocked by `holder`.
export async function backendsWaitingOn(holder: number): Promise<number[]> {
  return pidRowsSchema
    .parse(
      await database.$queryRaw`SELECT pid FROM pg_stat_activity WHERE ${holder}::int = ANY(pg_blocking_pids(pid)) ORDER BY pid`,
    )
    .map(({ pid }) => pid);
}

// Waits until exactly one backend is blocked by `holder` and returns its process id.
export async function waitForWaiterOn(holder: number): Promise<number> {
  await waitUntilSomeoneWaitsOn(holder);
  const [waiter] = await backendsWaitingOn(holder);
  if (waiter === undefined) throw new Error(`no backend waits on ${String(holder)}`);
  return waiter;
}

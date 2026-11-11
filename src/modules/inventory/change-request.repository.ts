import { z } from 'zod';

import type { DatabaseClient } from '@/lib/db';

import { enterLockLevel } from './lock-order';

const insertedRowsSchema = z.array(z.object({ id: z.string() })).max(1);

// L1. Returns the new request id, or null when this staff member already used the key. A duplicate
// running at the same time waits here on the unique index until the first transaction ends.
export async function insertChangeRequestIfNew(
  transaction: DatabaseClient,
  input: { staffUserId: string; idempotencyKey: string; requestFingerprint: string },
): Promise<string | null> {
  enterLockLevel(transaction, 'CHANGE_REQUESTS', [`${input.staffUserId}/${input.idempotencyKey}`]);
  const [inserted] = insertedRowsSchema.parse(
    await transaction.$queryRaw`
      INSERT INTO inventory_change_requests (staff_user_id, idempotency_key, request_fingerprint)
      VALUES (${input.staffUserId}::uuid, ${input.idempotencyKey}, ${input.requestFingerprint})
      ON CONFLICT (staff_user_id, idempotency_key) DO NOTHING
      RETURNING id::text AS id`,
  );
  return inserted?.id ?? null;
}

export function findChangeRequest(
  database: DatabaseClient,
  input: { staffUserId: string; idempotencyKey: string },
): Promise<{ id: string; requestFingerprint: string } | null> {
  return database.inventoryChangeRequest.findUnique({
    where: {
      staffUserId_idempotencyKey: {
        staffUserId: input.staffUserId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: { id: true, requestFingerprint: true },
  });
}

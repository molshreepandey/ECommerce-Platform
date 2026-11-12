import type { DatabaseClient } from '@/lib/db';

// Unlocked: the returns code (Wave 12) holds its return request while it restocks, so the receiving
// warehouse cannot change during the call (TD-022). Missing ids are simply absent from the map.
export async function findReceivingWarehouses(
  database: DatabaseClient,
  returnRequestIds: readonly string[],
): Promise<Map<string, string | null>> {
  if (returnRequestIds.length === 0) return new Map();
  const rows = await database.returnRequest.findMany({
    where: { id: { in: [...returnRequestIds] } },
    select: { id: true, receivingWarehouseId: true },
  });
  return new Map(rows.map((row) => [row.id, row.receivingWarehouseId]));
}

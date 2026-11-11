import { enforceRateLimit } from '@/lib/rate-limit/rate-limit';
import type { StaffContext } from '@/modules/identity/access-control';

// One write budget per staff member, shared by every warehouse and stock write route (policy
// `inventory-write` in config/config.<env>.json; TD-020). Routes call it after the permission check, so
// anonymous or unauthorised requests never use a staff member's budget. The staff id is SHA-256 hashed
// before it becomes a Redis key or a Postgres row (buildBucketKey). Reads are not limited.
export async function limitInventoryWrites(staff: StaffContext): Promise<void> {
  await enforceRateLimit({ action: 'inventory-write', identifier: staff.staffUserId });
}

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { idempotencyKeyFrom } from '@/lib/request-idempotency';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { limitInventoryWrites } from '@/modules/inventory/inventory-rate-limit';
import { idempotencyKeySchema, transferStockSchema } from '@/modules/inventory/inventory.schema';
import { transferStock } from '@/modules/inventory/stock-transfer.service';

// D27: up to 100 lines from one warehouse to another, all or nothing; 409 OUT_OF_STOCK when a line asks
// for more than is available at the source. Needs an Idempotency-Key, like receipts.
export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'inventory.write');
  await limitInventoryWrites(staff);
  const idempotencyKey = idempotencyKeyFrom(request, idempotencyKeySchema);
  const input = await parseJsonBody(request, transferStockSchema);
  const actor = {
    kind: 'STAFF' as const,
    staff,
    metadata: requestMetadata(request, requestContext),
  };
  const result = await transferStock(actor, idempotencyKey, input);
  return Response.json({ stockRequest: result }, { status: result.replayed ? 200 : 201 });
});

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { idempotencyKeyFrom } from '@/lib/request-idempotency';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { limitInventoryWrites } from '@/modules/inventory/inventory-rate-limit';
import { idempotencyKeySchema, receiveStockSchema } from '@/modules/inventory/inventory.schema';
import { receiveStock } from '@/modules/inventory/stock-receipt.service';

// A supplier receipt of up to 100 lines into one warehouse, applied all or nothing. Needs an
// Idempotency-Key, like adjustments.
export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'inventory.write');
  await limitInventoryWrites(staff);
  const idempotencyKey = idempotencyKeyFrom(request, idempotencyKeySchema);
  const input = await parseJsonBody(request, receiveStockSchema);
  const actor = {
    kind: 'STAFF' as const,
    staff,
    metadata: requestMetadata(request, requestContext),
  };
  const result = await receiveStock(actor, idempotencyKey, input);
  return Response.json({ stockRequest: result }, { status: result.replayed ? 200 : 201 });
});

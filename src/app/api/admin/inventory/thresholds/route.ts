import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { limitInventoryWrites } from '@/modules/inventory/inventory-rate-limit';
import { setLowStockThresholdSchema } from '@/modules/inventory/inventory.schema';
import { setLowStockThreshold } from '@/modules/inventory/low-stock-threshold.service';

// Sets the low-stock threshold of one variant in one warehouse. Setting the same value again changes
// nothing, so PUT needs no idempotency key.
export const PUT = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'inventory.write');
  await limitInventoryWrites(staff);
  const input = await parseJsonBody(request, setLowStockThresholdSchema);
  const actor = {
    kind: 'STAFF' as const,
    staff,
    metadata: requestMetadata(request, requestContext),
  };
  return Response.json(await setLowStockThreshold(actor, input));
});

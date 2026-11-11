import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { idempotencyKeyFrom } from '@/lib/request-idempotency';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { limitInventoryWrites } from '@/modules/inventory/inventory-rate-limit';
import {
  idempotencyKeySchema,
  type StockAdjustmentInput,
  stockAdjustmentSchema,
} from '@/modules/inventory/inventory.schema';
import { addStock, removeStock, setStock } from '@/modules/inventory/stock-adjustment.service';
import type { StaffInventoryActor } from '@/modules/inventory/inventory-actor';
import type { StockRequestResult } from '@/modules/inventory/stock-request-result';

// `operation` only picks the service; it is not part of the input the service fingerprints.
function applyAdjustment(
  actor: StaffInventoryActor,
  idempotencyKey: string,
  body: StockAdjustmentInput,
): Promise<StockRequestResult> {
  const location = { variantId: body.variantId, warehouseId: body.warehouseId };
  switch (body.operation) {
    case 'ADD':
      return addStock(actor, idempotencyKey, {
        ...location,
        quantity: body.quantity,
        reason: body.reason,
      });
    case 'REMOVE':
      return removeStock(actor, idempotencyKey, {
        ...location,
        quantity: body.quantity,
        reason: body.reason,
      });
    case 'SET':
      return setStock(actor, idempotencyKey, {
        ...location,
        expectedOnHandQuantity: body.expectedOnHandQuantity,
        newOnHandQuantity: body.newOnHandQuantity,
        reason: body.reason,
      });
    default: {
      const unknownBody: never = body;
      throw new Error(`Unknown adjustment: ${JSON.stringify(unknownBody)}`);
    }
  }
}

// Add, remove or set on-hand stock with a reason. Needs an Idempotency-Key: a retry with the same key and
// body returns the original result (200, replayed) instead of applying the change again.
export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'inventory.write');
  await limitInventoryWrites(staff);
  const idempotencyKey = idempotencyKeyFrom(request, idempotencyKeySchema);
  const body = await parseJsonBody(request, stockAdjustmentSchema);
  const actor = {
    kind: 'STAFF' as const,
    staff,
    metadata: requestMetadata(request, requestContext),
  };
  const result = await applyAdjustment(actor, idempotencyKey, body);
  return Response.json({ stockRequest: result }, { status: result.replayed ? 200 : 201 });
});

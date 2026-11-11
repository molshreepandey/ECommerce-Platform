import { apiHandler } from '@/lib/api-handler';
import { warehouseIdSchema } from '@/lib/ids';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { limitInventoryWrites } from '@/modules/inventory/inventory-rate-limit';
import { changeWarehouseStatusSchema } from '@/modules/inventory/inventory.schema';
import { changeWarehouseStatus } from '@/modules/inventory/warehouse.service';

type Context = RouteContext<'/api/admin/warehouses/[warehouseId]/status'>;

// Activate or deactivate. Deactivating stops new reservations there and never touches stock or
// existing reservations.
export const POST = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'warehouses.write');
  await limitInventoryWrites(staff);
  const warehouseId = warehouseIdSchema.parse((await routeContext.params).warehouseId);
  const input = await parseJsonBody(request, changeWarehouseStatusSchema);
  const actor = {
    kind: 'STAFF' as const,
    staff,
    metadata: requestMetadata(request, requestContext),
  };
  const warehouse = await changeWarehouseStatus(actor, warehouseId, input);
  return Response.json({ warehouse });
});

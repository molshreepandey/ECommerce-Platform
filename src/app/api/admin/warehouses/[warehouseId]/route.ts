import { apiHandler } from '@/lib/api-handler';
import { warehouseIdSchema } from '@/lib/ids';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { limitInventoryWrites } from '@/modules/inventory/inventory-rate-limit';
import { updateWarehouseSchema } from '@/modules/inventory/inventory.schema';
import { getWarehouse, updateWarehouse } from '@/modules/inventory/warehouse.service';

type Context = RouteContext<'/api/admin/warehouses/[warehouseId]'>;

async function warehouseIdFrom(routeContext: Context): Promise<string> {
  return warehouseIdSchema.parse((await routeContext.params).warehouseId);
}

export const GET = apiHandler<Context>(async (request, routeContext) => {
  const staff = await requirePermission(request, 'inventory.read');
  const warehouse = await getWarehouse(staff, await warehouseIdFrom(routeContext));
  return Response.json({ warehouse });
});

// Partial update: only the submitted fields change (concurrent edits of the same field: last save wins).
export const PATCH = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'warehouses.write');
  await limitInventoryWrites(staff);
  const warehouseId = await warehouseIdFrom(routeContext);
  const input = await parseJsonBody(request, updateWarehouseSchema);
  const actor = {
    kind: 'STAFF' as const,
    staff,
    metadata: requestMetadata(request, requestContext),
  };
  const warehouse = await updateWarehouse(actor, warehouseId, input);
  return Response.json({ warehouse });
});

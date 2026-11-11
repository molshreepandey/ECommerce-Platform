import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { limitInventoryWrites } from '@/modules/inventory/inventory-rate-limit';
import { createWarehouseSchema } from '@/modules/inventory/inventory.schema';
import { createWarehouse, listWarehouses } from '@/modules/inventory/warehouse.service';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'inventory.read');
  const warehouses = await listWarehouses(staff);
  return Response.json({ warehouses });
});

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'warehouses.write');
  await limitInventoryWrites(staff);
  const input = await parseJsonBody(request, createWarehouseSchema);
  const actor = {
    kind: 'STAFF' as const,
    staff,
    metadata: requestMetadata(request, requestContext),
  };
  const warehouse = await createWarehouse(actor, input);
  return Response.json({ warehouse }, { status: 201 });
});

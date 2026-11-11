import { apiHandler } from '@/lib/api-handler';
import { parseSearchParams } from '@/lib/request-query';
import { requirePermission } from '@/modules/identity/access-control';
import { listLowStockSchema } from '@/modules/inventory/inventory.schema';
import { countLowStock, listLowStock } from '@/modules/inventory/inventory-query.service';

// Stock rows at or below their threshold, with the total for the same filters. Read-only.
export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'inventory.read');
  const input = parseSearchParams(request, listLowStockSchema);
  const [page, totalCount] = await Promise.all([
    listLowStock(staff, input),
    countLowStock(staff, {
      warehouseId: input.warehouseId,
      includeInactiveWarehouses: input.includeInactiveWarehouses,
    }),
  ]);
  return Response.json({ ...page, totalCount });
});

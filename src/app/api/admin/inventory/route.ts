import { apiHandler } from '@/lib/api-handler';
import { parseSearchParams } from '@/lib/request-query';
import { requirePermission } from '@/modules/identity/access-control';
import { listStockLevelsSchema } from '@/modules/inventory/inventory.schema';
import { listStockLevels } from '@/modules/inventory/inventory-query.service';

// Stock matrix: variant × warehouse, paged by product. Read-only.
export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'inventory.read');
  const input = parseSearchParams(request, listStockLevelsSchema);
  return Response.json(await listStockLevels(staff, input));
});

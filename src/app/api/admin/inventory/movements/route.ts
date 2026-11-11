import { apiHandler } from '@/lib/api-handler';
import { parseSearchParams } from '@/lib/request-query';
import { requirePermission } from '@/modules/identity/access-control';
import { listMovementsSchema } from '@/modules/inventory/inventory.schema';
import { listMovements } from '@/modules/inventory/inventory-query.service';

// The inventory ledger, newest first, with before and after quantities. Read-only.
export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'inventory.read');
  const input = parseSearchParams(request, listMovementsSchema);
  return Response.json(await listMovements(staff, input));
});

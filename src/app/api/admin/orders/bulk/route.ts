import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { bulkOrderActionSchema, runBulkOrderAction } from '@/modules/ordering/bulk-actions.service';

// D38: 200 with one result per order (succeeded or the reason it was refused).
export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'orders.write');
  const input = await parseJsonBody(request, bulkOrderActionSchema);
  const results = await runBulkOrderAction(staff, input, requestMetadata(request, requestContext));
  return Response.json({
    results,
    succeeded: results.filter(({ isSuccess }) => isSuccess).length,
    failed: results.filter(({ isSuccess }) => !isSuccess).length,
  });
});

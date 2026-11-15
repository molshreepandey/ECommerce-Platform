import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { recategoriseProducts } from '@/modules/taxonomy/tagging.service';
import { recategoriseProductsSchema } from '@/modules/taxonomy/taxonomy.schema';

// D21: move every non-archived product from category A to leaf category B (200 with the moved ids).
export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'taxonomy.write');
  const input = await parseJsonBody(request, recategoriseProductsSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  return Response.json(await recategoriseProducts(actor, input));
});

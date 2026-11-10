import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { tagProducts } from '@/modules/taxonomy/tagging.service';
import { tagProductsSchema } from '@/modules/taxonomy/taxonomy.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'taxonomy.write');
  const input = await parseJsonBody(request, tagProductsSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await tagProducts(actor, input);
  return Response.json(result);
});

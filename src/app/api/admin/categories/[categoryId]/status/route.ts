import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { changeCategoryStatus } from '@/modules/taxonomy/category.service';
import { changeCategoryStatusSchema } from '@/modules/taxonomy/taxonomy.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

type Context = RouteContext<'/api/admin/categories/[categoryId]/status'>;

async function categoryIdFrom(routeContext: Context): Promise<string> {
  return z.uuid().parse((await routeContext.params).categoryId);
}

export const POST = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'taxonomy.write');
  const categoryId = await categoryIdFrom(routeContext);
  const input = await parseJsonBody(request, changeCategoryStatusSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await changeCategoryStatus(actor, categoryId, input);
  return Response.json({ category: result });
});

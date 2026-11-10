import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { deleteCategory, updateCategory } from '@/modules/taxonomy/category.service';
import { updateCategorySchema } from '@/modules/taxonomy/taxonomy.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

type Context = RouteContext<'/api/admin/categories/[categoryId]'>;

async function categoryIdFrom(routeContext: Context): Promise<string> {
  return z.uuid().parse((await routeContext.params).categoryId);
}

export const PATCH = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'taxonomy.write');
  const categoryId = await categoryIdFrom(routeContext);
  const input = await parseJsonBody(request, updateCategorySchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await updateCategory(actor, categoryId, input);
  return Response.json({ category: result });
});

export const DELETE = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'taxonomy.write');
  const categoryId = await categoryIdFrom(routeContext);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  await deleteCategory(actor, categoryId);
  return new Response(null, { status: 204 });
});

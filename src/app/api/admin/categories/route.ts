import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { createCategory, listCategoryTree } from '@/modules/taxonomy/category.service';
import { createCategorySchema } from '@/modules/taxonomy/taxonomy.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'catalogue.read');
  const result = await listCategoryTree(staff);
  return Response.json({ categories: result });
});

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'taxonomy.write');
  const input = await parseJsonBody(request, createCategorySchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await createCategory(actor, input);
  return Response.json({ category: result }, { status: 201 });
});

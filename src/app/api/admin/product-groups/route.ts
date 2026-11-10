import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { parseSearchParams } from '@/lib/request-query';
import { createProductGroup, listProductGroups } from '@/modules/grouping/product-group.service';
import {
  createProductGroupSchema,
  listProductGroupsSchema,
} from '@/modules/grouping/grouping.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'catalogue.read');
  const input = parseSearchParams(request, listProductGroupsSchema);
  const result = await listProductGroups(staff, input);
  return Response.json({ productGroups: result });
});

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'taxonomy.write');
  const input = await parseJsonBody(request, createProductGroupSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await createProductGroup(actor, input);
  return Response.json({ productGroup: result }, { status: 201 });
});

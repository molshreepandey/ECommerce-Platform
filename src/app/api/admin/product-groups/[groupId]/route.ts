import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import {
  deleteProductGroup,
  getProductGroup,
  renameProductGroup,
} from '@/modules/grouping/product-group.service';
import { renameProductGroupSchema } from '@/modules/grouping/grouping.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

type Context = RouteContext<'/api/admin/product-groups/[groupId]'>;

async function groupIdFrom(routeContext: Context): Promise<string> {
  return z.uuid().parse((await routeContext.params).groupId);
}

export const GET = apiHandler<Context>(async (request, routeContext) => {
  const staff = await requirePermission(request, 'catalogue.read');
  const groupId = await groupIdFrom(routeContext);
  const result = await getProductGroup(staff, groupId);
  return Response.json({ productGroup: result });
});

export const PATCH = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'taxonomy.write');
  const groupId = await groupIdFrom(routeContext);
  const input = await parseJsonBody(request, renameProductGroupSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await renameProductGroup(actor, groupId, input);
  return Response.json({ productGroup: result });
});

export const DELETE = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'taxonomy.write');
  const groupId = await groupIdFrom(routeContext);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  await deleteProductGroup(actor, groupId);
  return new Response(null, { status: 204 });
});

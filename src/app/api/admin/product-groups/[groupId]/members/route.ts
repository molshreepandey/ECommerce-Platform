import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { addGroupMembers, setGroupMembers } from '@/modules/grouping/product-group.service';
import { addGroupMembersSchema, setGroupMembersSchema } from '@/modules/grouping/grouping.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

type Context = RouteContext<'/api/admin/product-groups/[groupId]/members'>;

async function groupIdFrom(routeContext: Context): Promise<string> {
  return z.uuid().parse((await routeContext.params).groupId);
}

export const POST = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'taxonomy.write');
  const groupId = await groupIdFrom(routeContext);
  const input = await parseJsonBody(request, addGroupMembersSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await addGroupMembers(actor, groupId, input);
  return Response.json({ productGroup: result });
});

export const PUT = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'taxonomy.write');
  const groupId = await groupIdFrom(routeContext);
  const input = await parseJsonBody(request, setGroupMembersSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await setGroupMembers(actor, groupId, input);
  return Response.json({ productGroup: result });
});

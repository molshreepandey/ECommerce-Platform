import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { removeGroupMember } from '@/modules/grouping/product-group.service';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

type Context = RouteContext<'/api/admin/product-groups/[groupId]/members/[productId]'>;

async function idsFrom(routeContext: Context): Promise<{ groupId: string; productId: string }> {
  const { groupId, productId } = await routeContext.params;
  return { groupId: z.uuid().parse(groupId), productId: z.uuid().parse(productId) };
}

export const DELETE = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'taxonomy.write');
  const { groupId, productId } = await idsFrom(routeContext);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await removeGroupMember(actor, groupId, productId);
  return Response.json({ productGroup: result });
});

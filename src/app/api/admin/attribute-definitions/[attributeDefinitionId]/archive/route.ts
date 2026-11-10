import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { archiveAttributeDefinition } from '@/modules/catalogue/product-type.service';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

type Context = RouteContext<'/api/admin/attribute-definitions/[attributeDefinitionId]/archive'>;

async function attributeDefinitionIdFrom(routeContext: Context): Promise<string> {
  return z.uuid().parse((await routeContext.params).attributeDefinitionId);
}

export const POST = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'catalogue.write');
  const attributeDefinitionId = await attributeDefinitionIdFrom(routeContext);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await archiveAttributeDefinition(actor, attributeDefinitionId);
  return Response.json({ attributeDefinition: result });
});

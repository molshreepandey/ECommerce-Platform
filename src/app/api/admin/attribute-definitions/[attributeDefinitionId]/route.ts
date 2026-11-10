import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { updateAttributeDefinition } from '@/modules/catalogue/product-type.service';
import { updateAttributeDefinitionSchema } from '@/modules/catalogue/catalogue.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

type Context = RouteContext<'/api/admin/attribute-definitions/[attributeDefinitionId]'>;

async function attributeDefinitionIdFrom(routeContext: Context): Promise<string> {
  return z.uuid().parse((await routeContext.params).attributeDefinitionId);
}

export const PATCH = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'catalogue.write');
  const attributeDefinitionId = await attributeDefinitionIdFrom(routeContext);
  const input = await parseJsonBody(request, updateAttributeDefinitionSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await updateAttributeDefinition(actor, attributeDefinitionId, input);
  return Response.json({ attributeDefinition: result });
});

import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { createAttributeDefinition } from '@/modules/catalogue/product-type.service';
import { createAttributeDefinitionSchema } from '@/modules/catalogue/catalogue.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

type Context = RouteContext<'/api/admin/product-types/[productTypeId]/attribute-definitions'>;

async function productTypeIdFrom(routeContext: Context): Promise<string> {
  return z.uuid().parse((await routeContext.params).productTypeId);
}

export const POST = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'catalogue.write');
  const productTypeId = await productTypeIdFrom(routeContext);
  const input = await parseJsonBody(request, createAttributeDefinitionSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await createAttributeDefinition(actor, productTypeId, input);
  return Response.json({ attributeDefinition: result }, { status: 201 });
});

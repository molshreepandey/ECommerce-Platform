import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { createVariant } from '@/modules/catalogue/variant.service';
import { createVariantSchema } from '@/modules/catalogue/catalogue.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

type Context = RouteContext<'/api/admin/products/[productId]/variants'>;

async function productIdFrom(routeContext: Context): Promise<string> {
  return z.uuid().parse((await routeContext.params).productId);
}

export const POST = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'catalogue.write');
  const productId = await productIdFrom(routeContext);
  const input = await parseJsonBody(request, createVariantSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await createVariant(actor, productId, input);
  return Response.json(result, { status: 201 });
});

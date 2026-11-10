import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { changeProductStatus } from '@/modules/catalogue/product.service';
import { changeProductStatusSchema } from '@/modules/catalogue/catalogue.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

type Context = RouteContext<'/api/admin/products/[productId]/status'>;

async function productIdFrom(routeContext: Context): Promise<string> {
  return z.uuid().parse((await routeContext.params).productId);
}

export const POST = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'catalogue.write');
  const productId = await productIdFrom(routeContext);
  const input = await parseJsonBody(request, changeProductStatusSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await changeProductStatus(actor, productId, input);
  return Response.json({ product: result });
});

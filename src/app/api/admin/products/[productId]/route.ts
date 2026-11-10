import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { getProduct, updateProduct } from '@/modules/catalogue/product.service';
import { updateProductSchema } from '@/modules/catalogue/catalogue.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

type Context = RouteContext<'/api/admin/products/[productId]'>;

async function productIdFrom(routeContext: Context): Promise<string> {
  return z.uuid().parse((await routeContext.params).productId);
}

export const GET = apiHandler<Context>(async (request, routeContext) => {
  const staff = await requirePermission(request, 'catalogue.read');
  const productId = await productIdFrom(routeContext);
  const result = await getProduct(staff, productId);
  return Response.json({ product: result });
});

export const PATCH = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'catalogue.write');
  const productId = await productIdFrom(routeContext);
  const input = await parseJsonBody(request, updateProductSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await updateProduct(actor, productId, input);
  return Response.json({ product: result });
});

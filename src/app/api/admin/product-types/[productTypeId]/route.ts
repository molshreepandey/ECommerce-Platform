import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { getProductType, updateProductType } from '@/modules/catalogue/product-type.service';
import { updateProductTypeSchema } from '@/modules/catalogue/catalogue.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

type Context = RouteContext<'/api/admin/product-types/[productTypeId]'>;

async function productTypeIdFrom(routeContext: Context): Promise<string> {
  return z.uuid().parse((await routeContext.params).productTypeId);
}

export const GET = apiHandler<Context>(async (request, routeContext) => {
  const staff = await requirePermission(request, 'catalogue.read');
  const productTypeId = await productTypeIdFrom(routeContext);
  const result = await getProductType(staff, productTypeId);
  return Response.json({ productType: result });
});

export const PATCH = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'catalogue.write');
  const productTypeId = await productTypeIdFrom(routeContext);
  const input = await parseJsonBody(request, updateProductTypeSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await updateProductType(actor, productTypeId, input);
  return Response.json({ productType: result });
});

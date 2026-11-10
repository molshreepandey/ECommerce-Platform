import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { archiveProductType } from '@/modules/catalogue/product-type.service';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

type Context = RouteContext<'/api/admin/product-types/[productTypeId]/archive'>;

async function productTypeIdFrom(routeContext: Context): Promise<string> {
  return z.uuid().parse((await routeContext.params).productTypeId);
}

export const POST = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'catalogue.write');
  const productTypeId = await productTypeIdFrom(routeContext);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await archiveProductType(actor, productTypeId);
  return Response.json({ productType: result });
});

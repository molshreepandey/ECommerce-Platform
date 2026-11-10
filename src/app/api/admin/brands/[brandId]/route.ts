import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { updateBrand } from '@/modules/catalogue/brand.service';
import { updateBrandSchema } from '@/modules/catalogue/catalogue.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

type Context = RouteContext<'/api/admin/brands/[brandId]'>;

async function brandIdFrom(routeContext: Context): Promise<string> {
  return z.uuid().parse((await routeContext.params).brandId);
}

export const PATCH = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'catalogue.write');
  const brandId = await brandIdFrom(routeContext);
  const input = await parseJsonBody(request, updateBrandSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await updateBrand(actor, brandId, input);
  return Response.json({ brand: result });
});

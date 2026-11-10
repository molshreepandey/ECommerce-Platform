import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { changeVariantStatus } from '@/modules/catalogue/variant.service';
import { changeVariantStatusSchema } from '@/modules/catalogue/catalogue.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

type Context = RouteContext<'/api/admin/variants/[variantId]/status'>;

async function variantIdFrom(routeContext: Context): Promise<string> {
  return z.uuid().parse((await routeContext.params).variantId);
}

export const POST = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'catalogue.write');
  const variantId = await variantIdFrom(routeContext);
  const input = await parseJsonBody(request, changeVariantStatusSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await changeVariantStatus(actor, variantId, input);
  return Response.json(result);
});

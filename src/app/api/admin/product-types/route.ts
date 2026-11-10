import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { createProductType, listAllProductTypes } from '@/modules/catalogue/product-type.service';
import { createProductTypeSchema } from '@/modules/catalogue/catalogue.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'catalogue.read');
  const result = await listAllProductTypes(staff);
  return Response.json({ productTypes: result });
});

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'catalogue.write');
  const input = await parseJsonBody(request, createProductTypeSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await createProductType(actor, input);
  return Response.json({ productType: result }, { status: 201 });
});

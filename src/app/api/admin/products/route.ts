import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { parseSearchParams } from '@/lib/request-query';
import { createProduct, listProducts } from '@/modules/catalogue/product.service';
import { createProductSchema, listProductsSchema } from '@/modules/catalogue/catalogue.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'catalogue.read');
  const input = parseSearchParams(request, listProductsSchema);
  const result = await listProducts(staff, input);
  return Response.json(result);
});

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'catalogue.write');
  const input = await parseJsonBody(request, createProductSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await createProduct(actor, input);
  return Response.json({ product: result }, { status: 201 });
});

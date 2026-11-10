import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { createBrand, listBrands } from '@/modules/catalogue/brand.service';
import { createBrandSchema } from '@/modules/catalogue/catalogue.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'catalogue.read');
  const result = await listBrands(staff);
  return Response.json({ brands: result });
});

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'catalogue.write');
  const input = await parseJsonBody(request, createBrandSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await createBrand(actor, input);
  return Response.json({ brand: result }, { status: 201 });
});

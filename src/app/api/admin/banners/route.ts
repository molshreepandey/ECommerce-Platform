import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { bannerSchema } from '@/modules/merchandising/merchandising.schema';
import { createBanner, listBanners } from '@/modules/merchandising/merchandising.service';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'catalogue.read');
  return Response.json({ banners: await listBanners(staff) });
});

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'merchandising.write');
  const input = await parseJsonBody(request, bannerSchema);
  return Response.json(
    { banner: await createBanner(staff, input, requestMetadata(request, requestContext)) },
    { status: 201 },
  );
});

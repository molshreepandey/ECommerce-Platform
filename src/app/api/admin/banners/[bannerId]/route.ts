import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { bannerSchema } from '@/modules/merchandising/merchandising.schema';
import { deleteBanner, updateBanner } from '@/modules/merchandising/merchandising.service';

import { uuidParam } from '../../merchandising-id';

type RouteContext = { params: Promise<{ bannerId: string }> };

export const PUT = apiHandler(async (request, { params }: RouteContext, requestContext) => {
  const staff = await requirePermission(request, 'merchandising.write');
  const bannerId = await uuidParam(params, 'bannerId', 'BANNER_NOT_FOUND');
  const input = await parseJsonBody(request, bannerSchema);
  return Response.json({
    banner: await updateBanner(staff, bannerId, input, requestMetadata(request, requestContext)),
  });
});

export const DELETE = apiHandler(async (request, { params }: RouteContext, requestContext) => {
  const staff = await requirePermission(request, 'merchandising.write');
  const bannerId = await uuidParam(params, 'bannerId', 'BANNER_NOT_FOUND');
  await deleteBanner(staff, bannerId, requestMetadata(request, requestContext));
  return new Response(null, { status: 204 });
});

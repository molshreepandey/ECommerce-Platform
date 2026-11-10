import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { deleteMedia, updateMedia } from '@/modules/catalogue/media.service';
import { updateMediaSchema } from '@/modules/catalogue/catalogue.schema';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';

type Context = RouteContext<'/api/admin/media/[mediaId]'>;

async function mediaIdFrom(routeContext: Context): Promise<string> {
  return z.uuid().parse((await routeContext.params).mediaId);
}

export const PATCH = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'catalogue.write');
  const mediaId = await mediaIdFrom(routeContext);
  const input = await parseJsonBody(request, updateMediaSchema);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await updateMedia(actor, mediaId, input);
  return Response.json(result);
});

export const DELETE = apiHandler<Context>(async (request, routeContext, requestContext) => {
  const staff = await requirePermission(request, 'catalogue.write');
  const mediaId = await mediaIdFrom(routeContext);
  const actor = { staff, metadata: requestMetadata(request, requestContext) };
  const result = await deleteMedia(actor, mediaId);
  return Response.json(result);
});

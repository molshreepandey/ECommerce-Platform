import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { collectionSchema } from '@/modules/merchandising/merchandising.schema';
import { getCollection, updateCollection } from '@/modules/merchandising/merchandising.service';

import { uuidParam } from '../../merchandising-id';

type RouteContext = { params: Promise<{ collectionId: string }> };

export const GET = apiHandler(async (request, { params }: RouteContext) => {
  const staff = await requirePermission(request, 'catalogue.read');
  const collectionId = await uuidParam(params, 'collectionId', 'COLLECTION_NOT_FOUND');
  return Response.json({ collection: await getCollection(staff, collectionId) });
});

export const PUT = apiHandler(async (request, { params }: RouteContext, requestContext) => {
  const staff = await requirePermission(request, 'merchandising.write');
  const collectionId = await uuidParam(params, 'collectionId', 'COLLECTION_NOT_FOUND');
  const input = await parseJsonBody(request, collectionSchema);
  const collection = await updateCollection(
    staff,
    collectionId,
    input,
    requestMetadata(request, requestContext),
  );
  return Response.json({ collection });
});

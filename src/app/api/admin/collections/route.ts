import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { collectionSchema } from '@/modules/merchandising/merchandising.schema';
import { createCollection, listCollections } from '@/modules/merchandising/merchandising.service';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'catalogue.read');
  return Response.json({ collections: await listCollections(staff) });
});

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'merchandising.write');
  const input = await parseJsonBody(request, collectionSchema);
  const collection = await createCollection(staff, input, requestMetadata(request, requestContext));
  return Response.json({ collection }, { status: 201 });
});

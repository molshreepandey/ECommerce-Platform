import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { collectionProductsSchema } from '@/modules/merchandising/merchandising.schema';
import { setCollectionProducts } from '@/modules/merchandising/merchandising.service';

import { uuidParam } from '../../../merchandising-id';

export const PUT = apiHandler(
  async (request, { params }: { params: Promise<{ collectionId: string }> }, requestContext) => {
    const staff = await requirePermission(request, 'merchandising.write');
    const collectionId = await uuidParam(params, 'collectionId', 'COLLECTION_NOT_FOUND');
    const { productIds } = await parseJsonBody(request, collectionProductsSchema);
    await setCollectionProducts(
      staff,
      collectionId,
      productIds,
      requestMetadata(request, requestContext),
    );
    return new Response(null, { status: 204 });
  },
);

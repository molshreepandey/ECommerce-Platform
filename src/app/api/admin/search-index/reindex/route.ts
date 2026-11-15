import { apiHandler } from '@/lib/api-handler';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { reindexSearchNow } from '@/modules/search/search-admin.service';

// D48 full reindex with alias swap; 409 REINDEX_RUNNING, 503 SEARCH_UNAVAILABLE.
export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'search.manage');
  return Response.json({
    reindex: await reindexSearchNow(staff, requestMetadata(request, requestContext)),
  });
});

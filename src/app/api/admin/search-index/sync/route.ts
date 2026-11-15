import { apiHandler } from '@/lib/api-handler';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { syncSearchIndexNow } from '@/modules/search/search-admin.service';

// D48 "Sync now": drains queued changes; 503 SEARCH_UNAVAILABLE while Elasticsearch is down (rows stay queued).
export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'search.manage');
  return Response.json({
    sync: await syncSearchIndexNow(staff, requestMetadata(request, requestContext)),
  });
});

import { apiHandler } from '@/lib/api-handler';
import { requirePermission } from '@/modules/identity/access-control';
import { getSearchIndexStatus } from '@/modules/search/search-admin.service';

// D48: index health and outbox backlog (search.manage).
export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'search.manage');
  return Response.json(
    { searchIndex: await getSearchIndexStatus(staff) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

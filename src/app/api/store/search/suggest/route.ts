import { apiHandler } from '@/lib/api-handler';
import { requestMetadata } from '@/modules/identity/access-control';
import { limitPublicSearch } from '@/modules/search/search-rate-limit';
import { suggestQuerySchema, suggestSearch } from '@/modules/search/search-suggest.service';
import { getStorefrontCategoryTree } from '@/modules/taxonomy/storefront-category.cache';

// C14: GET /api/store/search/suggest?q= (2–100 characters): product and category suggestions.
export const GET = apiHandler(async (request, _routeContext, requestContext) => {
  await limitPublicSearch(requestMetadata(request, requestContext));
  const { q } = suggestQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  return Response.json(
    { suggestions: await suggestSearch(q, await getStorefrontCategoryTree()) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

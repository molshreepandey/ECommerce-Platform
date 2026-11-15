import { apiHandler } from '@/lib/api-handler';
import { requestMetadata } from '@/modules/identity/access-control';
import { limitPublicSearch } from '@/modules/search/search-rate-limit';
import {
  parseProductSearchParams,
  searchParamValuesFromUrl,
} from '@/modules/search/product-search.schema';
import { searchStorefront } from '@/modules/storefront/storefront-search.service';

export const GET = apiHandler(async (request, _routeContext, requestContext) => {
  await limitPublicSearch(requestMetadata(request, requestContext));
  const parsed = parseProductSearchParams(searchParamValuesFromUrl(request.nextUrl.searchParams));
  if (!parsed.success) throw parsed.error;
  const { hits, ...result } = await searchStorefront(parsed.data);
  return Response.json({ products: hits, ...result });
});

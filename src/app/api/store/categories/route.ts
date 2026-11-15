import { apiHandler } from '@/lib/api-handler';
import { getStorefrontCategoryTree } from '@/modules/taxonomy/storefront-category.cache';

export const GET = apiHandler(async () => {
  return Response.json({ categories: await getStorefrontCategoryTree() });
});

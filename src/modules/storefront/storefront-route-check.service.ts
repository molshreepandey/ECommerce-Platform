import { getDatabase } from '@/lib/db';
import type { DynamicRouteCheck } from '@/lib/dynamic-route-check';
import { getLogger } from '@/lib/logger';
import { storefrontProductSlugExists } from '@/modules/catalogue/storefront-product.repository';
import { isCollectionVisible } from '@/modules/merchandising/merchandising.repository';
import { activeCategorySlugExists } from '@/modules/taxonomy/category.repository';

// True when the proxy should answer 404. A database failure lets the request through: the page then
// renders its own not-found state (status 200 with noindex), never an error.
export async function isMissingStorefrontPage(check: DynamicRouteCheck): Promise<boolean> {
  if (check.kind === 'none') return false;
  if (check.kind === 'not-found') return true;
  try {
    const database = getDatabase();
    switch (check.kind) {
      case 'store-product':
        return !(await storefrontProductSlugExists(database, check.slug));
      case 'store-category':
        return !(await activeCategorySlugExists(database, check.slug));
      case 'store-collection':
        return !(await isCollectionVisible(database, check.slug, new Date()));
    }
  } catch (error) {
    getLogger().warn({ err: error }, 'storefront route check failed; rendering the page');
    return false;
  }
}

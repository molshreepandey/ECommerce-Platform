import { getStorefrontProduct } from '@/modules/catalogue/storefront-product.cache';
import {
  findStorefrontProductId,
  loadVariantAvailability,
  type StorefrontProduct,
} from '@/modules/catalogue/storefront-product.service';
import { getStorefrontCategoryTree } from '@/modules/taxonomy/storefront-category.cache';
import { findCategoryTrailById } from '@/modules/taxonomy/storefront-category.service';

import { storefrontErrors } from './storefront.errors';

export interface StorefrontProductPage {
  product: StorefrontProduct;
  categoryTrail: { name: string; slug: string }[];
  availabilityByVariant: Record<string, number>;
  availableQuantity: number;
}

// Product page and GET /api/store/products/<slug>: cached static data plus live availability. A slug that
// does not exist, or a product the storefront does not show, is 404.
export async function getStorefrontProductPage(slug: string): Promise<StorefrontProductPage> {
  const productId = await findStorefrontProductId(slug);
  const product = productId === null ? null : await getStorefrontProduct(productId);
  if (product === null) throw storefrontErrors.productNotFound();
  const [availabilityByVariant, tree] = await Promise.all([
    loadVariantAvailability(product.variants.map(({ id }) => id)),
    getStorefrontCategoryTree(),
  ]);
  const trail =
    product.categoryId === null ? null : findCategoryTrailById(tree, product.categoryId);
  return {
    product,
    categoryTrail: (trail ?? []).map((category) => ({ name: category.name, slug: category.slug })),
    availabilityByVariant,
    availableQuantity: Object.values(availabilityByVariant).reduce(
      (total, quantity) => total + quantity,
      0,
    ),
  };
}

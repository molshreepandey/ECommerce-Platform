import { getAttributeFilterLabels } from '@/modules/catalogue/storefront-product.cache';
import type {
  ProductSearchFacets,
  ProductSearchQuery,
  ProductSearchResult,
} from '@/modules/search/product-search.schema';
import { searchProducts } from '@/modules/search/product-search.service';
import { getStorefrontCategoryTree } from '@/modules/taxonomy/storefront-category.cache';
import {
  findCategoryTrail,
  type StorefrontCategory,
} from '@/modules/taxonomy/storefront-category.service';

import { storefrontErrors } from './storefront.errors';

export interface StorefrontSearchResult extends Omit<ProductSearchResult, 'facets'> {
  category: {
    trail: { name: string; slug: string }[];
    children: { name: string; slug: string }[];
  } | null;
  facets: {
    brands: ProductSearchFacets['brands'];
    attributes: (ProductSearchFacets['attributes'][number] & { label: string })[];
  };
}

const toLink = (category: StorefrontCategory) => ({ name: category.name, slug: category.slug });

// The search behind /search, /categories/<slug> and GET /api/store/search. A category includes all its
// descendants (C7); an unknown or inactive category slug is 404.
export async function searchStorefront(query: ProductSearchQuery): Promise<StorefrontSearchResult> {
  const trail =
    query.categorySlug === undefined
      ? null
      : findCategoryTrail(await getStorefrontCategoryTree(), query.categorySlug);
  if (query.categorySlug !== undefined && trail === null) throw storefrontErrors.categoryNotFound();
  const category = trail?.at(-1) ?? null;
  const [result, labels] = await Promise.all([
    searchProducts({
      ...query,
      category: category === null ? null : { id: category.id, path: category.path },
    }),
    getAttributeFilterLabels(),
  ]);
  return {
    ...result,
    category:
      trail === null || category === null
        ? null
        : { trail: trail.map(toLink), children: category.children.map(toLink) },
    facets: {
      brands: result.facets.brands,
      attributes: result.facets.attributes.map((facet) => ({
        ...facet,
        label: labels[facet.code] ?? facet.code,
      })),
    },
  };
}

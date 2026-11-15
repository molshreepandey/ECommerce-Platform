import { connection } from 'next/server';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { Skeleton } from '@/components/atoms/Skeleton';
import { CategoryTreeList } from '@/components/organisms/StorefrontCatalogue';
import { getStorefrontCategoryTree } from '@/modules/taxonomy/storefront-category.cache';
import { StorePageFrame } from '../store-page-frame';

export const metadata: Metadata = { title: 'All categories' };

async function CategoryTree() {
  await connection();
  const categories = await getStorefrontCategoryTree();
  if (categories.length === 0) {
    return <EmptyState icon="package" headingLevel={2} title="No categories yet" />;
  }
  return <CategoryTreeList categories={categories} label="All categories" />;
}

export default function CategoriesPage() {
  return (
    <StorePageFrame>
      <Flexbox direction="column" gap="lg">
        <Heading level={1} variant="heading2">
          All categories
        </Heading>
        <Suspense fallback={<Skeleton shape="block" height="lg" />}>
          <CategoryTree />
        </Suspense>
      </Flexbox>
    </StorePageFrame>
  );
}

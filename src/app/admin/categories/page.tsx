import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Flexbox } from '@/components/atoms/Flexbox';
import { ReadOnlyNotice } from '@/components/organisms/CatalogueAdmin';
import { CategoryTreeManager } from '@/components/organisms/TaxonomyAdmin';
import { listCategoryTree } from '@/modules/taxonomy/category.service';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';

export const metadata: Metadata = { title: 'Categories' };

export default function CategoriesPage() {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/categories"
        title="Categories"
        readPermission="catalogue.read"
        writePermission="taxonomy.write"
      >
        {async ({ staff, canWrite }) => (
          <Flexbox direction="column" gap="lg" align="stretch">
            <ReadOnlyNotice canWrite={canWrite} />
            <CategoryTreeManager nodes={await listCategoryTree(staff)} canWrite={canWrite} />
          </Flexbox>
        )}
      </AdminPageFrame>
    </Suspense>
  );
}

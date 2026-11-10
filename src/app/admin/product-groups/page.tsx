import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Flexbox } from '@/components/atoms/Flexbox';
import { ReadOnlyNotice } from '@/components/organisms/CatalogueAdmin';
import { ProductGroupManager } from '@/components/organisms/TaxonomyAdmin';
import { listProductGroupsSchema } from '@/modules/grouping/grouping.schema';
import { listProductGroups } from '@/modules/grouping/product-group.service';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';
import { firstSearchValues } from '../catalogue-page-parts';

export const metadata: Metadata = { title: 'Product groups' };

export default function ProductGroupsPage({ searchParams }: PageProps<'/admin/product-groups'>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      {searchParams.then((values) => {
        const parsed = listProductGroupsSchema.safeParse(firstSearchValues(values));
        const filters = parsed.success ? parsed.data : {};
        return (
          <AdminPageFrame
            path="/product-groups"
            title="Product groups"
            readPermission="catalogue.read"
            writePermission="taxonomy.write"
          >
            {async ({ staff, canWrite }) => (
              <Flexbox direction="column" gap="lg" align="stretch">
                <ReadOnlyNotice canWrite={canWrite} />
                <ProductGroupManager
                  groups={await listProductGroups(staff, filters)}
                  search={filters.search ?? ''}
                  canWrite={canWrite}
                />
              </Flexbox>
            )}
          </AdminPageFrame>
        );
      })}
    </Suspense>
  );
}

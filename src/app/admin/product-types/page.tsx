import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProductTypeManager } from '@/components/organisms/CatalogueAdmin';
import { listAllProductTypes } from '@/modules/catalogue/product-type.service';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';

export const metadata: Metadata = { title: 'Product types' };

export default function ProductTypesPage() {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/product-types"
        title="Product types"
        readPermission="catalogue.read"
        writePermission="catalogue.write"
      >
        {async ({ staff, canWrite }) => (
          <ProductTypeManager productTypes={await listAllProductTypes(staff)} canWrite={canWrite} />
        )}
      </AdminPageFrame>
    </Suspense>
  );
}

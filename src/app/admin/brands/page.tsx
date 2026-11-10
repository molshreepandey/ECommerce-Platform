import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BrandManager } from '@/components/organisms/CatalogueAdmin';
import { listBrands } from '@/modules/catalogue/brand.service';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';

export const metadata: Metadata = { title: 'Brands' };

export default function BrandsPage() {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/brands"
        title="Brands"
        readPermission="catalogue.read"
        writePermission="catalogue.write"
      >
        {async ({ staff, canWrite }) => (
          <BrandManager brands={await listBrands(staff)} canWrite={canWrite} />
        )}
      </AdminPageFrame>
    </Suspense>
  );
}

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BrandingForm } from '@/components/organisms/Merchandising';
import { getStoreBrandingForStaff } from '@/modules/merchandising/store-branding.service';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';

export const metadata: Metadata = { title: 'Store branding' };

export default function BrandingPage() {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/branding"
        title="Store branding"
        readPermission="merchandising.write"
        writePermission="merchandising.write"
      >
        {async ({ staff, canWrite }) => (
          <BrandingForm branding={await getStoreBrandingForStaff(staff)} canWrite={canWrite} />
        )}
      </AdminPageFrame>
    </Suspense>
  );
}

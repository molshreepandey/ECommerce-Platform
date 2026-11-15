import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StoreSettingsForm } from '@/components/organisms/PricingAdmin';
import { getStoreSettingsForStaff } from '@/modules/pricing/store-settings.service';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/settings"
        title="Store settings"
        readPermission="settings.write"
        writePermission="settings.write"
      >
        {async ({ staff, canWrite }) => (
          <StoreSettingsForm settings={await getStoreSettingsForStaff(staff)} canWrite={canWrite} />
        )}
      </AdminPageFrame>
    </Suspense>
  );
}
